"""Contract tests for the Flask backend endpoints.

These tests assert that responses deserialize cleanly into the shared Pydantic
models — the same models the Pi will use, the same shapes the Zod schemas on
the frontend will accept.
"""

from __future__ import annotations

import json

import pytest
from generated.pydantic import Firing, LiveState

from udcpine_backend.app import create_app
from udcpine_backend.auth_store import AuthStore
from udcpine_backend.sheets import FakeSheetsExporter, NoopSheetsExporter, RaisingSheetsExporter
from udcpine_backend.store import Store

BOOTSTRAP = "test-bootstrap-secret"


def _inline_runner(task) -> None:
    """Run the export synchronously so the stop-wiring tests are deterministic
    (production runs it on a daemon thread)."""
    task()


@pytest.fixture()
def store(tmp_path) -> Store:
    return Store(str(tmp_path / "api.db"))


@pytest.fixture()
def auth() -> AuthStore:
    return AuthStore(bootstrap_token=BOOTSTRAP)


@pytest.fixture()
def client(store, auth):
    app = create_app(store=store, auth=auth)
    app.config.update(TESTING=True)
    return app.test_client()


@pytest.fixture()
def paired_client(client):
    """A test client that has exchanged the bootstrap token for a cookie."""
    res = client.post("/api/auth/exchange", json={"token": BOOTSTRAP})
    assert res.status_code == 200
    return client


def test_get_state_when_idle(paired_client) -> None:
    res = paired_client.get("/api/state")
    assert res.status_code == 200
    state = LiveState.model_validate(json.loads(res.data))
    assert state.firing is None
    assert state.latest_sample is None
    assert state.active_pizza is None


def test_get_state_after_idle_ingest_has_reading(paired_client) -> None:
    paired_client.post("/api/ingest/sample", json={"temp_c": 22.5})
    state = LiveState.model_validate(json.loads(paired_client.get("/api/state").data))
    assert state.firing is None
    assert state.latest_sample is not None
    assert state.latest_sample.temp_c == 22.5


def test_post_start_returns_active_firing(paired_client) -> None:
    res = paired_client.post("/api/firing/start")
    assert res.status_code == 200
    firing = Firing.model_validate(json.loads(res.data))
    assert firing.status == "active"
    assert firing.ended_at is None


def test_state_after_start_reflects_active_firing(paired_client) -> None:
    paired_client.post("/api/firing/start")
    state = LiveState.model_validate(json.loads(paired_client.get("/api/state").data))
    assert state.firing is not None
    assert state.firing.status == "active"


def test_double_start_is_idempotent(paired_client) -> None:
    a = Firing.model_validate(json.loads(paired_client.post("/api/firing/start").data))
    b = Firing.model_validate(json.loads(paired_client.post("/api/firing/start").data))
    assert a.id == b.id


def test_stop_without_start_is_409(paired_client) -> None:
    res = paired_client.post("/api/firing/stop")
    assert res.status_code == 409


def test_stop_after_start_returns_ended_firing(paired_client) -> None:
    paired_client.post("/api/firing/start")
    res = paired_client.post("/api/firing/stop")
    assert res.status_code == 200
    firing = Firing.model_validate(json.loads(res.data))
    assert firing.status == "ended"
    assert firing.ended_at is not None


def test_state_returns_to_idle_after_stop(paired_client) -> None:
    paired_client.post("/api/firing/start")
    paired_client.post("/api/firing/stop")
    state = LiveState.model_validate(json.loads(paired_client.get("/api/state").data))
    assert state.firing is None


def test_stream_route_returns_event_stream(paired_client, store) -> None:
    """Smoke test: the SSE route exists, sets the right Content-Type, and
    emits valid event-stream bytes that validate against LiveEvent.

    Flask's test client doesn't model long-lived connections well, so we
    open the stream first, then publish a sample on a worker thread so
    the SSE generator has something to yield. The full live-update flow
    is exercised end-to-end in make dev."""
    import threading
    import time

    from generated.pydantic import LiveEvent

    store.start_firing()
    res = paired_client.get("/api/stream", buffered=False)
    assert res.status_code == 200
    assert res.content_type.startswith("text/event-stream")

    def push() -> None:
        time.sleep(0.05)  # let the SSE generator subscribe first
        store.publish_sample(temp_c=260.0)

    threading.Thread(target=push, daemon=True).start()

    body = b""
    for raw in res.response:
        body += raw
        if b"data:" in body and b"\n\n" in body[body.index(b"data:") :]:
            break
    res.close()
    text = body.decode("utf-8")
    payload_line = next(line for line in text.splitlines() if line.startswith("data: "))
    payload = json.loads(payload_line.removeprefix("data: "))
    LiveEvent.model_validate(payload)


def test_gated_endpoint_without_cookie_is_401(client) -> None:
    assert client.get("/api/state").status_code == 401
    assert client.post("/api/firing/start").status_code == 401
    assert client.get("/api/stream").status_code == 401


def test_exchange_with_bootstrap_sets_cookie_and_authorizes(client) -> None:
    res = client.post("/api/auth/exchange", json={"token": BOOTSTRAP})
    assert res.status_code == 200
    # The cookie is now on the client jar; a gated call succeeds.
    assert client.get("/api/state").status_code == 200


def test_exchange_with_bad_token_is_401(client) -> None:
    res = client.post("/api/auth/exchange", json={"token": "wrong"})
    assert res.status_code == 401


def test_exchange_rejects_malformed_body(client) -> None:
    # Empty token violates ExchangeRequest (min length 1).
    res = client.post("/api/auth/exchange", json={"token": ""})
    assert res.status_code == 400


def test_pairing_requires_a_cookie(client) -> None:
    assert client.post("/api/auth/pairing").status_code == 401


def test_paired_device_can_mint_and_a_phone_can_exchange(paired_client) -> None:
    minted = paired_client.post("/api/auth/pairing")
    assert minted.status_code == 200
    token = json.loads(minted.data)["token"]
    # A second, cookie-less client represents the phone.
    phone = paired_client.application.test_client()
    assert phone.get("/api/state").status_code == 401
    assert phone.post("/api/auth/exchange", json={"token": token}).status_code == 200
    assert phone.get("/api/state").status_code == 200


def test_pizza_next_without_firing_is_409(paired_client) -> None:
    res = paired_client.post("/api/pizza/next", json={"name": "Margherita"})
    assert res.status_code == 409


def test_pizza_next_starts_a_pizza(paired_client) -> None:
    paired_client.post("/api/firing/start")
    res = paired_client.post("/api/pizza/next", json={"name": "Margherita"})
    assert res.status_code == 200
    body = json.loads(res.data)
    assert body["name"] == "Margherita"
    assert body["seq"] == 1
    assert body["ended_at"] is None


def test_pizza_next_rejects_empty_name(paired_client) -> None:
    paired_client.post("/api/firing/start")
    res = paired_client.post("/api/pizza/next", json={"name": ""})
    assert res.status_code == 400


def test_state_reflects_active_pizza(paired_client) -> None:
    paired_client.post("/api/firing/start")
    paired_client.post("/api/pizza/next", json={"name": "Margherita"})
    state = LiveState.model_validate(json.loads(paired_client.get("/api/state").data))
    assert state.active_pizza is not None
    assert state.active_pizza.name == "Margherita"


def test_stop_firing_clears_active_pizza_in_state(paired_client) -> None:
    paired_client.post("/api/firing/start")
    paired_client.post("/api/pizza/next", json={"name": "Margherita"})
    paired_client.post("/api/firing/stop")
    state = LiveState.model_validate(json.loads(paired_client.get("/api/state").data))
    assert state.firing is None
    assert state.active_pizza is None


# --- Google Sheets export on firing stop ------------------------------


def _paired(app) -> object:
    app.config.update(TESTING=True)
    client = app.test_client()
    assert client.post("/api/auth/exchange", json={"token": BOOTSTRAP}).status_code == 200
    return client


def test_stop_exports_the_firing_to_sheets(store, auth) -> None:
    exporter = FakeSheetsExporter()
    c = _paired(create_app(store=store, auth=auth, exporter=exporter, export_runner=_inline_runner))
    fid = json.loads(c.post("/api/firing/start").data)["id"]
    c.post("/api/pizza/next", json={"name": "Margherita"})
    c.post("/api/ingest/sample", json={"temp_c": 250.0})

    res = c.post("/api/firing/stop")
    assert res.status_code == 200

    assert exporter.exported_firing_ids == [fid]
    # The persisted sample lands on the firing's detail tab (header + 1 row).
    detail = exporter.detail_tabs[f"firing-{fid}"]
    assert detail[0] == ["t", "temp_c", "temp_f"]
    assert len(detail) == 2
    # The pizza (auto-ended by stop) is captured too.
    assert len(exporter.pizzas_rows) == 1


def test_stop_with_noop_exporter_returns_200(store, auth) -> None:
    c = _paired(
        create_app(
            store=store, auth=auth, exporter=NoopSheetsExporter(), export_runner=_inline_runner
        )
    )
    c.post("/api/firing/start")
    assert c.post("/api/firing/stop").status_code == 200


def test_stop_returns_200_even_when_export_raises(store, auth) -> None:
    exporter = RaisingSheetsExporter()
    c = _paired(create_app(store=store, auth=auth, exporter=exporter, export_runner=_inline_runner))
    fid = json.loads(c.post("/api/firing/start").data)["id"]
    res = c.post("/api/firing/stop")
    # The export blew up, but the stop still succeeds.
    assert res.status_code == 200
    assert exporter.attempts == [fid]


def test_stop_without_active_firing_does_not_export(store, auth) -> None:
    exporter = FakeSheetsExporter()
    c = _paired(create_app(store=store, auth=auth, exporter=exporter, export_runner=_inline_runner))
    assert c.post("/api/firing/stop").status_code == 409
    assert exporter.exported_firing_ids == []


# --- Single-origin SPA serving (the built bundle, served by Flask) ---


@pytest.fixture()
def spa_client(store, auth, tmp_path):
    """A client backed by a fake built frontend bundle on disk."""
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>udcpine</title>")
    (dist / "assets" / "app.js").write_text("console.log('app')")
    app = create_app(store=store, auth=auth, frontend_dist=dist)
    app.config.update(TESTING=True)
    return app.test_client()


def test_root_serves_index_html(spa_client) -> None:
    res = spa_client.get("/")
    assert res.status_code == 200
    assert b"udcpine" in res.data


def test_real_asset_is_served(spa_client) -> None:
    res = spa_client.get("/assets/app.js")
    assert res.status_code == 200
    assert b"console.log" in res.data


def test_unknown_path_falls_back_to_index(spa_client) -> None:
    # Client-side route the SPA owns — must return the shell, not 404.
    res = spa_client.get("/history/42")
    assert res.status_code == 200
    assert b"udcpine" in res.data


# --- Test-only break/heal hooks (UDCPINE_TEST_HOOKS=1) -----------------


def test_test_hooks_404_without_env(client, monkeypatch) -> None:
    # Default: env not set → routes are not registered.
    monkeypatch.delenv("UDCPINE_TEST_HOOKS", raising=False)
    app = create_app(store=Store(":memory:"), auth=AuthStore(bootstrap_token=BOOTSTRAP))
    c = app.test_client()
    # Routes aren't registered → Flask's URL map doesn't know POST for them.
    # The SPA catch-all (GET-only) makes this a 405, not a 404; either way
    # the contract is "not available" — what matters is no 200.
    assert c.post("/api/_test/break-stream").status_code in (404, 405)
    assert c.post("/api/_test/heal-stream").status_code in (404, 405)


def test_test_hooks_present_with_env(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("UDCPINE_TEST_HOOKS", "1")
    app = create_app(
        store=Store(str(tmp_path / "th.db")),
        auth=AuthStore(bootstrap_token=BOOTSTRAP),
    )
    c = app.test_client()
    assert c.post("/api/_test/break-stream").status_code == 200
    assert c.post("/api/_test/heal-stream").status_code == 200


def test_stream_returns_503_when_broken(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("UDCPINE_TEST_HOOKS", "1")
    app = create_app(
        store=Store(str(tmp_path / "br.db")),
        auth=AuthStore(bootstrap_token=BOOTSTRAP),
    )
    c = app.test_client()
    c.post("/api/auth/exchange", json={"token": BOOTSTRAP})
    c.post("/api/_test/break-stream")
    assert c.get("/api/stream").status_code == 503
    c.post("/api/_test/heal-stream")
    # After heal, the route is reachable again (200 + event-stream).
    res = c.get("/api/stream", buffered=False)
    assert res.status_code == 200
    res.close()


def test_unknown_api_path_is_404_not_spa(spa_client) -> None:
    # Authorized client so we pass the /api gate and reach the catch-all.
    spa_client.post("/api/auth/exchange", json={"token": BOOTSTRAP})
    res = spa_client.get("/api/does-not-exist")
    assert res.status_code == 404
    assert b"udcpine" not in res.data


def test_state_cooking_started_at_null_until_first_pizza(paired_client) -> None:
    paired_client.post("/api/firing/start")
    state = LiveState.model_validate(json.loads(paired_client.get("/api/state").data))
    assert state.cooking_started_at is None  # warming up

    paired_client.post("/api/pizza/next", json={"name": "margherita"})
    state = LiveState.model_validate(json.loads(paired_client.get("/api/state").data))
    assert state.cooking_started_at is not None
    assert state.cooking_started_at == state.active_pizza.started_at

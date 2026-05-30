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
from udcpine_backend.store import Store

BOOTSTRAP = "test-bootstrap-secret"


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


def test_unknown_api_path_is_404_not_spa(spa_client) -> None:
    # Authorized client so we pass the /api gate and reach the catch-all.
    spa_client.post("/api/auth/exchange", json={"token": BOOTSTRAP})
    res = spa_client.get("/api/does-not-exist")
    assert res.status_code == 404
    assert b"udcpine" not in res.data

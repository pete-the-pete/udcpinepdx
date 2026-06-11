"""Contract tests for POST /api/ingest/sample.

The ingest endpoint is the production data path: the Pi firmware POSTs
one of these per second once a real thermocouple is wired in. It is
deliberately auth-free (LAN trust boundary; see plan § "Decisions
locked in this session"), so the test surface focuses on validation
edges — wrong content-type, malformed body — and on the fan-out:
a successful POST lands in /api/state and on the SSE stream.
"""

from __future__ import annotations

import json
import threading
import time

import pytest
from generated.pydantic import LiveEvent, LiveState

from udcpine_backend.app import create_app
from udcpine_backend.auth_store import AuthStore
from udcpine_backend.store import Store

BOOTSTRAP = "test-bootstrap-secret"


@pytest.fixture()
def store(tmp_path) -> Store:
    return Store(str(tmp_path / "ingest.db"))


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
    res = client.post("/api/auth/exchange", json={"token": BOOTSTRAP})
    assert res.status_code == 200
    return client


def test_ingest_requires_no_auth(client, store) -> None:
    """The ingest endpoint is exempt from cookie auth: the Pi is on the
    LAN and the plan locks this in. A naked POST with a valid body wins
    once a firing exists to attach the sample to."""
    store.start_firing()
    res = client.post(
        "/api/ingest/sample",
        json={"temp_c": 260.0},
    )
    assert res.status_code == 204
    assert res.data == b""


def test_ingest_happy_path_updates_state_and_sse(paired_client, store) -> None:
    """A POST appears in /api/state.latest_sample and on the SSE stream."""
    store.start_firing()
    # Subscribe to the stream BEFORE the POST so the event lands in our queue.
    res_stream = paired_client.get("/api/stream", buffered=False)
    assert res_stream.status_code == 200

    def push() -> None:
        time.sleep(0.05)
        # Use a second client to send the ingest so the SSE generator
        # can keep running on the first one (Flask's test client
        # serializes per-client requests).
        ingest_client = paired_client.application.test_client()
        r = ingest_client.post(
            "/api/ingest/sample",
            json={"temp_c": 312.5},
        )
        assert r.status_code == 204

    threading.Thread(target=push, daemon=True).start()

    body = b""
    for raw in res_stream.response:
        body += raw
        if b"data:" in body and b"\n\n" in body[body.index(b"data:") :]:
            break
    res_stream.close()

    text = body.decode("utf-8")
    payload_line = next(line for line in text.splitlines() if line.startswith("data: "))
    payload = json.loads(payload_line.removeprefix("data: "))
    LiveEvent.model_validate(payload)
    assert payload["type"] == "sample"
    assert payload["temp_c"] == 312.5

    # State should also reflect the sample.
    state_res = paired_client.get("/api/state")
    assert state_res.status_code == 200
    state = LiveState.model_validate(json.loads(state_res.data))
    assert state.latest_sample is not None
    assert state.latest_sample.temp_c == 312.5


def test_ingest_while_idle_returns_204_and_updates_latest(client, store) -> None:
    """A sample without a firing still returns 204 (the Pi shouldn't have to
    know whether a firing is in progress), but it now updates the live reading
    so the start screen can show an ambient temperature before a firing."""
    res = client.post("/api/ingest/sample", json={"temp_c": 200.0})
    assert res.status_code == 204
    assert store.latest_sample() is not None
    assert store.latest_sample().temp_c == 200.0


def test_ingest_malformed_body_is_422(client) -> None:
    """A body that isn't valid JSON, or that fails Pydantic validation,
    is 422. Pydantic ValidationError exposes structured errors; we surface
    them so the firmware author can debug a misformatted payload."""
    # Not JSON at all (but content-type lies).
    res = client.post(
        "/api/ingest/sample",
        data=b"not json",
        content_type="application/json",
    )
    assert res.status_code == 422

    # Missing required field.
    res = client.post("/api/ingest/sample", json={})
    assert res.status_code == 422

    # Wrong type.
    res = client.post("/api/ingest/sample", json={"temp_c": "hot"})
    assert res.status_code == 422

    # Extra field — schema is `extra="forbid"` to catch typos at the wire.
    res = client.post(
        "/api/ingest/sample",
        json={"temp_c": 200.0, "temp_f": 392.0},
    )
    assert res.status_code == 422


def test_ingest_wrong_content_type_is_415(client) -> None:
    """The application/json requirement is the CSRF preflight guarantee.
    A text/plain POST from a malicious page must not reach the validator —
    it must be rejected up front."""
    res = client.post(
        "/api/ingest/sample",
        data=b"temp_c=260",
        content_type="text/plain",
    )
    assert res.status_code == 415

    # Form-encoded is the other browser-trivial case; also 415.
    res = client.post(
        "/api/ingest/sample",
        data={"temp_c": "260"},
        content_type="application/x-www-form-urlencoded",
    )
    assert res.status_code == 415


def test_ingest_oversized_body_is_413(client) -> None:
    """1 KB per-route cap. A pathological producer (or attacker) sending
    a megabyte of garbage shouldn't be able to wedge the server."""
    huge = json.dumps({"temp_c": 200.0, "pad": "x" * 2000})
    res = client.post(
        "/api/ingest/sample",
        data=huge,
        content_type="application/json",
    )
    assert res.status_code == 413

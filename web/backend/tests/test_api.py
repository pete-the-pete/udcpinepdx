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
from udcpine_backend.store import Store


@pytest.fixture()
def store() -> Store:
    return Store()


@pytest.fixture()
def client(store):
    app = create_app(store=store)
    app.config.update(TESTING=True)
    return app.test_client()


def test_get_state_when_idle(client) -> None:
    res = client.get("/api/state")
    assert res.status_code == 200
    state = LiveState.model_validate(json.loads(res.data))
    assert state.firing is None
    assert state.latest_sample is None
    assert state.active_pizza is None


def test_post_start_returns_active_firing(client) -> None:
    res = client.post("/api/firing/start")
    assert res.status_code == 200
    firing = Firing.model_validate(json.loads(res.data))
    assert firing.status == "active"
    assert firing.ended_at is None


def test_state_after_start_reflects_active_firing(client) -> None:
    client.post("/api/firing/start")
    state = LiveState.model_validate(json.loads(client.get("/api/state").data))
    assert state.firing is not None
    assert state.firing.status == "active"


def test_double_start_is_idempotent(client) -> None:
    a = Firing.model_validate(json.loads(client.post("/api/firing/start").data))
    b = Firing.model_validate(json.loads(client.post("/api/firing/start").data))
    assert a.id == b.id


def test_stop_without_start_is_409(client) -> None:
    res = client.post("/api/firing/stop")
    assert res.status_code == 409


def test_stop_after_start_returns_ended_firing(client) -> None:
    client.post("/api/firing/start")
    res = client.post("/api/firing/stop")
    assert res.status_code == 200
    firing = Firing.model_validate(json.loads(res.data))
    assert firing.status == "ended"
    assert firing.ended_at is not None


def test_state_returns_to_idle_after_stop(client) -> None:
    client.post("/api/firing/start")
    client.post("/api/firing/stop")
    state = LiveState.model_validate(json.loads(client.get("/api/state").data))
    assert state.firing is None


def test_stream_route_returns_event_stream(client, store) -> None:
    """Smoke test: the SSE route exists, sets the right Content-Type, and
    emits valid event-stream bytes that validate against LiveEvent.

    Flask's test client doesn't model long-lived connections well, so we
    pre-start a firing (which causes the sensor thread to publish a
    sample within ~1s) and read just enough bytes to find one data
    line. The full live-update flow is exercised end-to-end in Task 16
    / make dev."""
    from generated.pydantic import LiveEvent

    store.start_firing()
    res = client.get("/api/stream", buffered=False)
    assert res.status_code == 200
    assert res.content_type.startswith("text/event-stream")

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

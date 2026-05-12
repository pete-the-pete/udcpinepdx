"""Contract tests for the Flask backend endpoints.

These tests assert that responses deserialize cleanly into the shared Pydantic
models — the same models the Pi will use, the same shapes the Zod schemas on
the frontend will accept.
"""

from __future__ import annotations

import json

import pytest
from generated.pydantic import LiveState

from udcpine_backend.app import create_app


@pytest.fixture()
def client():
    app = create_app()
    app.config.update(TESTING=True)
    return app.test_client()


def test_get_state_returns_valid_live_state(client) -> None:
    res = client.get("/api/state")
    assert res.status_code == 200
    payload = json.loads(res.data)
    # Round-trip through the shared Pydantic model — proves the wire shape
    # exactly matches the contract the Pi firmware will speak.
    state = LiveState.model_validate(payload)
    assert state.firing.status in ("active", "ended")
    assert state.firing.id >= 0


def test_get_state_includes_mocked_temp_and_pizza(client) -> None:
    res = client.get("/api/state")
    payload = json.loads(res.data)
    state = LiveState.model_validate(payload)
    # The first slice ships hardcoded mock data; assert the canary values
    # so a missing field or type-mismatch is caught here, not by the eye.
    assert state.latest_sample is not None
    assert state.latest_sample.temp_f == 847.0
    assert state.active_pizza is not None
    assert state.active_pizza.name == "Margherita"


def test_get_state_response_is_application_json(client) -> None:
    res = client.get("/api/state")
    assert res.content_type.startswith("application/json")

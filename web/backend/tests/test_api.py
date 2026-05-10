"""Contract tests for the Flask backend endpoints.

These tests assert that responses deserialize cleanly into the shared Pydantic
models — the same models the Pi will use, the same shapes the Zod schemas on
the frontend will accept.
"""

from __future__ import annotations

import json

import pytest
from generated.pydantic import Firing

from udcpine_backend.app import create_app


@pytest.fixture()
def client():
    app = create_app()
    app.config.update(TESTING=True)
    return app.test_client()


def test_get_state_returns_valid_firing(client) -> None:
    res = client.get("/api/state")
    assert res.status_code == 200
    payload = json.loads(res.data)
    # Round-trip through the shared Pydantic model — proves the wire shape
    # exactly matches the contract the Pi firmware will speak.
    firing = Firing.model_validate(payload)
    assert firing.status in ("active", "ended")
    assert firing.id >= 0


def test_get_state_response_is_application_json(client) -> None:
    res = client.get("/api/state")
    assert res.content_type.startswith("application/json")

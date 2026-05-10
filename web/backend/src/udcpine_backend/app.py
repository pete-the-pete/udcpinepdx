"""Flask app factory and route definitions.

The app is intentionally tiny right now: one endpoint, hardcoded data,
no DB, no auth. Each subsequent plan replaces a chunk.
"""

from __future__ import annotations

from flask import Flask, Response

from .mock_state import current_state


def create_app() -> Flask:
    app = Flask(__name__)

    @app.get("/api/state")
    def get_state() -> Response:
        state = current_state()
        # Pydantic's model_dump_json gives us a canonical wire representation
        # that the Zod schema on the frontend will accept verbatim.
        return Response(state.model_dump_json(), mimetype="application/json")

    return app

"""Flask app factory and route definitions.

The app is intentionally tiny: one shared Store + a mock sensor thread.
Each subsequent plan replaces a chunk.
"""

from __future__ import annotations

import json

from flask import Flask, Response

from generated.pydantic import LiveState

from .mock_sensor import MockSensorThread
from .store import Store


def create_app(store: Store | None = None) -> Flask:
    app = Flask(__name__)
    s = store if store is not None else Store()
    app.config["STORE"] = s

    sensor: MockSensorThread | None = None

    def ensure_sensor() -> None:
        nonlocal sensor
        if sensor is None:
            sensor = MockSensorThread(s)
            sensor.start()

    @app.before_request
    def _kick_sensor() -> None:
        ensure_sensor()

    @app.get("/api/state")
    def get_state() -> Response:
        firing = s.firing()
        sample = s.latest_sample()
        state = LiveState(firing=firing, latest_sample=sample, active_pizza=None)
        return Response(state.model_dump_json(), mimetype="application/json")

    @app.post("/api/firing/start")
    def post_firing_start() -> Response:
        firing = s.start_firing()
        return Response(firing.model_dump_json(), mimetype="application/json")

    @app.post("/api/firing/stop")
    def post_firing_stop() -> tuple[Response, int] | Response:
        ended = s.stop_firing()
        if ended is None:
            return Response('{"error":"no active firing"}', mimetype="application/json"), 409
        return Response(ended.model_dump_json(), mimetype="application/json")

    @app.get("/api/stream")
    def get_stream() -> Response:
        q = s.subscribe()

        def gen():
            try:
                yield ": connected\n\n"
                while True:
                    event = q.get()
                    yield f"data: {json.dumps(event)}\n\n"
            finally:
                s.unsubscribe(q)

        return Response(gen(), mimetype="text/event-stream")

    return app

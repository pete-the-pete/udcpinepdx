"""Flask app factory and route definitions.

One shared firing Store + one AuthStore + a mock sensor thread. Every
/api/* route except the auth exchange requires a valid session cookie.
"""

from __future__ import annotations

import json
import os
import secrets
import socket
from pathlib import Path

from flask import Flask, Response, request, send_from_directory
from generated.pydantic import ExchangeRequest, LiveState, PizzaNextRequest
from pydantic import ValidationError

from .auth_store import AuthStore
from .mock_sensor import MockSensorThread
from .store import Store

SESSION_COOKIE = "udcpine_session"
# 30 days; HttpOnly + Lax. Not Secure — see plan, HTTP on the LAN.
_COOKIE_MAX_AGE_S = 60 * 60 * 24 * 30


# Built SPA bundle. Present only after `bun run build` in web/frontend; in
# dev the SPA is served by Vite (:5173) and these routes simply 404.
def _default_frontend_dist() -> Path:
    return Path(
        os.environ.get("UDCPINE_FRONTEND_DIST")
        or Path(__file__).resolve().parents[3] / "frontend" / "dist"
    )


def _lan_ip() -> str:
    """Best-effort detection of this machine's primary LAN IP — the
    interface that routes toward the internet. Used so the pairing QR
    points a phone at a reachable address instead of `localhost`.
    Opening a UDP socket does not send traffic; it just resolves routing.
    """
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return str(s.getsockname()[0])
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def create_app(
    store: Store | None = None,
    auth: AuthStore | None = None,
    frontend_dist: Path | None = None,
) -> Flask:
    app = Flask(__name__)
    dist = frontend_dist if frontend_dist is not None else _default_frontend_dist()
    db_path = os.environ.get("UDCPINE_DB_PATH", "udcpine.db")
    s = store if store is not None else Store(db_path)

    if auth is None:
        bootstrap = os.environ.get("UDCPINE_BOOTSTRAP_TOKEN") or secrets.token_urlsafe(16)
        auth = AuthStore(bootstrap_token=bootstrap)
        # The console is the root of trust: whoever sees this line can pair a
        # device. The bootstrap token is reusable, so this same URL is the
        # pre-approved kiosk link — set UDCPINE_BOOTSTRAP_TOKEN to a short,
        # typeable value and bookmark it on the Pi's browser.
        print(
            f"\n  🔑  Pair a device:  http://{_lan_ip()}:5001/?t={bootstrap}\n"
            "      (port matches `flask run --port`; bookmark this on the Pi)\n",
            flush=True,
        )

    app.config["STORE"] = s
    app.config["AUTH"] = auth

    sensor: MockSensorThread | None = None

    def ensure_sensor() -> None:
        nonlocal sensor
        if sensor is None:
            sensor = MockSensorThread(s)
            sensor.start()

    @app.before_request
    def _kick_sensor() -> None:
        ensure_sensor()

    @app.before_request
    def _require_auth():
        # Only /api/* is gated. The auth exchange must stay open — it is
        # the only way to obtain a cookie in the first place.
        path = request.path
        if not path.startswith("/api/"):
            return None
        if path == "/api/auth/exchange":
            return None
        cookie = request.cookies.get(SESSION_COOKIE, "")
        if cookie and auth.validate_cookie(cookie):
            return None
        return Response('{"error":"unauthorized"}', status=401, mimetype="application/json")

    @app.get("/api/state")
    def get_state() -> Response:
        firing = s.firing()
        sample = s.latest_sample()
        pizza = s.active_pizza()
        state = LiveState(firing=firing, latest_sample=sample, active_pizza=pizza)
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

    @app.post("/api/pizza/next")
    def post_pizza_next() -> tuple[Response, int] | Response:
        try:
            body = PizzaNextRequest.model_validate(request.get_json(silent=True) or {})
        except ValidationError as e:
            return Response(
                json.dumps({"error": e.errors(include_url=False)}),
                status=400,
                mimetype="application/json",
            )
        pizza = s.next_pizza(name=body.name)
        if pizza is None:
            return Response('{"error":"no active firing"}', status=409, mimetype="application/json")
        return Response(pizza.model_dump_json(), mimetype="application/json")

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

    @app.post("/api/auth/exchange")
    def post_auth_exchange() -> tuple[Response, int] | Response:
        try:
            body = ExchangeRequest.model_validate(request.get_json(silent=True) or {})
        except ValidationError as e:
            return Response(
                json.dumps({"error": e.errors(include_url=False)}),
                status=400,
                mimetype="application/json",
            )
        cookie = auth.exchange(body.token)
        if cookie is None:
            return Response('{"error":"invalid token"}', status=401, mimetype="application/json")
        resp = Response('{"ok":true}', mimetype="application/json")
        resp.set_cookie(
            SESSION_COOKIE,
            cookie,
            max_age=_COOKIE_MAX_AGE_S,
            httponly=True,
            samesite="Lax",
            path="/",
        )
        return resp

    @app.post("/api/auth/pairing")
    def post_auth_pairing() -> Response:
        # Reached only past the _require_auth gate, so the caller is paired.
        token = auth.mint_pairing_token()
        return Response(
            json.dumps({"token": token, "lan_ip": _lan_ip()}),
            mimetype="application/json",
        )

    # Single-origin SPA serving. With a built bundle present, Flask serves the
    # frontend on the same origin as /api/*, so the session cookie attaches
    # automatically and there is no CORS. In dev these 404 (Vite serves :5173).
    @app.get("/")
    def index() -> Response:
        return send_from_directory(dist, "index.html")

    @app.get("/<path:path>")
    def spa(path: str) -> Response | tuple[Response, int]:
        # Unknown /api/* paths are real 404s, not the SPA shell.
        if path.startswith("api/"):
            return Response('{"error":"not found"}', status=404, mimetype="application/json")
        # Serve a real asset (hashed JS/CSS, favicon) if it exists; otherwise
        # fall back to index.html so client-side routes resolve.
        if (dist / path).is_file():
            return send_from_directory(dist, path)
        return send_from_directory(dist, "index.html")

    return app

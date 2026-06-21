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

from flask import Flask, Response, abort, request, send_from_directory
from generated.pydantic import (
    ExchangeRequest,
    IngestSampleRequest,
    LiveState,
    PizzaNextRequest,
)
from pydantic import ValidationError

from .auth_store import AuthStore
from .mock_sensor import MockSensorThread, mock_sensor_enabled
from .store import Store

# Hard cap for the ingest endpoint body. A valid IngestSampleRequest is
# ~60 bytes; 1 KB is generous. Enforced per-route (not via Flask's global
# MAX_CONTENT_LENGTH) so future routes — camera frames, config push — can
# set their own ceiling without fighting the ingest limit.
_INGEST_MAX_BODY_BYTES = 1024

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
        # Mock sensor is opt-in via UDCPINE_MOCK_SENSOR. With a real Pi
        # publishing samples to /api/ingest/sample, the mock would shadow
        # the live readings — default-off is the only sane production
        # posture. Tests that exercise the mock loop set the env var
        # explicitly or instantiate MockSensorThread directly.
        nonlocal sensor
        if sensor is None and mock_sensor_enabled():
            sensor = MockSensorThread(s)
            sensor.start()

    @app.before_request
    def _kick_sensor() -> None:
        ensure_sensor()

    @app.before_request
    def _require_auth():
        # Only /api/* is gated. The auth exchange must stay open — it is
        # the only way to obtain a cookie in the first place.
        #
        # The ingest endpoint is also exempt. The LAN is the trust boundary
        # (see plan § "Decisions locked in this session"): the dashboard
        # itself trusts the LAN, so making ingest stronger than the UI it
        # feeds is incoherent, and a bearer token over plaintext HTTP is
        # theater — anyone who can POST can also sniff the token. CSRF from
        # a malicious webpage is blocked by Pydantic's application/json
        # requirement (it forces a preflight).
        path = request.path
        if not path.startswith("/api/"):
            return None
        if path == "/api/auth/exchange":
            return None
        if path == "/api/ingest/sample":
            return None
        # Test-only routes (only registered under UDCPINE_TEST_HOOKS=1) are
        # exempt so the Playwright test can call them without a cookie.
        if path.startswith("/api/_test/"):
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
        state = LiveState(
            firing=firing,
            latest_sample=sample,
            active_pizza=pizza,
            cooking_started_at=s.cooking_started_at(),
        )
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

    @app.post("/api/ingest/sample")
    def post_ingest_sample() -> tuple[Response, int] | Response:
        # Per-route body cap. Cheap to enforce here; deliberate not to
        # set Flask's global MAX_CONTENT_LENGTH (would trip future
        # camera/config routes). Check Content-Length when honest, then
        # fall back to a length read of the body — a producer omitting
        # Content-Length still pays for whatever they sent.
        declared = request.content_length
        if declared is not None and declared > _INGEST_MAX_BODY_BYTES:
            return Response(
                '{"error":"body too large"}',
                status=413,
                mimetype="application/json",
            )
        # 415 first: Pydantic's JSON requirement is the CSRF preflight
        # guarantee. A text/plain POST must not reach the validator.
        if request.mimetype != "application/json":
            return Response(
                '{"error":"expected application/json"}',
                status=415,
                mimetype="application/json",
            )
        raw = request.get_data(cache=False, as_text=False)
        if len(raw) > _INGEST_MAX_BODY_BYTES:
            return Response(
                '{"error":"body too large"}',
                status=413,
                mimetype="application/json",
            )
        try:
            payload = json.loads(raw.decode("utf-8")) if raw else None
            body = IngestSampleRequest.model_validate(payload)
        except (ValueError, ValidationError) as e:
            errors = e.errors(include_url=False) if isinstance(e, ValidationError) else str(e)
            return Response(
                json.dumps({"error": errors}),
                status=422,
                mimetype="application/json",
            )
        s.publish_sample(temp_c=body.temp_c)
        # 204: no body, no allocation, lowest latency for a 1 Hz producer.
        return Response(status=204)

    # Test-only kill-switch for the SSE stream. Toggled by the
    # /api/_test/break-stream and /api/_test/heal-stream routes, which are
    # only registered when UDCPINE_TEST_HOOKS=1. Used by the Playwright
    # reconnect test to assert the ReconnectingOverlay appears and clears.
    # A plain dict is fine for Flask's dev-server (single process/thread).
    # Under gunicorn with multiple workers this would need a threading.Event
    # or a shared-memory primitive — but we're not adding gunicorn yet.
    stream_state: dict[str, bool] = {"broken": False}

    @app.get("/api/stream")
    def get_stream() -> Response:
        if stream_state["broken"]:
            abort(503)
        q = s.subscribe()

        def gen():
            try:
                yield ": connected\n\n"
                while True:
                    if stream_state["broken"]:
                        return
                    event = q.get()
                    # Sentinel from /api/_test/break-stream wakes us so
                    # we can observe the broken flag and exit.
                    if isinstance(event, dict) and event.get("__break__"):
                        return
                    yield f"data: {json.dumps(event)}\n\n"
            finally:
                s.unsubscribe(q)

        return Response(gen(), mimetype="text/event-stream")

    # Test-only routes — registered only under UDCPINE_TEST_HOOKS=1 so
    # production builds cannot expose them. The break route closes the
    # currently-open SSE stream by flipping a flag the generator checks;
    # heal flips it back. _require_auth special-cases /api/_test/* to skip
    # the cookie check (see lines ~126-129), because Playwright calls these
    # hooks via page.request.post() without going through the SPA's cookie
    # jar. The hooks are gated on UDCPINE_TEST_HOOKS=1 at route-registration
    # time, so they don't exist as routes in prod at all.
    if os.environ.get("UDCPINE_TEST_HOOKS") == "1":

        @app.post("/api/_test/break-stream")
        def post_test_break_stream() -> Response:
            stream_state["broken"] = True
            # Wake any blocked q.get() in open SSE generators so they
            # observe the flag and return. The sentinel is a sub-protocol
            # the generator recognizes (see get_stream above).
            s.broadcast_break_sentinel()
            return Response('{"ok":true}', mimetype="application/json")

        @app.post("/api/_test/heal-stream")
        def post_test_heal_stream() -> Response:
            stream_state["broken"] = False
            return Response('{"ok":true}', mimetype="application/json")

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

# QR Pairing + Cookie Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Context

The dashboard is now reachable from a phone over the LAN (Plan A, PR #24), but
**anyone** on the home wifi can load it and hit start/stop. This is **Plan B of
two** for the design doc's Product 2 — it adds authentication so only paired
devices can use the oven.

The mechanism (design doc Flow D, refined in conversation):

- **Root of trust = the server console.** On startup the backend prints a
  one-time bootstrap pairing link (`http://localhost:5173/?t=<secret>`).
  Whoever can see the server's terminal opens it and that device is paired.
  This is the Jupyter-notebook-token pattern.
- **A paired device mints QR codes for new devices.** The authed dashboard has
  a "Pair a phone" affordance: it mints a one-shot token and shows a QR of
  `http://<lan-ip>:5173/?t=<token>`. The phone scans it, the token is
  exchanged for a cookie, the phone is paired.
- **Cookie auth.** Exchange sets an HttpOnly cookie; subsequent requests
  auto-authenticate. Everything under `/api/*` is gated except the exchange
  endpoint itself.
- **In-memory storage**, consistent with the firing Store. Server restart →
  re-pair (you re-open the freshly-printed bootstrap link).

Why not detect "is this the localhost kiosk" and skip auth: in dev the Vite
proxy makes every request reach Flask from `127.0.0.1`, so remote-IP detection
is unreliable. The bootstrap-link model needs no IP detection and works
identically in dev and (later) on the Pi.

**Goal:** Only paired devices can view or control the oven; a phone is paired by scanning a QR shown on an already-paired device, and the first device is paired via a link the server prints on startup.

**Architecture:** A new in-memory `AuthStore` (separate from the firing `Store`) holds a reusable bootstrap secret, short-lived one-shot pairing tokens, and the set of paired devices — storing only SHA-256 hashes of tokens and cookies, never raw values. A Flask `before_request` gate rejects any `/api/*` request without a valid session cookie, except `POST /api/auth/exchange`. `POST /api/auth/exchange` trades a token (bootstrap secret or a one-shot pairing token) for an HttpOnly cookie; `POST /api/auth/pairing` (itself gated) mints a one-shot token for a new device. On the frontend, the app reads a `?t=` token on boot and exchanges it; an unauthenticated app renders a `PairScreen` instead of the dashboard; the authed dashboard gains a "Pair a phone" QR overlay rendered client-side with the `qrcode` library.

**Tech Stack:** Flask `before_request`, Python `hashlib` + `secrets` (stdlib — no new backend dependency), `qrcode` (new frontend dependency, client-side QR rendering), the existing Zod ↔ Pydantic bridge for the two new wire types.

---

## Conscious decisions

1. **Bootstrap secret printed to console, not a TOFU "first device is free" window.** The console is a clean, recognizable root of trust (Jupyter), needs no IP detection, and is testable — CI fixes the secret via an env var. TOFU would leave an open pairing window after every restart and can't be exercised by two e2e viewports against one server.
2. **`AuthStore` is separate from the firing `Store`.** Different lifecycle and concern; bundling them would muddy both. Both are in-memory singletons constructed in `create_app`.
3. **Only hashes stored.** Raw tokens/cookies exist only in transit and in the client. The server keeps `sha256(value)` — a leaked AuthStore dump can't be replayed. (Design doc: "Only hashes of tokens and cookies are stored, never raw values.")
4. **Gate everything under `/api/*`.** An unpaired device sees only the pair screen — matches "scan a QR to get access." Exception: `POST /api/auth/exchange` must be open or no one could ever get a cookie.
5. **QR rendered client-side with `qrcode`.** The frontend authoritatively knows its own origin (`window.location.origin`); building the pair URL there avoids the server guessing its LAN address or trusting an `Origin` header. The mint endpoint returns only the token.
6. **No router.** "Unauthenticated" is just an app state that renders `PairScreen`; the pairing URL is `/?t=…`, not a `/pair` route. The app already switches views on state — this is one more state.
7. **HTTP, not HTTPS; cookie is `HttpOnly` + `SameSite=Lax`, not `Secure`.** `Secure` cookies require HTTPS, which we don't have on the LAN. `HttpOnly` (no JS access) and `SameSite=Lax` still apply over HTTP. Production HTTPS is a Pi-deployment concern.
8. **In-memory storage.** Consistent with the firing Store; SQLite-backed `auth_token`/`paired_device` tables are deferred to a future persistence plan. Restart = re-pair.

## Out of scope (future plans)

- Per-device revocation UI (design doc defers this to "Polish").
- SQLite persistence of devices/tokens.
- mDNS / `pizza.local` — Pi-deployment concern.
- HTTPS / `Secure` cookie — Pi-deployment concern.
- The localhost-kiosk auth bypass — a Pi-deployment optimization where `remote_addr` is reliable.
- Cookie/session expiry sweeping (tokens expire; the device set only grows until restart — fine for a hobby LAN).

---

## File structure

```
udcpinepdx/
├── plans/web/2026-05-17-qr-pairing-auth.md          (this plan)
├── shared/
│   ├── src/
│   │   ├── exchange-request.ts                       (NEW — { token })
│   │   ├── pairing-token.ts                          (NEW — { token })
│   │   └── index.ts                                  (MODIFY — register both)
│   └── tests/fixtures/
│       ├── exchangerequest/                          (NEW — valid + invalid)
│       └── pairingtoken/                             (NEW — valid)
├── web/backend/
│   ├── src/udcpine_backend/
│   │   ├── auth_store.py                             (NEW — AuthStore)
│   │   └── app.py                                    (MODIFY — gate + auth routes + bootstrap print)
│   └── tests/
│       ├── test_auth_store.py                        (NEW)
│       └── test_api.py                               (MODIFY — auth gate + exchange/pairing)
├── web/frontend/
│   ├── package.json                                  (MODIFY — add qrcode)
│   ├── playwright.config.ts                          (MODIFY — fixed bootstrap token env)
│   ├── src/
│   │   ├── api.ts                                    (MODIFY — exchange/mint + UnauthorizedError)
│   │   ├── app.tsx                                   (MODIFY — ?t= exchange, 401 → PairScreen)
│   │   ├── styles.css                                (MODIFY — pair screen + QR overlay)
│   │   └── views/
│   │       ├── pair-screen.tsx                       (NEW — unauthenticated view)
│   │       └── pair-phone-overlay.tsx                (NEW — QR overlay for authed devices)
│   └── tests/e2e/
│       └── dashboard.spec.ts                         (MODIFY — pair before the firing flow)
```

---

## Task 1: Shared wire types — `ExchangeRequest` and `PairingToken`

**Files:**
- Create: `shared/src/exchange-request.ts`
- Create: `shared/src/pairing-token.ts`
- Modify: `shared/src/index.ts`
- Create: `shared/tests/fixtures/exchangerequest/valid/normal.json`
- Create: `shared/tests/fixtures/exchangerequest/invalid/empty-token.json`
- Create: `shared/tests/fixtures/pairingtoken/valid/normal.json`
- Modify: `shared/tests/test_contract.py`

- [ ] **Step 1: Write `shared/src/exchange-request.ts`**

```typescript
import { z } from "zod";

/**
 * POST /api/auth/exchange body. The token is either the server's bootstrap
 * secret (printed to the console on startup) or a one-shot pairing token
 * minted by an already-paired device.
 */
export const ExchangeRequestSchema = z.object({
  token: z.string().min(1),
});

export type ExchangeRequest = z.infer<typeof ExchangeRequestSchema>;
```

- [ ] **Step 2: Write `shared/src/pairing-token.ts`**

```typescript
import { z } from "zod";

/**
 * Response of POST /api/auth/pairing — a freshly minted one-shot pairing
 * token. The frontend builds a QR of `<origin>/?t=<token>` from it.
 */
export const PairingTokenSchema = z.object({
  token: z.string().min(1),
});

export type PairingToken = z.infer<typeof PairingTokenSchema>;
```

- [ ] **Step 3: Register both in `shared/src/index.ts`**

Replace the file with:

```typescript
import { FiringSchema } from "./firing.ts";
import { SampleSchema } from "./sample.ts";
import { PizzaSchema } from "./pizza.ts";
import { LiveStateSchema } from "./live-state.ts";
import { LiveEventSchema } from "./live-event.ts";
import { StartFiringRequestSchema } from "./start-firing-request.ts";
import { EndFiringRequestSchema } from "./end-firing-request.ts";
import { ExchangeRequestSchema } from "./exchange-request.ts";
import { PairingTokenSchema } from "./pairing-token.ts";

export {
  FiringSchema,
  SampleSchema,
  PizzaSchema,
  LiveStateSchema,
  LiveEventSchema,
  StartFiringRequestSchema,
  EndFiringRequestSchema,
  ExchangeRequestSchema,
  PairingTokenSchema,
};
export type { Firing } from "./firing.ts";
export type { Sample } from "./sample.ts";
export type { Pizza } from "./pizza.ts";
export type { LiveState } from "./live-state.ts";
export type { LiveEvent, SampleEvent } from "./live-event.ts";
export type { StartFiringRequest } from "./start-firing-request.ts";
export type { EndFiringRequest } from "./end-firing-request.ts";
export type { ExchangeRequest } from "./exchange-request.ts";
export type { PairingToken } from "./pairing-token.ts";

export const ALL_SCHEMAS = {
  Firing: FiringSchema,
  Sample: SampleSchema,
  Pizza: PizzaSchema,
  LiveState: LiveStateSchema,
  LiveEvent: LiveEventSchema,
  StartFiringRequest: StartFiringRequestSchema,
  EndFiringRequest: EndFiringRequestSchema,
  ExchangeRequest: ExchangeRequestSchema,
  PairingToken: PairingTokenSchema,
} as const;
```

- [ ] **Step 4: Write the fixtures**

`shared/tests/fixtures/exchangerequest/valid/normal.json`:

```json
{ "token": "abc123def456" }
```

`shared/tests/fixtures/exchangerequest/invalid/empty-token.json`:

```json
{ "token": "" }
```

`shared/tests/fixtures/pairingtoken/valid/normal.json`:

```json
{ "token": "xyz789ghi012" }
```

- [ ] **Step 5: Register the new models in `shared/tests/test_contract.py`**

Change the import line:

```python
from generated.pydantic import Firing, LiveEvent, LiveState, Pizza, Sample
```

to:

```python
from generated.pydantic import (
    ExchangeRequest,
    Firing,
    LiveEvent,
    LiveState,
    PairingToken,
    Pizza,
    Sample,
)
```

And extend the `MODELS` dict with:

```python
    "exchangerequest": ExchangeRequest,
    "pairingtoken": PairingToken,
```

- [ ] **Step 6: Regenerate + test**

Run: `make codegen && make shared-test`
Expected: codegen succeeds; shared tests pass (16 prior + 2 valid new + 1 invalid new = 19).

- [ ] **Step 7: Commit**

```bash
git add shared/src/exchange-request.ts shared/src/pairing-token.ts shared/src/index.ts shared/tests/fixtures/exchangerequest/ shared/tests/fixtures/pairingtoken/ shared/tests/test_contract.py shared/generated/
git commit -m "feat(shared): ExchangeRequest + PairingToken wire types"
```

---

## Task 2: `AuthStore` — TDD

**Files:**
- Create: `web/backend/tests/test_auth_store.py`
- Create: `web/backend/src/udcpine_backend/auth_store.py`

- [ ] **Step 1: Write the failing tests `web/backend/tests/test_auth_store.py`**

```python
"""AuthStore: in-memory pairing tokens + paired devices."""

from __future__ import annotations

from udcpine_backend.auth_store import AuthStore


def test_bootstrap_token_exchanges_to_a_cookie() -> None:
    a = AuthStore(bootstrap_token="boot-secret")
    cookie = a.exchange("boot-secret")
    assert cookie is not None
    assert a.validate_cookie(cookie) is True


def test_bootstrap_token_is_reusable() -> None:
    a = AuthStore(bootstrap_token="boot-secret")
    c1 = a.exchange("boot-secret")
    c2 = a.exchange("boot-secret")
    # Two distinct devices, both valid — the bootstrap token is not consumed.
    assert c1 != c2
    assert a.validate_cookie(c1) is True
    assert a.validate_cookie(c2) is True


def test_wrong_token_does_not_exchange() -> None:
    a = AuthStore(bootstrap_token="boot-secret")
    assert a.exchange("not-the-secret") is None


def test_minted_pairing_token_exchanges_once() -> None:
    a = AuthStore(bootstrap_token="boot-secret")
    token = a.mint_pairing_token()
    cookie = a.exchange(token)
    assert cookie is not None
    # One-shot: the same token cannot be exchanged again.
    assert a.exchange(token) is None


def test_unknown_cookie_is_invalid() -> None:
    a = AuthStore(bootstrap_token="boot-secret")
    assert a.validate_cookie("never-issued") is False


def test_device_count_reflects_exchanges() -> None:
    a = AuthStore(bootstrap_token="boot-secret")
    assert a.device_count() == 0
    a.exchange("boot-secret")
    a.exchange("boot-secret")
    assert a.device_count() == 2


def test_raw_token_is_not_stored() -> None:
    # Only hashes live in the store — assert the raw secret appears nowhere
    # in the token/device tables.
    a = AuthStore(bootstrap_token="boot-secret")
    token = a.mint_pairing_token()
    a.exchange(token)
    blob = repr(a.__dict__)
    assert token not in blob
    assert "boot-secret" not in blob.replace("bootstrap_token", "")
```

- [ ] **Step 2: Run; verify failure**

Run: `cd web/backend && uv run pytest tests/test_auth_store.py -v`
Expected: collection error / `ModuleNotFoundError: udcpine_backend.auth_store`.

- [ ] **Step 3: Write `web/backend/src/udcpine_backend/auth_store.py`**

```python
"""In-memory authentication state: bootstrap secret, one-shot pairing
tokens, and the set of paired devices.

Only SHA-256 hashes of tokens and cookies are kept — raw values exist
only in transit and on the client. A dump of this object cannot be
replayed to forge a session.

Lifecycle matches the firing Store: in-memory, lost on restart. After a
restart you re-pair by opening the freshly printed bootstrap link.
"""

from __future__ import annotations

import hashlib
import secrets
import threading
import time


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


_PAIRING_TOKEN_TTL_S = 300  # 5 minutes — scan the QR promptly


class AuthStore:
    def __init__(self, bootstrap_token: str) -> None:
        self._lock = threading.Lock()
        self._bootstrap_hash = _hash(bootstrap_token)
        # token_hash -> expires_at (epoch seconds). Presence == unused.
        self._pairing_tokens: dict[str, float] = {}
        # cookie_hash -> created_at (epoch seconds).
        self._devices: dict[str, float] = {}

    def mint_pairing_token(self) -> str:
        """Create a one-shot pairing token, valid for 5 minutes."""
        token = secrets.token_urlsafe(32)
        with self._lock:
            self._pairing_tokens[_hash(token)] = time.time() + _PAIRING_TOKEN_TTL_S
        return token

    def exchange(self, token: str) -> str | None:
        """Trade a token for a fresh session cookie value, or None if the
        token is not valid. The bootstrap token is reusable; a minted
        pairing token is consumed on first successful exchange."""
        token_hash = _hash(token)
        with self._lock:
            if token_hash == self._bootstrap_hash:
                pass  # reusable — not consumed
            elif token_hash in self._pairing_tokens:
                expires_at = self._pairing_tokens.pop(token_hash)  # consume
                if time.time() > expires_at:
                    return None  # expired (and now removed)
            else:
                return None
            cookie = secrets.token_urlsafe(32)
            self._devices[_hash(cookie)] = time.time()
            return cookie

    def validate_cookie(self, cookie: str) -> bool:
        with self._lock:
            return _hash(cookie) in self._devices

    def device_count(self) -> int:
        with self._lock:
            return len(self._devices)
```

- [ ] **Step 4: Run tests**

Run: `cd web/backend && uv run pytest tests/test_auth_store.py -v`
Expected: 7 PASS.

- [ ] **Step 5: Commit**

```bash
git add web/backend/src/udcpine_backend/auth_store.py web/backend/tests/test_auth_store.py
git commit -m "feat(web): in-memory AuthStore (hashed tokens + devices)"
```

---

## Task 3: Auth endpoints + the `/api/*` gate

**Files:**
- Modify: `web/backend/src/udcpine_backend/app.py`
- Modify: `web/backend/tests/test_api.py`

- [ ] **Step 1: Add failing tests to `web/backend/tests/test_api.py`**

First, replace the `client` fixture block at the top so the app is built
with a known bootstrap token and the test client can pair itself. Change:

```python
@pytest.fixture()
def store() -> Store:
    return Store()


@pytest.fixture()
def client(store):
    app = create_app(store=store)
    app.config.update(TESTING=True)
    return app.test_client()
```

to:

```python
from udcpine_backend.auth_store import AuthStore

BOOTSTRAP = "test-bootstrap-secret"


@pytest.fixture()
def store() -> Store:
    return Store()


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
```

Every existing test in this file uses `client` to hit gated endpoints —
those will now 401. Update each existing test to use `paired_client`
instead of `client` (the gated-endpoint tests: `test_get_state_when_idle`,
`test_post_start_returns_active_firing`, `test_state_after_start_reflects_active_firing`,
`test_double_start_is_idempotent`, `test_stop_without_start_is_409`,
`test_stop_after_start_returns_ended_firing`, `test_state_returns_to_idle_after_stop`,
`test_stream_route_returns_event_stream`). Rename their parameter `client`
→ `paired_client` and update the body references.

Then append these new tests:

```python
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
```

- [ ] **Step 2: Run; verify failures**

Run: `cd web/backend && uv run pytest tests/test_api.py -v`
Expected: the new auth tests fail (routes/gate missing); pre-existing tests
may also fail until Step 3 wires `auth` into `create_app`.

- [ ] **Step 3: Rewrite `web/backend/src/udcpine_backend/app.py`**

```python
"""Flask app factory and route definitions.

One shared firing Store + one AuthStore + a mock sensor thread. Every
/api/* route except the auth exchange requires a valid session cookie.
"""

from __future__ import annotations

import json
import os
import secrets

from flask import Flask, Response, request

from generated.pydantic import LiveState
from pydantic import ValidationError

from generated.pydantic import ExchangeRequest

from .auth_store import AuthStore
from .mock_sensor import MockSensorThread
from .store import Store

SESSION_COOKIE = "udcpine_session"
# 30 days; HttpOnly + Lax. Not Secure — see plan, HTTP on the LAN.
_COOKIE_MAX_AGE_S = 60 * 60 * 24 * 30


def create_app(store: Store | None = None, auth: AuthStore | None = None) -> Flask:
    app = Flask(__name__)
    s = store if store is not None else Store()

    if auth is None:
        bootstrap = os.environ.get("UDCPINE_BOOTSTRAP_TOKEN") or secrets.token_urlsafe(16)
        auth = AuthStore(bootstrap_token=bootstrap)
        # The console is the root of trust: whoever sees this line can pair
        # the first device. 5173 is the Vite dev port the phone/laptop hit.
        print(f"\n  🔑  Pair this device:  http://localhost:5173/?t={bootstrap}\n", flush=True)

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

    @app.post("/api/auth/exchange")
    def post_auth_exchange() -> tuple[Response, int] | Response:
        try:
            body = ExchangeRequest.model_validate(request.get_json(silent=True) or {})
        except ValidationError as e:
            return Response(json.dumps({"error": e.errors(include_url=False)}),
                            status=400, mimetype="application/json")
        cookie = auth.exchange(body.token)
        if cookie is None:
            return Response('{"error":"invalid token"}', status=401, mimetype="application/json")
        resp = Response('{"ok":true}', mimetype="application/json")
        resp.set_cookie(
            SESSION_COOKIE, cookie,
            max_age=_COOKIE_MAX_AGE_S, httponly=True, samesite="Lax", path="/",
        )
        return resp

    @app.post("/api/auth/pairing")
    def post_auth_pairing() -> Response:
        # Reached only past the _require_auth gate, so the caller is paired.
        token = auth.mint_pairing_token()
        return Response(json.dumps({"token": token}), mimetype="application/json")

    return app
```

- [ ] **Step 4: Run the full backend suite**

Run: `cd web/backend && uv run pytest -v`
Expected: all pass — `test_auth_store.py` (7), `test_store.py` (12),
`test_mock_sensor.py` (5), `test_api.py` (8 updated + 6 new = 14). Total 38.

- [ ] **Step 5: Commit**

```bash
git add web/backend/src/udcpine_backend/app.py web/backend/tests/test_api.py
git commit -m "feat(web): cookie auth gate + exchange/pairing endpoints"
```

---

## Task 4: Frontend — `qrcode` dep + auth API functions

**Files:**
- Modify: `web/frontend/package.json`
- Modify: `web/frontend/src/api.ts`

- [ ] **Step 1: Add `qrcode` to `web/frontend/package.json`**

In the `dependencies` block, add `qrcode`, and in `devDependencies` add its
types. The `dependencies` and `devDependencies` blocks become:

```json
  "dependencies": {
    "@udcpine/shared": "workspace:*",
    "preact": "^10.22.0",
    "qrcode": "^1.5.4"
  },
  "devDependencies": {
    "@playwright/test": "^1.48.0",
    "@preact/preset-vite": "^2.9.0",
    "@types/qrcode": "^1.5.5",
    "typescript": "^5.6.0",
    "vite": "^5.4.0"
  }
```

- [ ] **Step 2: Install**

Run from repo root: `bun install`
Expected: `qrcode` and `@types/qrcode` resolve.

- [ ] **Step 3: Rewrite `web/frontend/src/api.ts`**

```typescript
import {
  FiringSchema,
  LiveStateSchema,
  PairingTokenSchema,
  type Firing,
  type LiveState,
} from "@udcpine/shared";

/** Thrown when a request comes back 401 — the device is not paired. */
export class UnauthorizedError extends Error {
  constructor() {
    super("unauthorized");
    this.name = "UnauthorizedError";
  }
}

async function getJson(path: string): Promise<unknown> {
  const res = await fetch(path);
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return res.json();
}

export async function fetchState(): Promise<LiveState> {
  const parsed = LiveStateSchema.safeParse(await getJson("/api/state"));
  if (!parsed.success) {
    throw new Error(`/api/state contract violation: ${parsed.error.message}`);
  }
  return parsed.data;
}

async function postFiring(path: string): Promise<Firing> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  const parsed = FiringSchema.safeParse(await res.json());
  if (!parsed.success) {
    throw new Error(`${path} contract violation: ${parsed.error.message}`);
  }
  return parsed.data;
}

export const startFiring = (): Promise<Firing> => postFiring("/api/firing/start");
export const endFiring = (): Promise<Firing> => postFiring("/api/firing/stop");

/**
 * Exchange a pairing token (from a ?t= URL param, a scanned QR, or the
 * server's bootstrap link) for a session cookie. Resolves true on success.
 */
export async function exchangeToken(token: string): Promise<boolean> {
  const res = await fetch("/api/auth/exchange", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
  return res.ok;
}

/** Mint a one-shot pairing token (caller must already be paired). */
export async function mintPairingToken(): Promise<string> {
  const res = await fetch("/api/auth/pairing", { method: "POST" });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new Error(`/api/auth/pairing returned ${res.status}`);
  const parsed = PairingTokenSchema.safeParse(await res.json());
  if (!parsed.success) {
    throw new Error(`/api/auth/pairing contract violation: ${parsed.error.message}`);
  }
  return parsed.data.token;
}
```

- [ ] **Step 4: Typecheck**

Run: `cd web/frontend && bun run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/frontend/package.json web/frontend/src/api.ts bun.lock
git commit -m "feat(web): qrcode dep + auth API client functions"
```

---

## Task 5: Frontend — `PairScreen` and `PairPhoneOverlay` views

**Files:**
- Create: `web/frontend/src/views/pair-screen.tsx`
- Create: `web/frontend/src/views/pair-phone-overlay.tsx`

- [ ] **Step 1: Write `web/frontend/src/views/pair-screen.tsx`**

```tsx
/**
 * Shown when the app has no valid session cookie. A genuinely unpaired
 * device cannot mint its own QR (minting is gated) — so this screen only
 * gives instructions. The real pairing paths are:
 *   - open the bootstrap link the server printed to its console, or
 *   - scan a QR shown by an already-paired device.
 */
export function PairScreen() {
  return (
    <main class="hero">
      <div class="hero__ember" aria-hidden="true" />
      <header class="hero__status">
        <span class="hero__id">OVEN · NOT PAIRED</span>
      </header>
      <section class="pair">
        <h1 class="pair__title">This device isn't paired</h1>
        <ol class="pair__steps">
          <li>On the oven's screen, open <b>Pair a phone</b> and scan the QR.</li>
          <li>First device ever? Open the link the server printed in its console.</li>
        </ol>
      </section>
    </main>
  );
}
```

- [ ] **Step 2: Write `web/frontend/src/views/pair-phone-overlay.tsx`**

```tsx
import { useEffect, useState } from "preact/hooks";
import QRCode from "qrcode";
import { mintPairingToken } from "../api";

interface PairPhoneOverlayProps {
  onClose: () => void;
}

/**
 * Overlay shown from the authed dashboard. Mints a one-shot pairing token
 * and renders a QR of `<origin>/?t=<token>` for a phone to scan. The
 * origin is taken from window.location so the QR points at whatever LAN
 * address this device is already using.
 */
export function PairPhoneOverlay({ onClose }: PairPhoneOverlayProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    mintPairingToken()
      .then((token) => {
        const url = `${window.location.origin}/?t=${encodeURIComponent(token)}`;
        return QRCode.toDataURL(url, { width: 320, margin: 2 });
      })
      .then((png) => {
        if (!cancelled) setDataUrl(png);
      })
      .catch((e: unknown) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div class="overlay" onClick={onClose}>
      <div class="overlay__card" onClick={(e) => e.stopPropagation()}>
        <h2 class="overlay__title">Pair a phone</h2>
        <p class="overlay__hint">Scan with your phone's camera</p>
        {dataUrl !== null && <img class="overlay__qr" src={dataUrl} alt="pairing QR code" />}
        {dataUrl === null && err === null && <p class="overlay__hint">minting…</p>}
        {err !== null && <p class="overlay__err">error: {err}</p>}
        <button type="button" class="overlay__close" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `cd web/frontend && bun run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add web/frontend/src/views/pair-screen.tsx web/frontend/src/views/pair-phone-overlay.tsx
git commit -m "feat(web): PairScreen + PairPhoneOverlay views"
```

---

## Task 6: Frontend — wire auth into `App` + "Pair a phone" button

**Files:**
- Modify: `web/frontend/src/app.tsx`
- Modify: `web/frontend/src/views/hero-number.tsx`
- Modify: `web/frontend/src/views/idle-screen.tsx`

- [ ] **Step 1: Rewrite `web/frontend/src/app.tsx`**

```tsx
import { useEffect, useState } from "preact/hooks";
import type { LiveState } from "@udcpine/shared";
import { exchangeToken, fetchState, UnauthorizedError } from "./api";
import { useLiveState } from "./use-live-state";
import { HeroNumber } from "./views/hero-number";
import { IdleScreen } from "./views/idle-screen";
import { PairScreen } from "./views/pair-screen";

type Boot =
  | { kind: "loading" }
  | { kind: "ok"; initial: LiveState }
  | { kind: "unpaired" }
  | { kind: "error"; message: string };

/** Read a ?t= pairing token from the URL, then strip it from history. */
function takeUrlToken(): string | null {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("t");
  if (token !== null) {
    window.history.replaceState({}, "", window.location.pathname);
  }
  return token;
}

export function App() {
  const [boot, setBoot] = useState<Boot>({ kind: "loading" });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // If we arrived via a QR / bootstrap link, exchange the token first.
      const token = takeUrlToken();
      if (token !== null) await exchangeToken(token);
      try {
        const initial = await fetchState();
        if (!cancelled) setBoot({ kind: "ok", initial });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof UnauthorizedError) setBoot({ kind: "unpaired" });
        else setBoot({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  if (boot.kind === "loading") return <main class="hero"><div class="hero__delta">loading…</div></main>;
  if (boot.kind === "unpaired") return <PairScreen />;
  if (boot.kind === "error") return <main class="hero"><div class="hero__delta">error: {boot.message}</div></main>;

  return <Live initial={boot.initial} onAction={() => setNonce((n) => n + 1)} />;
}

function Live({ initial, onAction }: { initial: LiveState; onAction: () => void }) {
  const state = useLiveState(initial);
  if (state.firing === null) return <IdleScreen onStarted={onAction} />;
  return <HeroNumber state={{ ...state, firing: state.firing }} onEnded={onAction} />;
}
```

- [ ] **Step 2: Add a "Pair a phone" control to `web/frontend/src/views/idle-screen.tsx`**

The idle screen is the calmest place for the pairing affordance. Replace the
file with (adds the overlay toggle; START logic unchanged):

```tsx
import { useState } from "preact/hooks";
import { startFiring } from "../api";
import { PairPhoneOverlay } from "./pair-phone-overlay";

interface IdleScreenProps {
  onStarted: () => void;
}

export function IdleScreen({ onStarted }: IdleScreenProps) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pairing, setPairing] = useState(false);

  async function onClick() {
    setBusy(true);
    setErr(null);
    try {
      await startFiring();
      onStarted();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <main class="hero">
      <div class="hero__ember" aria-hidden="true" />
      <header class="hero__status">
        <span class="hero__id">OVEN · IDLE</span>
        <button type="button" class="hero__pair" onClick={() => setPairing(true)}>
          PAIR A PHONE
        </button>
      </header>

      <section class="idle">
        <button type="button" class="idle__start" onClick={onClick} disabled={busy}>
          {busy ? "STARTING…" : "START FIRING"}
        </button>
        <p class="idle__caption">begin a new session</p>
        {err !== null && <p class="idle__error">error: {err}</p>}
      </section>

      {pairing && <PairPhoneOverlay onClose={() => setPairing(false)} />}
    </main>
  );
}
```

- [ ] **Step 3: Add the same control to `web/frontend/src/views/hero-number.tsx`**

So the QR is reachable during a firing too. In `hero-number.tsx`, add the
import, a `pairing` state, the button in the header cluster, and the overlay.
Replace the file with:

```tsx
import { useEffect, useState } from "preact/hooks";
import type { Firing, LiveState } from "@udcpine/shared";
import { endFiring } from "../api";
import { PairPhoneOverlay } from "./pair-phone-overlay";

interface HeroNumberProps {
  state: LiveState & { firing: Firing };
  onEnded: () => void;
}

function useTick(intervalMs: number): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function formatHMS(ms: number): string {
  if (Number.isNaN(ms) || ms < 0) return "0:00:00";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export function HeroNumber({ state, onEnded }: HeroNumberProps) {
  const now = useTick(1000);
  const [stopBusy, setStopBusy] = useState(false);
  const [pairing, setPairing] = useState(false);
  const { firing, latest_sample } = state;

  const firingElapsed = formatHMS(now - Date.parse(firing.started_at));
  const tempLabel =
    latest_sample !== null ? Math.round(latest_sample.temp_f).toString() : "—";

  async function onStop() {
    setStopBusy(true);
    try {
      await endFiring();
      onEnded();
    } catch {
      setStopBusy(false);
    }
  }

  return (
    <main class="hero">
      <div class="hero__ember" aria-hidden="true" />

      <header class="hero__status">
        <span class="hero__id">
          FIRING #{firing.id.toString().padStart(3, "0")} · {firing.status.toUpperCase()} {firingElapsed}
        </span>
        <span class="hero__right">
          <span class="hero__live">
            <span class="hero__dot" aria-hidden="true" />
            LIVE
          </span>
          <button type="button" class="hero__pair" onClick={() => setPairing(true)}>
            PAIR A PHONE
          </button>
          <button
            type="button"
            class="hero__stop"
            onClick={onStop}
            disabled={stopBusy}
            aria-label="stop firing"
          >
            {stopBusy ? "…" : "STOP"}
          </button>
        </span>
      </header>

      <section class="hero__readout">
        <div
          class="hero__num"
          aria-label={
            latest_sample !== null
              ? `hearth at ${tempLabel} degrees fahrenheit`
              : "hearth temperature unavailable"
          }
        >
          {tempLabel}
        </div>
        <div class="hero__unit">DEGREES FAHRENHEIT</div>
        {latest_sample === null && <div class="hero__delta">awaiting sensor data</div>}
      </section>

      {pairing && <PairPhoneOverlay onClose={() => setPairing(false)} />}
    </main>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `cd web/frontend && bun run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/frontend/src/app.tsx web/frontend/src/views/idle-screen.tsx web/frontend/src/views/hero-number.tsx
git commit -m "feat(web): wire auth into App + Pair-a-phone control"
```

---

## Task 7: Frontend — styles for pair screen + overlay

**Files:**
- Modify: `web/frontend/src/styles.css`

- [ ] **Step 1: Append pairing styles to `web/frontend/src/styles.css`**

Add before the `@media (max-width: 640px)` block (so the portrait block can
still override if needed):

```css
/* Pair screen (unauthenticated) */
.pair {
  position: relative; z-index: 1;
  align-self: center;
  max-width: 520px;
  margin: 0 auto;
}
.pair__title { font-size: 40px; font-weight: 700; margin: 0 0 24px; }
.pair__steps { color: var(--ink-soft); font-size: 17px; line-height: 1.7; padding-left: 22px; }
.pair__steps b { color: var(--ink); }

/* "Pair a phone" header button — quiet, sits next to the status text. */
.hero__pair {
  appearance: none;
  background: transparent;
  color: var(--ink-soft);
  border: 1px solid var(--bg-3);
  border-radius: 999px;
  padding: 6px 14px;
  font-family: inherit;
  font-size: 11px;
  letter-spacing: 2px;
  cursor: pointer;
  transition: color 120ms ease, border-color 120ms ease;
}
.hero__pair:hover { color: var(--ink); border-color: var(--ink-soft); }

/* QR overlay */
.overlay {
  position: fixed; inset: 0; z-index: 10;
  background: rgba(0, 0, 0, 0.72);
  display: grid; place-items: center;
}
.overlay__card {
  background: var(--bg-2);
  border: 1px solid var(--bg-3);
  border-radius: 18px;
  padding: 32px;
  text-align: center;
  display: grid; gap: 14px; justify-items: center;
}
.overlay__title { margin: 0; font-size: 24px; font-weight: 600; }
.overlay__hint { margin: 0; color: var(--ink-soft); font-size: 14px; }
.overlay__err { margin: 0; color: var(--signal); font-size: 13px; }
.overlay__qr { width: 320px; height: 320px; border-radius: 10px; background: #fff; }
.overlay__close {
  appearance: none;
  margin-top: 6px;
  background: var(--signal);
  color: var(--bg);
  border: 0; border-radius: 999px;
  padding: 12px 32px;
  font-family: inherit; font-weight: 600; font-size: 15px;
  letter-spacing: 2px; cursor: pointer;
}
```

Then, inside the existing `@media (max-width: 640px)` block, append a rule so
the QR fits a phone:

```css
  .overlay__card { padding: 24px; }
  .overlay__qr { width: 260px; height: 260px; }
  .pair__title { font-size: 30px; }
```

- [ ] **Step 2: Typecheck (CSS has no compile step; lint the frontend)**

Run: `cd web/frontend && bun run lint`
Expected: PASS (tsc unaffected by CSS, but confirms nothing else broke).

- [ ] **Step 3: Commit**

```bash
git add web/frontend/src/styles.css
git commit -m "feat(web): styles for pair screen + QR overlay"
```

---

## Task 8: E2E — pair before the firing flow

**Files:**
- Modify: `web/frontend/playwright.config.ts`
- Modify: `web/frontend/tests/e2e/dashboard.spec.ts`

- [ ] **Step 1: Give the Playwright backend a fixed bootstrap token**

In `web/frontend/playwright.config.ts`, the backend `webServer` entry needs a
known bootstrap token so the test can pair. Change that entry from:

```typescript
    {
      command: "cd ../backend && uv run flask --app udcpine_backend.app:create_app run --port 5001",
      url: "http://127.0.0.1:5001/api/state",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
```

to:

```typescript
    {
      command: "cd ../backend && uv run flask --app udcpine_backend.app:create_app run --port 5001",
      url: "http://127.0.0.1:5001/api/state",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { UDCPINE_BOOTSTRAP_TOKEN: "e2e-bootstrap-token" },
    },
```

Note: the `url` readiness check hits `/api/state`, which is now gated and
returns 401 before pairing. Playwright's `webServer.url` check treats **any**
HTTP response (including 401) as "server is up" — a 401 still means Flask is
listening — so this continues to work. (If a future Playwright version
requires 2xx, switch this to a dedicated unauthenticated health route.)

- [ ] **Step 2: Update `web/frontend/tests/e2e/dashboard.spec.ts`**

The spec must pair before it can see the dashboard. Replace the file with:

```typescript
import { test, expect } from "@playwright/test";

const BOOTSTRAP = "e2e-bootstrap-token";

/**
 * Full firing loop, now behind auth:
 *   pair (bootstrap token) → idle → START → live temp climbs → STOP → idle
 *
 * The test pairs by visiting `/?t=<bootstrap>`, exactly as a human opens
 * the link the server prints to its console. The bootstrap token is fixed
 * for tests via UDCPINE_BOOTSTRAP_TOKEN (see playwright.config.ts).
 */
test("pair → start → live temp climbs → stop → idle", async ({ page }) => {
  // --- pair via the bootstrap link ---------------------------------------
  await page.goto(`/?t=${BOOTSTRAP}`);

  // --- idle --------------------------------------------------------------
  const startButton = page.getByRole("button", { name: "START FIRING" });
  await expect(startButton).toBeVisible();

  // --- start -------------------------------------------------------------
  await startButton.click();
  await expect(page.getByText(/FIRING #\d+ · ACTIVE/)).toBeVisible();
  const stopButton = page.getByRole("button", { name: "stop firing" });
  await expect(stopButton).toBeVisible();

  // --- live temperature climbs ------------------------------------------
  await expect
    .poll(
      async () => {
        const text = (await page.locator(".hero__num").textContent()) ?? "";
        const n = Number(text.trim());
        return Number.isFinite(n) ? n : 0;
      },
      { timeout: 25_000, message: "hero temperature should climb past 80°F" },
    )
    .toBeGreaterThan(80);

  // --- stop --------------------------------------------------------------
  await stopButton.click();
  await expect(page.getByRole("button", { name: "START FIRING" })).toBeVisible();
});

/**
 * An unpaired device (no ?t=, no cookie) gets the pair screen, not the
 * dashboard — proves the auth gate actually gates.
 */
test("unpaired device sees the pair screen", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("This device isn't paired")).toBeVisible();
  await expect(page.getByRole("button", { name: "START FIRING" })).toHaveCount(0);
});
```

- [ ] **Step 3: Run the e2e suite**

Run: `make e2e`
Expected: 4 passed — 2 tests × 2 projects (chromium + mobile-chromium).

The bootstrap token is reusable, so each test (fresh browser context, no
cookie) re-pairs cleanly; the two projects against one server do not
collide.

- [ ] **Step 4: Commit**

```bash
git add web/frontend/playwright.config.ts web/frontend/tests/e2e/dashboard.spec.ts
git commit -m "test(web): e2e pairs via bootstrap token before the firing flow"
```

---

## Task 9: End-to-end verification

**Files:** none — verification only.

- [ ] **Step 1: Full local gate**

```bash
make build && make codegen && make lint && make test && make e2e
```
Expected: all green; `git status` clean. `make test` = 19 shared + 38 backend;
`make e2e` = 4 passing.

- [ ] **Step 2: Manual flow — bootstrap + the laptop**

Run `make dev`. In the backend output, find the printed line:
`🔑  Pair this device:  http://localhost:5173/?t=<token>`. Open that URL in
a desktop browser. Expected: it exchanges silently, the `?t=` disappears
from the address bar, and the idle dashboard renders.

Open a fresh private/incognito window at `http://localhost:5173/` (no
cookie). Expected: the "This device isn't paired" screen, no START button.

- [ ] **Step 3: Manual flow — pair a phone**

In the paired desktop window, click **PAIR A PHONE**. A QR overlay appears.
On a real phone on the same wifi, scan it with the camera. Expected: the
phone opens the dashboard already paired (the `?t=` exchange runs on load);
START/STOP and the live temperature all work from the phone.

- [ ] **Step 4: Negative check — the gate is real**

With `make dev` running:
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5001/api/state
```
Expected: `401` (no cookie). Then exchange and retry:
```bash
curl -s -c /tmp/jar.txt -X POST http://localhost:5001/api/auth/exchange \
  -H 'content-type: application/json' \
  -d "{\"token\":\"<token-from-the-console-line>\"}"
curl -s -b /tmp/jar.txt -o /dev/null -w "%{http_code}\n" http://localhost:5001/api/state
```
Expected: `200`. Remove `/tmp/jar.txt` after.

- [ ] **Step 5: Done — no commit.**

After the PR is pushed, confirm CI's `e2e` job runs 4 tests and passes.

---

## Self-review checklist

- [ ] Every file in File Structure has a creating or modifying task.
- [ ] No "TBD"/"TODO"/"implement later" in any task body.
- [ ] `AuthStore` stores only hashes — Task 2's `test_raw_token_is_not_stored` enforces it.
- [ ] The auth gate exempts exactly one route (`POST /api/auth/exchange`); `/api/auth/pairing` is gated so only paired devices mint.
- [ ] `create_app` signature is `create_app(store=None, auth=None)` — used consistently by Task 3's app code and the Task 3 test fixtures.
- [ ] The bootstrap token is env-overridable (`UDCPINE_BOOTSTRAP_TOKEN`) so CI/e2e can fix it; the e2e config sets `e2e-bootstrap-token` and the spec uses the same string.
- [ ] Wire types `ExchangeRequest`/`PairingToken` go through the full bridge (Zod → codegen → Pydantic → contract tests).
- [ ] Frontend distinguishes 401 (`UnauthorizedError` → `PairScreen`) from other errors (→ error text).
- [ ] The `?t=` token is stripped from the URL after exchange (`history.replaceState`).
- [ ] No EventSource is opened while unpaired — `useLiveState` mounts only inside `Live`, which renders only after a successful `fetchState`.
- [ ] Cookie is `HttpOnly` + `SameSite=Lax`, not `Secure` (HTTP LAN) — documented as a Pi-deployment follow-up.
- [ ] CLAUDE.md workflow respected: completion is push + PR; no destructive GitHub writes.
```

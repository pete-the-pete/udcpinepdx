# Pi browser access via laptop on the LAN

## Context

The Raspberry Pi (full desktop OS, Chrome, no camera) needs to load the
udcpine web UI. Long-term Flask will run on the Pi itself; for now the laptop
hosts everything and the Pi opens a URL in its browser. Both are on the same
Wi-Fi, so no tunnel is needed — the Pi reaches the laptop by mDNS hostname.

Two needs: a single stable URL the Pi can hit, and a way to authorize the Pi
without the camera-based QR pairing flow.

## Key discovery that shaped the approach

The mechanism we needed already existed. The **bootstrap token**
(`auth_store.py`) is reusable and never consumed, and the frontend already
reads `?t=<token>` from the URL, exchanges it for a long-lived cookie, and
strips it from history (`app.tsx`). So the "pre-approved secret URL" is just
the bootstrap link with a fixed, human-typeable value. No new auth code, no
token table, no CLI — the earlier draft of this plan over-engineered it
(it also wrongly assumed a persisted token table; auth is in-memory).

Decisions (confirmed with Pete):
- **Auth:** reuse the bootstrap token. Set `UDCPINE_BOOTSTRAP_TOKEN` to a
  short value (e.g. `1234abcdef`); the Pi URL is `/?t=1234abcdef`.
- **Restart handling:** the Pi keeps the `?t=` URL as its homepage. Auth is
  in-memory; after a laptop restart, reopening the bookmark silently
  re-authorizes. Persisting sessions is out of scope.

## What was built

### 1. Single-origin SPA serving (`web/backend/.../app.py`)
- `create_app` gained a `frontend_dist` param (defaults to
  `web/frontend/dist`, overridable via `UDCPINE_FRONTEND_DIST`).
- Routes: `GET /` → `index.html`; `GET /<path>` → real asset if it exists,
  else SPA fallback to `index.html`; unknown `/api/*` → JSON 404.
- `/api/*` stays gated by the existing `_require_auth`; SPA + assets are open.
- In dev (no `dist/`) these 404 and Vite (`:5173`) serves the SPA as before.

### 2. Bootstrap link fix (`app.py`)
- The startup banner now prints the single-origin LAN URL
  (`http://<lan-ip>:5001/?t=<token>`) instead of the old Vite `:5173` link,
  and honors `UDCPINE_BOOTSTRAP_TOKEN`.

### 3. Run targets
- `make serve` → `web-frontend-build` then `web-backend-serve`
  (`flask run --host=0.0.0.0 --port 5001`, no debugger).

### 4. Docs (`ops/README.md`)
- Laptop steps, Pi steps, the kiosk URL, restart behavior, security note.

### Tests (`web/backend/tests/test_api.py`)
- `spa_client` fixture builds a fake `dist/`; covers root → index, real asset
  served, unknown path → SPA fallback, unknown `/api/*` → 404.

## Verification (done)
- 68 backend tests pass; ruff clean.
- `bun run build` produces `dist/`; Flask on `0.0.0.0:5001` serves `/`,
  `/assets/*`, SPA fallback (all 200); `/api/state` 401 without cookie, 200
  after exchanging `1234abcdef`; bad token 401; startup banner prints the
  LAN kiosk URL.

## Open items deferred
- CLAUDE.md tech-stack section says tRPC TS backend; the real backend is
  Flask. Separate reconciliation plan.
- Pi-side firmware (sensord, thermocouple). `plans/firmware/`.
- Eventual Flask-on-Pi deployment + real hostname/TLS, and per-device
  revocation if one shared bootstrap token stops being enough.

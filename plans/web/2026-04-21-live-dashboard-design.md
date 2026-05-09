# Live Dashboard Web App — Design

## Context

The live dashboard is the interactive web UI served from the pizza oven's
Raspberry Pi Zero 2 during a firing. It drives the touch screen on the oven
door and is accessible from a phone on the same LAN. It records temperature,
tracks per-pizza cook times within a firing, persists session data locally,
and mirrors per-lap progress to Google Drive.

A separate, heavily curated static blog (hosted via GitHub Pages) is explicitly
**out of scope for this plan**. Blog posts are authored by hand from Drive
data; nothing in the live app auto-publishes anything.

## Conscious revisions to the bootstrap plan

The bootstrap plan (`plans/2026-04-13-bootstrap.md`) locked in two
commitments that this design explicitly overrides, with reasons:

1. **"The Pi has NO local webserver."** This plan runs Flask on the Pi.
   Reason: the oven needs to work when the home internet is down, and a
   LAN-only controller (with the laptop as a swappable fallback host) is
   more resilient and more interesting to build. Learning goal #2
   (Pi + home electronics + networking) benefits significantly.
2. **"Backend is TypeScript + tRPC + Zod."** This plan uses Flask (Python)
   as the backend. Reason: the backend now runs on the Pi where
   TypeScript is disallowed. End-to-end type safety (learning goal #4) is
   preserved via the JSON-Schema → Zod + Pydantic bridge already planned
   in `plans/shared/` — the bridge now validates a Flask/JSON wire contract
   instead of a tRPC one, which is a strict subset of the same learning.

All other bootstrap commitments stand: monorepo, Python-only on the Pi
(no Node runtime on the device; Vite builds happen on the laptop), JSON
Schema as the shared source of truth.

## Top-level architecture

```
┌─────────────────────────────── Raspberry Pi Zero 2 ───────────────────────────────┐
│                                                                                   │
│  ┌─────────────────┐       ┌──────────────────────────────────────────────────┐   │
│  │ sensord         │       │              Flask app  (:5000)                  │   │
│  │ (Python)        │──ipc──▶  GET  /           → SPA shell                    │   │
│  │  thermocouple   │       │  GET  /api/state  → current firing JSON          │   │
│  │  1 Hz sampling  │       │  POST /api/firing/start|stop                     │   │
│  └─────────────────┘       │  POST /api/pizza/start|end                       │   │
│          │                 │  GET  /api/stream → SSE (temp + state events)    │   │
│          ▼                 │  GET  /pair       → QR for phone pairing         │   │
│   ┌──────────────┐         │  POST /api/auth/exchange                         │   │
│   │  SQLite      │◀────────┤  In-process: current firing + ring buffer        │   │
│   │  sessions.db │         │  Auth: token cookie OR origin=localhost          │   │
│   └──────────────┘         │  Drive uploader: background worker + retry queue │   │
│                            └──────────────────────────────────────────────────┘   │
│                                                      │                            │
│                                                      ▼ (async)                    │
│                                               Google Drive API                    │
│                                                                                   │
│  ┌─────────────────────────────── Chromium kiosk ───────────────────────────────┐ │
│  │  localhost:5000  → Preact SPA (Dashboard / Chef screensaver)                 │ │
│  └──────────────────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────────────┘
             ▲                                                ▲
             │ http://pizza.local:5000  (mDNS/Avahi)          │
             │ token cookie required                          │
     ┌───────┴──────┐                                 ┌───────┴──────┐
     │ Your phone   │                                 │ Laptop (dev) │
     │ (Preact SPA) │                                 │ same SPA     │
     └──────────────┘                                 └──────────────┘
```

### Processes on the Pi

- **`sensord`** — Python daemon, owns the thermocouple SPI bus. Samples
  at ~1 Hz, writes to SQLite, notifies Flask via IPC. Kept separate from
  Flask so sensor reads are not coupled to web-request load and so Flask
  can be restarted mid-firing without interrupting sampling. Future
  hardware (camera, GPIO) also lives here.
- **`web`** — Flask app. Owns current-firing in-memory state, REST endpoints,
  SSE stream, the Drive uploader (background thread), and serves the
  pre-built Preact bundle. Single writer to the SQLite tables that
  describe firings/pizzas/queue.
- **`kiosk`** — Chromium in kiosk mode pointed at `localhost:5000`,
  autostarted by a systemd unit.

The touch screen runs the same Preact SPA the phone runs, off `localhost`.
URL/UA-based tweaks can give each surface a slightly different emphasis,
but the codebase is one.

### Fallback host property

"The server" is a host on the LAN running Flask. If the Pi Zero 2 ever
proves inadequate (e.g. once camera + CV enter scope), the same Flask app
runs on the laptop unchanged; deployment target is a config, not an
architecture. This property is load-bearing for scope decisions below.

### Repo layout

```
web/
  backend/
    app.py
    sensord.py
    drive_uploader.py
    hardware/
      thermocouple.py        -- real SPI driver
      mock.py                -- MockThermocouple (our code)
    drive/
      client.py              -- real Google Drive client
      mock.py                -- MockDriveClient (our code)
  frontend/
    src/
    vite.config.ts
  deploy/
    systemd/
    avahi/
    kiosk/
```

## Data flow

### Flow A — Live temperature and stopwatch (continuous path)

```
sensord  ─1Hz─▶  SQLite(samples)  ─notify─▶  Flask in-memory ring buffer
                                                │
                                                ├─▶ SSE /api/stream ──▶ Kiosk browser
                                                └─▶ SSE /api/stream ──▶ Phone browser
```

Stopwatch is computed client-side from the server-owned `firing.started_at`
and `pizza.started_at` timestamps. The SSE stream pushes temperature samples
and state transitions only — clients render their own ticking clocks.

### Flow B — User action (Start firing / Next pizza / Stop)

```
Phone or kiosk click
    ▼
POST /api/...                         (auth: cookie OR origin=localhost)
    ▼
Flask:  append row to SQLite
        update in-memory firing state
        broadcast typed LiveEvent on SSE stream
    ▼
Every connected client updates its UI
```

SSE is read-only (server → client); writes are plain `fetch()` POSTs. This
is a deliberate simplification — WebSockets would buy us nothing here.

### Flow C — Per-lap upload to Google Drive

```
POST /api/pizza/end returns 200 immediately
    ▼
Enqueue (firing_id, kind) into SQLite upload_queue
    ▼
drive_uploader worker (background thread, periodic tick)
    ├─ find-or-create Drive folder "Pizza Oven/<YYYY-MM-DD> Firing <N>"
    ├─ upload/overwrite session.json
    ├─ append to temps.csv
    └─ mark queue entry done, or backoff + retry on error
```

**SQLite is authoritative; Drive is a mirror.** The UI never blocks on Drive.
A failed upload stays queued and retries; Pi reboots do not lose pending work.

### Flow D — Phone pairing (one-time per phone)

```
Kiosk: "Pair phone" ─▶ Flask mints fresh token ─▶ QR of
                                                    http://pizza.local:5000/?t=<token>
Phone: scans QR ─▶ opens URL ─▶ frontend reads ?t= ─▶
       POST /api/auth/exchange ─▶ server sets HttpOnly cookie, invalidates token
Subsequent visits: cookie auto-auths
```

- Tokens are one-shot: exchanged for a cookie, then invalidated.
- `localhost` requests (the kiosk) skip auth entirely.
- **Cookie deleted or expired → re-pair.** Any 401 response from the
  frontend redirects to `/pair`, which the kiosk renders as a fresh QR.
  Re-scan and a new cookie is issued. "New phone" and "same phone, new
  cookie" use the same flow; old `paired_device` rows linger and can be
  pruned later.
- Per-phone revocation UI is deferred to polish (Product 5).

## Data model

### SQLite tables

```
firing
  id              INTEGER PK
  started_at      TEXT (ISO8601)
  ended_at        TEXT | NULL
  status          TEXT         -- 'active' | 'ended'

pizza
  id              INTEGER PK
  firing_id       INTEGER FK → firing.id
  seq             INTEGER
  started_at      TEXT
  ended_at        TEXT | NULL  -- NULL while currently cooking
  UNIQUE(firing_id, seq)

sample
  firing_id       INTEGER FK
  t               TEXT         -- ISO8601, 1 Hz
  temp_c          REAL
  PRIMARY KEY (firing_id, t)

upload_queue
  id              INTEGER PK
  firing_id       INTEGER FK
  status          TEXT         -- 'pending' | 'done' | 'failed'
  attempts        INTEGER DEFAULT 0
  last_error      TEXT
  next_try_at     TEXT
  created_at      TEXT
  -- Each entry means "sync firing_id's Drive state to current truth."
  -- The worker performs the full upload set (session.json + temps.csv,
  -- and future photos) atomically per entry. No per-artifact rows.

auth_token
  id              INTEGER PK
  token_hash      TEXT UNIQUE
  created_at      TEXT
  used_at         TEXT | NULL
  expires_at      TEXT

paired_device
  id              INTEGER PK
  cookie_hash     TEXT UNIQUE
  label           TEXT
  created_at      TEXT
  last_seen_at    TEXT
  revoked_at      TEXT | NULL
```

Notes:

- Samples are row-shaped, not JSON blobs. 1 Hz × 2 h ≈ 7,200 rows per firing —
  trivial for SQLite, enables range queries and downsampling without parsing.
- Only hashes of tokens and cookies are stored, never raw values.
- `pizza.ended_at = NULL` means "currently cooking." The one-at-a-time
  invariant is enforced at the application layer.
- SQLite runs in **WAL mode** from day one. Enables safe `rsync` while writes
  are in flight and improves concurrency.

### Wire types (JSON-Schema → Zod + Pydantic)

```
Firing   { id, started_at, ended_at, status }
Pizza    { id, firing_id, seq, started_at, ended_at }
Sample   { t, temp_c }

FiringState
  firing_id | null
  started_at | null
  pizzas: Pizza[]
  current_pizza: Pizza | null
  latest_temp_c: number | null

LiveEvent                 -- SSE payload, discriminated union
  { type: 'sample',          t, temp_c }
  { type: 'firing_started',  firing: Firing }
  { type: 'firing_ended',    firing_id }
  { type: 'pizza_started',   pizza: Pizza }
  { type: 'pizza_ended',     pizza: Pizza }

StartFiringRequest  { }
StartPizzaRequest   { }
EndPizzaRequest     { }
EndFiringRequest    { }

DriveSessionJson
  firing: Firing
  pizzas: Pizza[]
  temps_downsampled: Sample[]   -- decimated; raw lives in temps.csv
  schema_version: string
```

Empty request types are kept as named shapes so the Zod/Pydantic bridge has
something to version and so future fields do not break the URL contract.

### Type-safety bridge

```
shared/schemas/*.json  (JSON Schema — source of truth)
   ├── codegen ──▶  shared/zod/*.ts        → frontend (Preact)
   └── codegen ──▶  shared/pydantic/*.py   → backend (Flask + sensord)
```

Both sides validate every message at runtime. Frontend parses every SSE event
through Zod; backend parses every POST body through Pydantic. Schema
mismatches are explicit errors, not mystery bugs. Exact codegen tooling
(`json-schema-to-zod`, `datamodel-code-generator`, `quicktype`, etc.) is
chosen in `plans/shared/`.

## Error handling and failure modes

- **Thermocouple read fails.** `sensord` logs, skips the sample. UI shows a
  "sensor disconnected" badge. Cooking continues — stopwatch and laps are
  independent of temperature. No auto-shutdown: the human is the safety loop.
- **Wi-Fi is down during a firing.** Expected, not exceptional. Local SQLite
  is unaffected. Drive queue fills; drains on reconnection. UI indicator only.
- **Drive auth expired / 401.** Uploader backs off exponentially; queue
  retains entries. UI surfaces a "reconnect Drive" nudge via
  `GET /api/drive/status`. Cook never blocks.
- **Flask crashes mid-firing.** systemd restarts it. On boot, Flask reattaches
  to any `status='active'` firing. SSE clients auto-reconnect and re-fetch
  `GET /api/state` once to resync. Stopwatch picks up from `started_at`.
- **Pi reboots mid-firing.** Same as Flask crash plus `sensord` restart. Temp
  samples have an honest gap covering downtime; no faked continuity.
- **Phone loses network.** SSE drops; UI shows "reconnecting"; browser
  auto-reconnects. On reconnect, frontend re-fetches `GET /api/state` once
  (SSE does not replay). POSTs attempted while offline fail; user retries.
  No offline write queue — the kiosk on the Pi is always an available
  control surface.
- **Concurrent "Next pizza" from two clients.** Backend rejects the second
  with 409. `pizza_started` SSE event disables the button on both within
  a second anyway.
- **Malformed SSE or POST payload.** Pydantic rejects POST with 400. Frontend
  logs and ignores malformed SSE events. Explicit `schema_version` bump
  triggers a "reload page" prompt rather than rendering partially.
- **Kiosk Chromium hangs.** systemd watchdog restarts it. Data unaffected.
- **SQLite corruption.** WAL mode makes this nearly impossible in normal
  operation. Recovery paths are the Drive mirror and `rsync` backups.

## Testing strategy

Three layers:

- **Contract tests (`shared/`).** Round-trip every wire type through Zod and
  Pydantic against fixture JSON. Both must accept the valid fixture; both
  must reject the corresponding invalid fixture. Catches schema drift.
- **Backend (pytest).** Unit tests for pure logic (stopwatch math, backoff,
  state machines). Integration tests against real SQLite (WAL, tmp or
  in-memory), `MockThermocouple`, `MockDriveClient` — full flows including
  crash recovery, concurrent laps, queue replay after restart.
- **Frontend (Vitest + Playwright).** Vitest for Zod parsers, reducer-like UI
  state, stopwatch rendering. Playwright for a kiosk smoke test: Flask
  against a canned SQLite fixture, load the SPA, assert graph renders and
  the Next-Pizza flow works.

Hardware is always mocked in tests. Real-hardware verification is a manual
step on the Pi after each Product ships.

`MockThermocouple` and `MockDriveClient` are our own code, not third-party
libraries — small (tens of lines each) test doubles that implement the
same interface as the real driver/client. They live alongside the real
implementations in `backend/hardware/mock.py` and `backend/drive/mock.py`,
and are selected via an env var or config so the same `app.py` runs against
either.

## Dev loop and deployment

### Dev on laptop

```
backend:  python -m flask run --debug         (Flask dev server :5000)
frontend: npm run dev                         (Vite :5173, proxies /api → :5000)
browser:  http://localhost:5173               (hot reload)
```

All backend logic runs against `MockThermocouple` and `MockDriveClient` by
default. Same codebase deploys to the Pi unchanged.

### Deploy to Pi

```
Laptop:                                        Pi:
  make build  (vite build, pytest, lint)       systemd units:
  make deploy (rsync + systemctl restart)        udcpine-web
                                                 udcpine-sensord
                                                 udcpine-kiosk
                                                 avahi-daemon
rsync targets:
  /opt/udcpine/backend
  /opt/udcpine/frontend-dist
preserved:
  /var/lib/udcpine/sessions.db
```

Top-level `make` targets the design assumes:

- `make build` — `vite build`, `pytest`, `ruff`, `eslint`, `tsc --noEmit`.
- `make deploy` — build + rsync current branch HEAD to the Pi + restart units.
- `make deploy TAG=v0.1.0` — checkout the tag, build, deploy.
- `make logs` — `ssh pi@pizza.local journalctl -fu 'udcpine-*'`.
- `make shell` — SSH to the Pi.

Properties:

- **Vite builds on the laptop.** No Node runtime on the Pi.
- **Data dir is separate from code dir.** Rollback is an `rsync` of a prior build.
- **`systemctl restart` mid-firing is safe.** Flask's recovery logic picks
  back up where it left off.
- **First-time Pi provisioning** (OS image, Avahi, systemd, display setup,
  Chromium kiosk config) is owned by `plans/ops/` and `plans/firmware/`.

### Versioning and releases

- **Semver git tags at product-ship moments.** Product 1 ships → `v0.1.0`,
  Product 2 ships → `v0.2.0`, polish/bugfix → patch bumps. Pre-1.0 means the
  contract isn't stable yet, which matches reality.
- **GitHub Releases** are cut from each tag, with auto-generated release
  notes (decision on tooling — `release-please`, manual `CHANGELOG.md`,
  etc. — owned by `plans/ops/`). Teaches goal #6.
- **Deploy reads from a tag for "real" cooks.** `make deploy TAG=v0.1.0`
  checks out the tag locally, builds from that tree, deploys. Day-to-day
  development uses bare `make deploy` against current branch HEAD.
- **No auto-deploy.** Tagging does not push code to the Pi; `make deploy`
  is always a deliberate human action.

### Data egress paths

Three independent ways to get data off the Pi, each covering a failure mode
the others do not:

- **Google Drive mirror.** Automatic, per-lap.
- **`rsync` over SSH.** Manual/scripted pull of `/var/lib/udcpine/`. WAL mode
  makes this safe even during an active cook.
- **`GET /api/export`** (Product 5). Token-cookie-authenticated zip or
  `.sqlite` download from the browser.

### CI (GitHub Actions)

On every PR:
- Schema codegen is up-to-date (regenerate, diff, fail if dirty).
- Contract tests pass.
- Backend pytest passes against mocks.
- Frontend Vitest + Playwright pass.
- Lint: `ruff`, `eslint`, `tsc --noEmit`.

No auto-deploy. Deployment is manual from the laptop.

## Product roadmap

Each product is an independently shippable increment. Ordered so every
step is useful on its own and the next builds on it.

1. **Live dashboard MVP.** Flask app, sensord, SQLite (WAL), live temp graph,
   stopwatch, Start/Stop/Next-Pizza, kiosk on `localhost`. No phone, no
   uploads, no animation. "Can I cook a pizza with it" bar.
2. **Phone as second screen.** mDNS (`pizza.local`), QR pairing flow,
   token cookie auth, responsive UI, SSE sync across devices.
3. **Google Drive persistence.** Drive OAuth (headless-Pi device flow),
   per-lap uploads, retry queue, `GET /api/drive/status`. Learning goal
   #3 (security) lives primarily here.
4. **Pizza chef screensaver.** Spritesheet-driven animation whose state is
   a function of live oven temperature. Pure browser-side; no server load.
   Tap to dismiss.
5. **Polish.** Session history view, per-firing edit affordances,
   `GET /api/export`, Pi kiosk boot config, network-loss UX,
   per-device revocation UI.
6. **[Deferred, future]** Camera integration. Photo per pizza, attached to
   the lap entry, uploaded to the firing's Drive folder. Parked as a
   future mega-enhancement.

## What this plan does NOT own

- Pi OS provisioning, display setup, Avahi install — `plans/ops/` + `plans/firmware/`.
- Thermocouple wiring and Python driver selection — `plans/firmware/`.
- JSON-Schema codegen tool selection — `plans/shared/`.
- GitHub Actions configuration specifics and branch protection — `plans/ops/`.
- The blog — out of scope entirely; manual and curated.

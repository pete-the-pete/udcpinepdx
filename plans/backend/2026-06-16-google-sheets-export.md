# Plan: Export a finished firing to Google Sheets

> Tracked by #61.

## Context

The pizza-oven backend (`web/backend/`, Flask + SQLite) records each **firing**
as a `firing` row plus its 1 Hz `sample` time-series and any `pizza` rows. Today
that data only lives in SQLite on the Pi and is visible on the live dashboard.
Pete wants each completed firing pushed to a **Google Sheet** so firings are
archived, shareable, and chartable outside the app. The original
`plans/web/2026-04-21-live-dashboard-design.md` anticipated a Drive uploader but
it was deferred and never built; this plan implements the Sheets path instead.

This is the first outbound third-party integration in the repo, and a learning
vehicle for **OAuth** (the security learning goal).

## Decisions (confirmed with Pete)

| Decision | Choice |
|---|---|
| **Auth to Google** | **OAuth installed-app ("Desktop app") flow**, consent screen set to **Internal** (treehouse.pro-only) so refresh tokens don't expire. *Service-account keys are blocked by the org policy `iam.disableServiceAccountKeyCreation`, so the keyless OAuth path is used instead.* Libraries: `gspread` + `google-auth` (runtime) and `google-auth-oauthlib` (one-time token mint). |
| **Trigger** | Automatic on `POST /api/firing/stop`. Fire-and-forget; export failure must never fail the stop. |
| **Content** | (1) `Firings` summary tab — one row per firing, (2) `Pizzas` tab — one row per pizza, (3) one `firing-<id>` detail tab per firing with the **full 1 Hz** temp series. |
| **Temp layout** | One detail tab per firing. |

## OAuth model (how the keyless auth works)

- A one-time **bootstrap on a laptop** runs the installed-app consent flow against
  an OAuth **Desktop** client, producing an `authorized_user.json` (contains a
  refresh token + the client id/secret, scope `.../auth/spreadsheets`).
- That file is copied to the Pi. At runtime the backend loads it, auto-refreshes
  the short-lived access token as needed, and never needs a browser again.
- Because the consent screen is **Internal** to the treehouse.pro Workspace, the
  refresh token does **not** hit the 7-day "Testing" expiry — it stays valid
  indefinitely. *(Teaching note: this is why Internal matters; an External app in
  Testing status would force re-consent weekly.)*
- `authorized_user.json` is a secret (holds the refresh token). It is `chmod 600`
  on the Pi and git-ignored, same handling a key file would get.

## Why no new shared JSON Schema

The codegen contract in `shared/` exists for **wire messages between our own
components** (Pi ↔ backend ↔ frontend), where both sides runtime-validate the
same shape. The Sheets export is **outbound to Google** — it never crosses our
own wire — so it reuses the existing generated `Firing`/`Sample`/`Pizza` Pydantic
models and defines row layouts as plain internal Python. Adding a JSON Schema
here would be ceremony for data that no second party of ours validates.

## Architecture

Keep the Google integration in one isolated, pure-as-possible module so the
network dependency is trivial to fake in tests and the app stays unaware of
gspread internals.

```
POST /api/firing/stop
  → store.stop_firing()                 # existing: flips status, broadcasts firing_ended (UI updates now)
  → gather firing + store.samples(id) + store.pizzas(id)
  → exporter.export_firing(firing, samples, pizzas)   # run off the request thread
  → 200 returns immediately
```

- **`SheetsExporter` protocol** with `export_firing(firing, samples, pizzas)`.
  Two implementations: the real `GspreadSheetsExporter` and a `FakeSheetsExporter`
  (records calls / simulates an in-memory workbook) for tests. Mirrors the
  `MockDriveClient`/mock-sensor test-double pattern the design doc already set.
- **Pure data in, I/O out.** The exporter receives already-fetched
  `Firing`/`list[Sample]`/`list[Pizza]` — it does not touch the `Store` or DB, so
  it's testable with no DB and no network.
- **Credential construction** is isolated in the factory:
  `Credentials.from_authorized_user_file(token, scopes=[...spreadsheets])`,
  refresh if expired, `gspread.authorize(creds)`.
- **Disabled-by-default.** If `UDCPINE_SHEETS_OAUTH_TOKEN` /
  `UDCPINE_SHEETS_SPREADSHEET_ID` are unset, the app wires a no-op exporter.
  Dev, CI, and a Pi without the token keep working unchanged.
- **Off the request thread.** Run the export in a daemon thread (reusing the
  existing background-thread pattern from the mock sensor) so a multi-thousand-row
  write doesn't stall the stop response or the SSE broadcast. In tests, inject an
  inline executor so assertions stay deterministic (no sleeps).

## Files

**New**
- `web/backend/src/udcpine_backend/sheets.py` — `SheetsExporter` protocol,
  `GspreadSheetsExporter`, `FakeSheetsExporter`, summary-computation helpers, and
  a `build_exporter_from_env()` factory returning a no-op when unconfigured.
- `web/backend/scripts/sheets_oauth_bootstrap.py` — one-time laptop script that
  runs the installed-app consent flow (`google-auth-oauthlib`) against the
  Desktop OAuth client and writes `authorized_user.json`. Not run on the Pi.
- `web/backend/tests/test_sheets.py` — exporter + summary unit/integration tests.

**Modified**
- `web/backend/pyproject.toml` — add deps `gspread`, `google-auth`,
  `google-auth-oauthlib`.
- `web/backend/src/udcpine_backend/app.py` — build the exporter at startup;
  after `store.stop_firing()`, gather data and submit to the exporter (guarded
  with try/except that **logs with firing id** and swallows — never re-raises into
  the stop response).
- `web/backend/tests/test_api.py` — assert stop triggers export when configured,
  no-ops when not, and that an exporter error still returns 200.
- `web/backend/.env.example` — document `UDCPINE_SHEETS_OAUTH_TOKEN` and
  `UDCPINE_SHEETS_SPREADSHEET_ID`.
- `.gitignore` — ignore `authorized_user.json` / token + client-secret files.

*No `Store` change needed:* `stop_firing()` already returns the `Firing`, and
`store.samples(id)` / `store.pizzas(id)` already exist
(`web/backend/src/udcpine_backend/store.py`).

## Workbook layout

Temperatures are Celsius in storage; the dashboard renders °F. The sheet carries
**°C as canonical with °F alongside** the headline numbers so it reads naturally.

- **`Firings`** (append one row per firing):
  `firing_id | started_at | ended_at | duration_min | sample_count | max_temp_c | max_temp_f | avg_temp_c | peak_temp_at | pizza_count | pizza_names`
- **`Pizzas`** (append one row per pizza):
  `firing_id | seq | name | started_at | ended_at | cook_duration_min`
- **`firing-<id>`** (one tab per firing, full series):
  `t | temp_c | temp_f` — created-or-replaced; rows written in a **single batched
  `update`/`append_rows` call** to stay within the Sheets ~60 writes/min quota.

Summary fields are computed in Python from the samples/pizzas lists — pure
functions, unit-tested.

## Error handling & idempotency

- Export runs after the firing-ended SSE has already broadcast, so the dashboard
  is current regardless of export outcome.
- All gspread/network calls are wrapped; failures `log.warning("sheets export
  failed for firing %s", id, exc_info=True)` and are dropped. Stop always returns 200.
- `firing-<id>` detail tab is keyed by firing id (create-or-replace), so a repeat
  is harmless. The `Firings`/`Pizzas` summary rows are append-only for v1;
  dedupe-on-id is deferred until a manual re-export endpoint exists (not in scope).

## One-time Google Cloud / OAuth setup (manual, human steps)

1. **Project + API** — at https://console.cloud.google.com create a project (e.g.
   `udcpine-sheets`); **APIs & Services → Library → Google Sheets API → Enable**.
2. **Consent screen** — **APIs & Services → OAuth consent screen** → **User type =
   Internal** → fill app name/support email → add scope
   `https://www.googleapis.com/auth/spreadsheets` → Save.
3. **OAuth client** — **Credentials → Create Credentials → OAuth client ID →
   Application type = Desktop app** → download the `client_secret_*.json`.
4. **Mint the token (laptop)** — run `web/backend/scripts/sheets_oauth_bootstrap.py`
   pointed at that client-secret file; a browser opens, you consent as your
   treehouse.pro user, and it writes `authorized_user.json`.
5. **Spreadsheet** — create a Google Sheet; copy its ID from the URL
   (`.../spreadsheets/d/<ID>/edit`). Because OAuth acts **as you**, no sharing
   step is needed — you already own it.
6. **Install on the Pi** — copy `authorized_user.json` to the Pi (`chmod 600`),
   set `UDCPINE_SHEETS_OAUTH_TOKEN=<path>` and `UDCPINE_SHEETS_SPREADSHEET_ID=<id>`.

## Verification

1. **Automated** (no network): `cd web/backend && uv run pytest` — covers
   - summary math (max/avg/duration/peak/counts) from a known sample list,
   - `FakeSheetsExporter` receives the right data and lays out the three tab types,
   - stop endpoint: triggers export when configured, no-ops when unconfigured, and
     returns 200 even when the exporter raises.
   Then `cd web/backend && uv run ruff check . && uv run ruff format --check .`
2. **Manual end-to-end** (real Sheet): complete the setup above, then
   `export UDCPINE_SHEETS_OAUTH_TOKEN=... UDCPINE_SHEETS_SPREADSHEET_ID=...
   UDCPINE_MOCK_SENSOR=1` and run `make dev`. `POST /api/firing/start`, let mock
   samples accumulate ~30 s, optionally `POST /api/pizza/next {"name":"Margherita"}`,
   then `POST /api/firing/stop`. Confirm a new `Firings` row, any `Pizzas` rows, and
   a `firing-<id>` tab with the full series.

## Out of scope / future

- Manual export / backfill endpoint + dashboard button (would add `firing_by_id`
  on the `Store` and summary-row dedupe).
- Downsampling option for the detail tab.
- Charts/formatting inside the Sheet.
- Retry queue for offline-Pi resilience (the deferred `upload_queue` idea).

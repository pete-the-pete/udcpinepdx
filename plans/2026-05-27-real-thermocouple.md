# Real thermocouple ingest (Pi → backend → SSE)

Cross-cutting: firmware + backend + ops.

## Context

The dashboard currently runs on a 1 Hz mock sample loop inside the backend (`web/backend/src/udcpine_backend/mock_sensor.py`). The wire shape (`Sample = { t, temp_f }`), persistence (SQLite `sample` table), and live fan-out (`/api/stream` SSE → `useLiveState`) are already in place. What's missing is the physical sensor: a Raspberry Pi 4 with a MAX6675 K-type thermocouple breakout reading the oven temperature and pushing samples to Flask over the LAN, plus the deploy story for getting that code onto the Pi.

The mock loop stays as the dev/test substrate — real samples flow through the same `store.publish_sample(temp_f)` call, so the backend doesn't care which source is producing them. The only new backend surface is one authenticated ingest endpoint and a flag to silence the mock when a real device is publishing.

## Decisions locked in this session

- **Chip:** MAX6675 (K-type, bit-bang SPI). Library: `adafruit-circuitpython-max6675`.
- **Channel:** HTTP POST per sample to `/api/ingest/sample`. Reuses Flask + existing schema. No broker. Plaintext on the LAN is accepted for v1 — TLS is a separate follow-up issue.
- **Wire unit:** °C end-to-end. Backend stores and emits Celsius; React converts to °F at render time.
- **Deploy:** Build on the Mac, rsync to the Pi. `make pi-deploy` runs `rsync -a --delete firmware/ pi@<host>:/opt/udcpine-firmware/` then `ssh pi@<host> 'sudo systemctl restart udcpine-firmware'`. No git on the Pi. First-time setup (SPI enable, user creation, systemd unit install) is done by hand on the device — `firmware/README.md` is the runbook, not a one-shot bootstrap script.
- **Auth:** **None on the ingest endpoint.** The LAN is the trust boundary. The dashboard itself already trusts the LAN (no per-request auth beyond the browser bootstrap); making ingest stronger than the UI it feeds is incoherent, and a bearer token over plaintext HTTP is theater anyway — anyone who can POST can also sniff the token. CSRF from a malicious webpage is blocked by Pydantic's `application/json` requirement (forces a preflight). If this ever leaves the LAN, the answer is a real reverse proxy with TLS, not a hand-rolled token.

## Architecture

```
[MAX6675] --SPI--> [Pi: udcpine-firmware.service]
                        │
                        │ HTTP POST /api/ingest/sample (1 Hz, no auth — LAN-trusted)
                        ▼
                   [Flask backend on laptop:5001]
                        │
                        │ store.publish_sample(temp_f)
                        ▼
                   [SSE /api/stream] → all browsers (Pi kiosk + phones)
```

## Work, by subsystem

### 1. Shared schema — `shared/src/`

Add one new wire type, regenerate Pydantic.

- **New:** `shared/src/ingest-sample.ts` — `IngestSampleRequest = { temp_c: number, t?: string (ISO 8601) }`. Server fills `t` if absent.
- **Change:** `Sample` switches from `temp_f` to `temp_c`. No real data exists yet, so the SQLite `sample` table column is renamed (or dropped/recreated) in the same change.
- Re-export from `shared/src/index.ts`.
- Run `make codegen` in `shared/` to regenerate `shared/generated/pydantic/__init__.py`.

Reuse existing `Sample` schema for the persisted/emitted shape — don't fork it.

#### °F → °C migration checklist

`temp_f` is hardcoded well beyond the schema. Every file below changes in the same PR as the schema flip, or the build breaks / chef widget stops reacting:

- **Backend**
  - `web/backend/src/udcpine_backend/mock_sensor.py` — rename `ramp_temp_f` and convert all ramp constants to °C.
  - `web/backend/src/udcpine_backend/store.py` — argument and column references.
  - `web/backend/src/udcpine_backend/schema.sql` — column rename.
  - `web/backend/tests/test_store.py` — literals (`847.0`, `275.0`, `[70, 120, 300]`).
  - `web/backend/tests/test_mock_sensor.py` — `pytest.approx(850.0)` and related.
- **Frontend** — React converts °C → °F at render time; everything below that consumes the wire value flips to °C internally.
  - `web/frontend/src/reduce.ts`
  - `web/frontend/src/views/hero-number.tsx` (display formats °F from a °C source)
  - `web/frontend/src/chef/chef.manifest.json` — **deliberate °C thresholds**, not mechanical conversion. Decide explicit values for each state transition.
  - `web/frontend/src/chef/state-machine.ts`, `manifest.ts`, `ChefWidget.tsx`, `demo.tsx`
- **Fixtures**
  - `shared/tests/fixtures/sample/**` (including `invalid/string-temp.json` if it keys on field name)
  - `shared/tests/fixtures/livestate/**`

Chef thresholds in particular are a design choice, not a unit conversion — `400°F → ~204°C` is the mechanical answer, but pick the rounded °C number that reads cleanly on the manifest.

### 2. Backend — `web/backend/src/udcpine_backend/`

- **`app.py`** — add `POST /api/ingest/sample`:
  - Validate body with the new generated `IngestSampleRequest` Pydantic model. Pydantic enforces `application/json`, which also forces a CSRF preflight and blocks trivial cross-origin POSTs.
  - No auth. LAN is the trust boundary; see "Decisions locked in this session" above.
  - Call `store.publish_sample(body.temp_c)` (rename arg to match; the function now takes °C).
  - Return `204 No Content`. No body needed; latency matters.
- **Request size limit:** validate per-route (reject bodies > 1 KB inside the ingest handler). Do **not** set Flask's global `MAX_CONTENT_LENGTH` — it would bite future camera/config-push routes. A valid `IngestSampleRequest` is ~60 bytes. No rate limit — one device at 1 Hz doesn't need it.
- **`mock_sensor.py`** — gate the background thread on `UDCPINE_MOCK_SENSOR`. Default off; set `UDCPINE_MOCK_SENSOR=1` to enable. Tests set it explicitly. Publishes °C.
- **Tests** — add to existing pytest suite:
  - `POST /api/ingest/sample` happy path → 204, sample appears in `/api/state.latest_sample` and is emitted over SSE.
  - Malformed body → 422.
  - Wrong content-type → 415 (confirms the CSRF-by-preflight assumption is real, not aspirational).

### 3. Firmware — `firmware/` (new directory)

```
firmware/
├── pyproject.toml          # uv-managed, mirrors backend conventions
├── src/udcpine_firmware/
│   ├── __init__.py
│   ├── main.py             # entry point: udcpine-firmware
│   ├── sensor.py           # MAX6675 read loop + fake for tests
│   ├── uploader.py         # HTTP client with backoff
│   └── config.py           # loads /etc/udcpine/device.env
├── systemd/
│   └── udcpine-firmware.service
├── tests/
│   ├── test_sensor.py      # uses FakeSensor
│   └── test_uploader.py    # uses requests-mock or responses
└── README.md               # wiring diagram + install steps
```

Behavior:
- **Sample loop:** 1 Hz. MAX6675 needs ~220 ms between reads, so 1 Hz is the natural ceiling. Reads `temp_c` from the library and sends it as-is.
- **Error handling:** open-thermocouple / SPI fault → log, skip sample, don't crash. The dashboard already handles missing samples (`latest_sample: null`).
- **Network:** `requests` with short timeout (2 s) and one retry. POSTs run on a dedicated worker thread fed by a `queue.Queue`; the sample loop never blocks on the network. On failure, sample goes into an in-memory `deque(maxlen=120)` and is drained **newest-first** on the next successful POST — old samples are dropped rather than replayed, so the dashboard never visually rewinds after an outage. Buffer is intentionally small (~2 min) and lossy past that. No disk persistence.
- **Config** — no secrets, so no `device.env`. Server URL and sample rate are passed as CLI flags in the systemd unit:
  ```
  ExecStart=/opt/udcpine-firmware/.venv/bin/udcpine-firmware \
      --server http://<laptop-ip>:5001 \
      --hz 1
  ```
  If a config file is ever needed (multiple knobs, or values that change per Pi), put it in `/opt/udcpine-firmware/config.toml` and rsync it from the Mac alongside the binary.
- **`--simulate` flag:** generates synthetic samples instead of reading the SPI bus. Lets the whole pipeline be exercised end-to-end on the laptop with no Pi.
- **systemd unit:** `Restart=always`, `RestartSec=5`, runs as a non-root `udcpine` user that's in the `spi` and `gpio` groups. Working directory `/opt/udcpine-firmware/`. No `EnvironmentFile`.

Reuse-first notes:
- Don't introduce a new HTTP client library. `requests` is fine and already familiar.
- Don't introduce a queue/persistence layer for samples. Drop-on-failure is the right v1.

### 4. Ops — Makefile + docs

- **Root `Makefile`** — add:
  - `pi-build`: Mac-side build. `uv build` (or `uv sync --frozen` + tar the resulting tree) into `firmware/dist/`. Cheap; idempotent.
  - `pi-deploy`: depends on `pi-build`. `rsync -a --delete firmware/dist/ $(PI_HOST):/opt/udcpine-firmware/` then `ssh $(PI_HOST) 'sudo systemctl restart udcpine-firmware'`.
  - `pi-logs`: `ssh $(PI_HOST) 'journalctl -u udcpine-firmware -f'`.
  - **No `pi-bootstrap` target.** First-time setup is hands-on — Pete will be on the device for SPI/wiring anyway. The runbook lives in `firmware/README.md`.
- **`firmware/README.md`** — manual first-time setup runbook:
  - Wiring (MAX6675 SO/SCK/CS to Pi GPIO 9/11/8, plus 3.3V + GND).
  - **Cold-junction warning** (see hardware section below).
  - Enable SPI (`sudo raspi-config` → Interface Options → SPI, or `dtparam=spi=on` in `/boot/config.txt`).
  - Confirm `/dev/spidev*` is readable by the `spi` group (some Pi OS images grant only `gpio`; add a `udev` rule or add `udcpine` to the right group as needed).
  - Create the `udcpine` user, add to `spi` + `gpio` groups.
  - `mkdir -p /opt/udcpine-firmware && chown udcpine:udcpine /opt/udcpine-firmware`.
  - Install the systemd unit (`sudo cp firmware/systemd/udcpine-firmware.service /etc/systemd/system/` from a one-time clone or scp, `systemctl daemon-reload`, `systemctl enable udcpine-firmware`).
  - First deploy: `make pi-deploy PI_HOST=pi@<host>` from the Mac.

#### Hardware mounting — cold-junction warning

The MAX6675 IC sits on the breakout board, not at the probe tip. The IC's operating range tops out around 85°C ambient. In a chiminea context that means:

- **Only the K-type probe wire enters the firebox.** The breakout board stays outside the insulated door, in ambient air.
- Route the probe lead through a strain-relieved penetration; keep the breakout board mounted somewhere the door's exterior surface temperature stays well under 85°C during a full burn.
- If readings drift upward when the oven is hot but the probe is cool (e.g. you pull it out and the number keeps climbing), that's the cold-junction IC cooking — re-mount further from the heat.

This is the most likely v1 surprise. Call it out in `firmware/README.md` with the wiring diagram, not as a footnote.

#### Dashboard visibility for a wedged Pi

`/api/health` is still out of scope, but a stalled sample stream looks identical to "idle oven" on the dashboard. Mitigation in v1: frontend already has `latest_sample`; add a derived "last sample age" in `reduce.ts` and surface a subtle stale indicator on the hero number when age > 10 s. (Tiny change, big diagnostic payoff. Goes in the shared+backend ticket since it's a frontend-only addition reading existing state.) Firmware-side, network failures already log via `requests` exception output, visible in `make pi-logs`.

## Critical files to touch

| Path | Change |
|---|---|
| `shared/src/ingest-sample.ts` | new |
| `shared/src/index.ts` | export new type |
| `web/backend/src/udcpine_backend/app.py` | new route (no auth) |
| `web/backend/src/udcpine_backend/mock_sensor.py` | env-gate startup |
| `web/backend/tests/test_ingest.py` | new |
| `firmware/**` | new subsystem |
| `Makefile` | new pi-* targets |

## Verification

End-to-end, no hardware:
1. `make codegen` in `shared/` — Pydantic regenerates without errors.
2. `UDCPINE_MOCK_SENSOR=0 make serve` — backend starts, mock loop silent, `/api/state.latest_sample` is `null`.
3. In another terminal: `cd firmware && uv run udcpine-firmware --simulate --server http://localhost:5001` — sim posts 1 Hz.
4. Open `http://localhost:5001/?t=<bootstrap>` — `HeroNumber` should tick at 1 Hz.
5. `curl -X POST http://localhost:5001/api/ingest/sample -H 'Content-Type: application/json' -d '{"temp_c":260}'` → 204.
6. `curl -X POST http://localhost:5001/api/ingest/sample -H 'Content-Type: text/plain' -d 'temp_c=260'` → 415 (confirms the CSRF-by-preflight assumption).
7. Backend pytest: `cd web/backend && uv run pytest tests/test_ingest.py` — green.
8. Firmware pytest: `cd firmware && uv run pytest` — green (uses FakeSensor).

End-to-end, with hardware (separate session, after merge):
1. Wire MAX6675 to the Pi per `firmware/README.md` (heed the cold-junction warning).
2. Follow the manual setup runbook in `firmware/README.md` (enable SPI, create user, install systemd unit).
3. `make pi-deploy PI_HOST=pi@<pi-ip>` from the Mac — rsync + restart.
4. `make pi-logs PI_HOST=…` — confirm samples posting and 204s coming back.
5. Open dashboard on phone — live temperature reflects room temperature, climbs when you cup the probe in your hand.

## Out of scope (deliberately)

- Multi-Pi support — `UDCPINE_DEVICE_TOKENS` already accepts multiple, but no device identity is stored per sample. Add a `device_id` to `Sample` when there's a second device.
- TLS for the ingest endpoint — plaintext on the LAN is fine for v1; tracked as a follow-up issue.
- `/api/health` endpoint — skipped for v1; `journalctl` is sufficient during bootstrap.
- Local sample buffering on the Pi for offline operation.
- Sensor-fault SSE events (open-thermocouple alerts in the UI). Log-only for v1.
- Camera, ambient temp probe, second thermocouple — separate plans.

## Ticket decomposition (Pattern B, post-approval)

Three agent-ready tickets, mostly independent:

1. **shared + backend** — schema flip (full °F→°C migration checklist above), ingest endpoint (no auth), mock gate, last-sample-age stale indicator, tests. Parallel-safe with #2.
2. **firmware** — directory, sensor + uploader (worker-thread queue, newest-first drain) + systemd unit + `--simulate` + tests. Parallel-safe with #1; integration verification depends on both.
3. **ops** — `pi-build`/`pi-deploy`/`pi-logs` Makefile targets + `firmware/README.md` (wiring, **cold-junction warning**, manual first-time setup runbook). Land alongside or *before* #2 so the deploy path can be dogfooded against the firmware build, not after.

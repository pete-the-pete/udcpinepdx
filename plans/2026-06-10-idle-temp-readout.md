# Design: current temperature on the idle/start screen

**Date:** 2026-06-10
**Scope:** cross-cutting — `backend` (store + mock sensor) and `web` (frontend).
**Status:** approved design (brainstorm). Implementation plan to follow.

## Goal

Show a glanceable live hearth temperature on the idle/start screen, before a
firing begins. This is **ambient context** only — no readiness threshold, no
"hot enough" alarm, no staleness styling. Just the current number, or `—`
when there's nothing to show.

## Why this needs more than a UI change

Temperature is currently **coupled to a firing**. `Store.publish_sample`
(`web/backend/src/udcpine_backend/store.py`) is an explicit no-op when the oven
is idle ("a sample belongs to a firing"), so when `firing is None` — exactly the
idle-screen state — `latest_sample` is `null` and no `sample` SSE events flow.

Two source-side facts shape the design:

- **Real Pi firmware** (`firmware/src/udcpine_firmware/main.py`) samples at a
  fixed rate and POSTs to `/api/ingest/sample` **unconditionally** — it has no
  notion of firing state. So the hardware is *already sending* idle readings;
  the backend just discards them.
- **Mock sensor** (`web/backend/src/udcpine_backend/mock_sensor.py`) emits only
  *while a firing is active*, so dev/demo and local verification have no idle
  reading at all.

The frontend is already 80% ready: the reducer (`web/frontend/src/reduce.ts`)
folds `sample` events into `latest_sample` regardless of firing.

## Approach: ephemeral "current reading", always broadcast

Stop discarding idle readings; let them ride the existing SSE stream + reducer
to the idle screen. The single design seam worth its weight: separate the
**transient live signal** (always broadcast, in-memory) from the **persisted
firing series** (DB rows, still firing-scoped).

### Data flow

```
Pi / mock ──POST /api/ingest/sample──▶ Store.publish_sample
                                          ├─ always: update in-memory latest + broadcast "sample" SSE
                                          └─ only if firing active: INSERT row into that firing's series
GET /api/state ──▶ latest_sample (now populated when idle too)
SSE "sample" ──▶ reducer folds into latest_sample ──▶ IdleScreen renders it
```

## Components

### Backend — `store.py`

- `publish_sample` no longer early-returns when idle. It **always** updates
  `self._latest_sample` and broadcasts the `sample` event. The DB `INSERT` is
  the only firing-gated part. Update the misleading "no-op when idle" docstring.
- `start_firing` / `stop_firing` keep resetting `_latest_sample = None`; the
  next idle reading (≤~1s on real hardware) refills it. **Idle readings are not
  persisted** — ephemeral by design (lost on restart). This is intentional for
  "ambient context"; it avoids a nullable `firing_id` and unbounded idle-data
  growth.
- `/api/state` is unchanged in shape — it simply starts returning a non-null
  `latest_sample` while idle.

### Mock sensor — `mock_sensor.py`

- Today the loop publishes only while a firing is active. Add an **idle-ambient
  branch**: when no firing is active, publish a gently-varying cool ambient
  reading (~20–25 °C) at the same cadence, so dev/demo and local verification
  show a number. The firing ramp curve is untouched.

### Frontend

- Thread `latest_sample` from `Live` (`app.tsx`) into `IdleScreen`
  (`views/idle-screen.tsx`) — it currently receives nothing.
- Render a small, muted temperature readout in the idle hero, reusing the
  ChefWidget pattern: `Math.round(°F)` or `—` when `latest_sample` is null.
- **Extract the shared C→F helper.** `tempC * 9 / 5 + 32` is currently
  duplicated in `views/hero-number.tsx`, `chef/ChefWidget.tsx`, and
  `chef/demo.tsx`. Extract one helper (e.g. `formatHearthTempF`) and point all
  existing call sites plus the new idle readout at it. This is a focused
  improvement justified by adding a 5th call site — not unrelated refactoring.
- **Reducer:** leave `firing_ended` resetting `latest_sample` to null as-is. It
  self-heals on the next idle sample within ~1s; not worth changing tested
  transition semantics.

### Explicitly out of scope

- No persistence of idle readings (no schema change, no nullable `firing_id`).
- No staleness dimming / "sensor stale" treatment on the idle screen.
- No readiness threshold or "hot enough" indicator.

## Empty state

- No reading yet (`latest_sample` null) → render `—`. No spinner, no caption
  change.

## Testing

- **Backend:** `publish_sample` while idle updates `latest_sample` and
  broadcasts a `sample` event, but writes **no** DB row; while a firing is
  active it does both. `/api/state` returns a reading when idle.
- **Mock:** the idle-ambient branch produces readings when no firing is active,
  within the expected ambient band; the firing ramp is unchanged.
- **Frontend:** `IdleScreen` renders a temperature from `latest_sample` and
  shows `—` when null. Confirm the reducer folds a `sample` event while
  `firing === null` (add a case if not already covered). The shared C→F helper
  has a unit test; existing call sites still render the same output.

## Verification (local)

- Run the backend + frontend in dev/mock mode, land on the idle screen, and
  confirm a live ambient number ticks before starting a firing.
- Start a firing and confirm the readout transitions into the existing live
  dashboard number without regression.

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

---

# Idle-Screen Temperature Readout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a live ambient hearth temperature on the idle/start screen before a firing begins.

**Architecture:** The backend stops discarding idle readings — `publish_sample` always updates the in-memory latest reading and broadcasts a `sample` SSE event; only the persisted DB row stays firing-gated. The mock sensor gains an idle-ambient branch so dev/demo show a number. The frontend threads `latest_sample` into the idle screen and renders it through a newly-extracted shared C→F helper.

**Tech Stack:** Python (Flask backend, pytest), Preact + TypeScript frontend (bun:test, @testing-library/preact), existing SSE stream + reducer.

**Conventions:** Backend tests run from `web/backend/` via `pytest`. Frontend tests run from `web/frontend/` via `bun test`. Commit after each task. Never use `--no-verify`.

---

### Task 1: Backend — idle readings update latest + broadcast, only DB insert stays firing-gated

**Files:**
- Modify: `web/backend/src/udcpine_backend/store.py:167-189` (`publish_sample`)
- Test: `web/backend/tests/test_store.py:125-128` (replace the no-op test)

- [ ] **Step 1: Replace the obsolete no-op test with the new idle-behavior tests**

In `web/backend/tests/test_store.py`, delete `test_publish_sample_without_a_firing_is_a_noop` (lines 125-128) and add:

```python
def test_publish_sample_while_idle_updates_latest_and_broadcasts(db_path) -> None:
    s = Store(db_path, clock=FixedClock(T0))
    q = s.subscribe()
    s.publish_sample(temp_c=22.0)  # no active firing
    assert s.latest_sample() is not None
    assert s.latest_sample().temp_c == 22.0
    event = q.get(timeout=0.5)
    assert event["type"] == "sample"
    assert event["temp_c"] == 22.0


def test_publish_sample_while_idle_writes_no_db_row(db_path) -> None:
    import sqlite3

    s = Store(db_path, clock=FixedClock(T0))
    s.publish_sample(temp_c=22.0)  # idle: in-memory only, no persisted row
    conn = sqlite3.connect(db_path)
    try:
        [(count,)] = conn.execute("SELECT COUNT(*) FROM sample").fetchall()
    finally:
        conn.close()
    assert count == 0
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `cd web/backend && pytest tests/test_store.py -k "idle" -v`
Expected: FAIL — `test_publish_sample_while_idle_updates_latest_and_broadcasts` fails because `publish_sample` currently returns early when idle (`latest_sample()` stays `None`, no event).

- [ ] **Step 3: Make `publish_sample` always update latest + broadcast; gate only the INSERT**

Replace `web/backend/src/udcpine_backend/store.py:167-189` with:

```python
    def publish_sample(self, *, temp_c: float) -> None:
        """Record a hearth reading. The in-memory latest reading and the SSE
        broadcast happen on EVERY call — including when the oven is idle — so
        the start screen can show a live ambient temperature before a firing
        begins. A persisted ``sample`` row is written only while a firing is
        active; an idle reading is transient (in-memory only, lost on restart).

        Temperature is degrees Celsius. The frontend converts to °F at
        render time; storage and the wire stay metric.
        """
        with self._lock:
            t = self._clock.now()
            if self._firing is not None:
                self._conn.execute(
                    "INSERT INTO sample (firing_id, t, temp_c) VALUES (?, ?, ?)",
                    (self._firing.id, t.isoformat(), temp_c),
                )
                self._conn.commit()
            self._latest_sample = Sample(t=t, temp_c=temp_c)
            event: dict[str, Any] = {
                "type": "sample",
                "t": t.isoformat(),
                "temp_c": temp_c,
            }
        self._broadcast(event)
```

- [ ] **Step 4: Run the full store test file to verify green (incl. firing-path regressions)**

Run: `cd web/backend && pytest tests/test_store.py -v`
Expected: PASS — new idle tests pass; existing firing-path tests (`test_publish_sample_updates_latest_sample`, `test_samples_returns_the_series`, `test_subscriber_receives_published_event`) still pass.

- [ ] **Step 5: Commit**

```bash
git add web/backend/src/udcpine_backend/store.py web/backend/tests/test_store.py
git commit -m "feat(backend): idle hearth readings update latest_sample + broadcast"
```

---

### Task 2: Backend — integration: idle ingest surfaces a reading in /api/state and on the wire

**Files:**
- Modify: `web/backend/tests/test_ingest.py:107-114` (flip the idle assertion)
- Test: `web/backend/tests/test_api.py` (add a state-after-idle-ingest test)

- [ ] **Step 1: Flip the idle ingest test to assert the new behavior**

Replace `test_ingest_without_active_firing_is_silent_204` in `web/backend/tests/test_ingest.py:107-114` with:

```python
def test_ingest_while_idle_returns_204_and_updates_latest(client, store) -> None:
    """A sample without a firing still returns 204 (the Pi shouldn't have to
    know whether a firing is in progress), but it now updates the live reading
    so the start screen can show an ambient temperature before a firing."""
    res = client.post("/api/ingest/sample", json={"temp_c": 200.0})
    assert res.status_code == 204
    assert store.latest_sample() is not None
    assert store.latest_sample().temp_c == 200.0
```

- [ ] **Step 2: Add a /api/state test for an idle reading**

In `web/backend/tests/test_api.py`, immediately after `test_get_state_when_idle` (ends ~line 53), add:

```python
def test_get_state_after_idle_ingest_has_reading(paired_client) -> None:
    paired_client.post("/api/ingest/sample", json={"temp_c": 22.5})
    state = LiveState.model_validate(json.loads(paired_client.get("/api/state").data))
    assert state.firing is None
    assert state.latest_sample is not None
    assert state.latest_sample.temp_c == 22.5
```

- [ ] **Step 3: Run both files to verify green**

Run: `cd web/backend && pytest tests/test_ingest.py tests/test_api.py -v`
Expected: PASS — the flipped idle test and the new state test pass; the happy-path firing ingest test (`test_ingest_happy_path_updates_state_and_sse`) still passes.

- [ ] **Step 4: Commit**

```bash
git add web/backend/tests/test_ingest.py web/backend/tests/test_api.py
git commit -m "test(backend): idle ingest surfaces a reading in /api/state and on SSE"
```

---

### Task 3: Backend — mock sensor publishes an idle-ambient reading when no firing is active

**Files:**
- Modify: `web/backend/src/udcpine_backend/mock_sensor.py` (add `ambient_temp_c` + idle branch)
- Test: `web/backend/tests/test_mock_sensor.py` (ambient band + determinism + idle-thread)

- [ ] **Step 1: Write the failing tests for ambient temperature**

Append to `web/backend/tests/test_mock_sensor.py`:

```python
def test_ambient_is_within_band() -> None:
    from udcpine_backend.mock_sensor import ambient_temp_c

    for tick in range(0, 100):
        v = ambient_temp_c(tick=tick)
        assert 20.0 <= v <= 25.0, f"out-of-band at tick={tick}: {v}"


def test_ambient_is_deterministic() -> None:
    from udcpine_backend.mock_sensor import ambient_temp_c

    assert ambient_temp_c(tick=7) == ambient_temp_c(tick=7)


def test_thread_publishes_ambient_while_idle(tmp_path) -> None:
    """The mock thread, with no active firing, publishes ambient readings so
    the idle screen shows a number in dev/demo. Condition-based wait — poll
    for the reading rather than sleeping a fixed interval."""
    import time

    from udcpine_backend.mock_sensor import MockSensorThread
    from udcpine_backend.store import Store

    store = Store(str(tmp_path / "mock.db"))
    thread = MockSensorThread(store, interval_s=0.01)
    thread.start()
    try:
        deadline = time.monotonic() + 2.0
        while store.latest_sample() is None and time.monotonic() < deadline:
            time.sleep(0.01)
    finally:
        thread.stop()
        thread.join(timeout=1.0)
    assert store.latest_sample() is not None
    assert 20.0 <= store.latest_sample().temp_c <= 25.0
```

- [ ] **Step 2: Run to verify failure**

Run: `cd web/backend && pytest tests/test_mock_sensor.py -k "ambient or idle" -v`
Expected: FAIL — `ambient_temp_c` is not defined; the thread test times out with `latest_sample() is None` because the idle branch doesn't exist yet.

- [ ] **Step 3: Add the ambient curve constants + pure function**

In `web/backend/src/udcpine_backend/mock_sensor.py`, after the `NOISE_BAND_C = 3.0` line (after line 29), add:

```python
AMBIENT_TEMP_C = 22.5
AMBIENT_NOISE_BAND_C = 2.5
```

And after `ramp_temp_c` (after line 42), add:

```python
def ambient_temp_c(*, tick: int) -> float:
    """Pure function: a gently-varying cool reading for an IDLE oven, so the
    start screen shows a live ambient temperature before a firing. Keyed on an
    integer tick (deterministic, like ``ramp_temp_c``). Stays within ~20–25 °C.
    """
    return AMBIENT_TEMP_C + math.sin(tick * 0.137) * AMBIENT_NOISE_BAND_C
```

- [ ] **Step 4: Wire the idle branch into the thread loop**

In `web/backend/src/udcpine_backend/mock_sensor.py`, in `MockSensorThread.__init__` add an idle-tick counter after `self._stop = threading.Event()` (after line 63):

```python
        self._idle_tick = 0
```

Then replace the `run` method body (lines 68-76) with:

```python
    def run(self) -> None:
        while not self._stop.is_set():
            firing = self._store.firing()
            if firing is not None:
                elapsed = (
                    self._store._clock.now() - firing.started_at  # noqa: SLF001
                ).total_seconds()
                self._store.publish_sample(temp_c=ramp_temp_c(elapsed_s=elapsed))
            else:
                self._store.publish_sample(
                    temp_c=ambient_temp_c(tick=self._idle_tick)
                )
                self._idle_tick += 1
            self._stop.wait(self._interval_s)
```

Also update the module docstring's first sentence (line 1) from "while a firing is active" to reflect both modes:

```python
"""Background thread that produces mock 1Hz hearth samples: a heating ramp
while a firing is active, and a cool idle-ambient reading when the oven is
idle (so the start screen shows a live temperature before a firing).
```

- [ ] **Step 5: Run to verify green**

Run: `cd web/backend && pytest tests/test_mock_sensor.py -v`
Expected: PASS — ambient band, determinism, and idle-thread tests pass; the existing `ramp_*` tests still pass.

- [ ] **Step 6: Commit**

```bash
git add web/backend/src/udcpine_backend/mock_sensor.py web/backend/tests/test_mock_sensor.py
git commit -m "feat(backend): mock sensor emits idle-ambient readings when no firing"
```

---

### Task 4: Frontend — extract a shared C→F helper and point existing call sites at it

**Files:**
- Create: `web/frontend/src/temp.ts`
- Test: `web/frontend/src/temp.test.ts`
- Modify: `web/frontend/src/views/hero-number.tsx:8-11` (drop local helper, import)
- Modify: `web/frontend/src/chef/ChefWidget.tsx:147,173` (use `formatHearthTempF`)
- Modify: `web/frontend/src/chef/demo.tsx:44-46,85` (rename to shared `celsiusToFahrenheit`)

- [ ] **Step 1: Write the failing helper test**

Create `web/frontend/src/temp.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { celsiusToFahrenheit, formatHearthTempF } from "./temp";

describe("celsiusToFahrenheit", () => {
  test("0°C is 32°F", () => expect(celsiusToFahrenheit(0)).toBe(32));
  test("100°C is 212°F", () => expect(celsiusToFahrenheit(100)).toBe(212));
});

describe("formatHearthTempF", () => {
  test("rounds and suffixes °F", () => expect(formatHearthTempF(232.2)).toBe("450°F"));
  test("em-dash placeholder for null", () => expect(formatHearthTempF(null)).toBe("—"));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd web/frontend && bun test src/temp.test.ts`
Expected: FAIL — `Cannot find module "./temp"`.

- [ ] **Step 3: Create the shared helper**

Create `web/frontend/src/temp.ts`:

```ts
/**
 * Hearth temperature formatting. The wire unit is Celsius (what the
 * MAX6675 reports and the backend stores); the operator-facing UI renders
 * Fahrenheit. Single source of truth for the conversion so the dashboard,
 * chef widget, demo harness, and idle screen all agree.
 */

/** Convert a Celsius reading to Fahrenheit. */
export function celsiusToFahrenheit(tempC: number): number {
  return tempC * 9 / 5 + 32;
}

/**
 * Format a hearth reading as a rounded Fahrenheit label, e.g. "450°F".
 * Returns an em-dash placeholder when there is no reading.
 */
export function formatHearthTempF(tempC: number | null): string {
  return tempC === null ? "—" : `${Math.round(celsiusToFahrenheit(tempC))}°F`;
}
```

- [ ] **Step 4: Run to verify the helper test passes**

Run: `cd web/frontend && bun test src/temp.test.ts`
Expected: PASS.

- [ ] **Step 5: Point hero-number.tsx at the shared conversion**

In `web/frontend/src/views/hero-number.tsx`, delete the local helper (lines 8-11):

```ts
// Wire unit is Celsius; the dashboard renders Fahrenheit for the operator.
function celsiusToFahrenheit(tempC: number): number {
  return tempC * 9 / 5 + 32;
}
```

and add an import alongside the existing imports (after the `import { isSampleStale } from "../reduce";` line):

```ts
import { celsiusToFahrenheit } from "../temp";
```

(The `tempLabel` expression at line ~67 keeps using `celsiusToFahrenheit(...).toString()` — it needs the bare number for the aria label, so it stays.)

- [ ] **Step 6: Point ChefWidget.tsx at `formatHearthTempF`**

In `web/frontend/src/chef/ChefWidget.tsx`, add an import near the top (with the other relative imports):

```ts
import { formatHearthTempF } from "../temp";
```

Delete the now-unused conversion line (line 147):

```ts
  const tempF = tempC !== null ? tempC * 9 / 5 + 32 : null;
```

and replace the label expression (line 173):

```ts
        {tempF !== null ? `${Math.round(tempF)}°F` : "—"}
```

with:

```ts
        {formatHearthTempF(tempC)}
```

- [ ] **Step 7: Point demo.tsx at the shared conversion**

In `web/frontend/src/chef/demo.tsx`, delete the local `toFahrenheit` (lines 44-46):

```ts
function toFahrenheit(tempC: number): number {
  return tempC * 9 / 5 + 32;
}
```

add an import (with the other imports at the top):

```ts
import { celsiusToFahrenheit } from "../temp";
```

and update its call site (line 85):

```ts
  const tempF = Math.round(toFahrenheit(tempC));
```

to:

```ts
  const tempF = Math.round(celsiusToFahrenheit(tempC));
```

- [ ] **Step 8: Run the full frontend suite + typecheck to verify no regressions**

Run: `cd web/frontend && bun test && bun run tsc --noEmit`
Expected: PASS — all existing tests still pass; no unused-symbol or type errors from the refactor.

- [ ] **Step 9: Commit**

```bash
git add web/frontend/src/temp.ts web/frontend/src/temp.test.ts web/frontend/src/views/hero-number.tsx web/frontend/src/chef/ChefWidget.tsx web/frontend/src/chef/demo.tsx
git commit -m "refactor(web): extract shared celsiusToFahrenheit / formatHearthTempF helper"
```

---

### Task 5: Frontend — render the temperature on the idle screen

**Files:**
- Modify: `web/frontend/src/app.tsx:113` (pass `latestSample` into `IdleScreen`)
- Modify: `web/frontend/src/views/idle-screen.tsx` (accept prop, render readout)
- Modify: `web/frontend/src/styles.css` (add `.idle__temp`)
- Create: `web/frontend/src/views/idle-screen.test.tsx`
- Create: `web/frontend/src/reduce.test.ts`

- [ ] **Step 1: Write the failing reducer test (sample folds while idle)**

Create `web/frontend/src/reduce.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import type { LiveState } from "@udcpine/shared";
import { applyEvent } from "./reduce";

const IDLE: LiveState = { firing: null, latest_sample: null, active_pizza: null };

describe("applyEvent — sample while idle", () => {
  test("folds a sample into latest_sample even when firing is null", () => {
    const next = applyEvent(IDLE, {
      type: "sample",
      t: "2026-06-10T00:00:00Z",
      temp_c: 22,
    });
    expect(next.latest_sample).toEqual({ t: "2026-06-10T00:00:00Z", temp_c: 22 });
    expect(next.firing).toBeNull();
  });
});
```

- [ ] **Step 2: Write the failing idle-screen test**

Create `web/frontend/src/views/idle-screen.test.tsx`:

```tsx
import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/preact";
import { IdleScreen } from "./idle-screen";

afterEach(cleanup);

describe("IdleScreen temperature readout", () => {
  test("renders the current reading in Fahrenheit", () => {
    render(
      <IdleScreen
        onStarted={() => {}}
        latestSample={{ t: "2026-06-10T00:00:00Z", temp_c: 232.2 }}
      />,
    );
    expect(screen.getByText("450°F")).toBeDefined();
  });

  test("shows an em-dash placeholder when there is no reading", () => {
    render(<IdleScreen onStarted={() => {}} latestSample={null} />);
    expect(screen.getByText("—")).toBeDefined();
  });
});
```

- [ ] **Step 3: Run both to verify failure**

Run: `cd web/frontend && bun test src/reduce.test.ts src/views/idle-screen.test.tsx`
Expected: FAIL — `reduce.test.ts` passes already (reducer supports it) OR compiles; `idle-screen.test.tsx` fails because `IdleScreen` has no `latestSample` prop and renders no temperature. (If the reducer test passes immediately, that is fine — it locks in behavior the idle screen depends on.)

- [ ] **Step 4: Add the `latestSample` prop and readout to IdleScreen**

In `web/frontend/src/views/idle-screen.tsx`, update the imports and props. Change:

```ts
import { useState } from "preact/hooks";
import { nextPizza, startFiring } from "../api";
import { PairPhoneOverlay } from "./pair-phone-overlay";

interface IdleScreenProps {
  onStarted: () => void;
}
```

to:

```ts
import { useState } from "preact/hooks";
import type { Sample } from "@udcpine/shared";
import { nextPizza, startFiring } from "../api";
import { formatHearthTempF } from "../temp";
import { PairPhoneOverlay } from "./pair-phone-overlay";

interface IdleScreenProps {
  onStarted: () => void;
  /** Latest hearth reading (ambient when idle), or null before the sensor reports. */
  latestSample: Sample | null;
}
```

Update the signature:

```ts
export function IdleScreen({ onStarted }: IdleScreenProps) {
```

to:

```ts
export function IdleScreen({ onStarted, latestSample }: IdleScreenProps) {
```

Then render the readout inside the `<section class="idle">`, immediately after the opening tag and before the `<form>`:

```tsx
      <section class="idle">
        <p class="idle__temp" aria-label="current hearth temperature">
          {formatHearthTempF(latestSample?.temp_c ?? null)}
        </p>
        <form class="idle__form" onSubmit={onSubmit}>
```

- [ ] **Step 5: Pass `latestSample` from the Live wrapper**

In `web/frontend/src/app.tsx`, change the idle render (line 113):

```tsx
        <IdleScreen onStarted={onAction} />
```

to:

```tsx
        <IdleScreen onStarted={onAction} latestSample={state.latest_sample} />
```

- [ ] **Step 6: Add the readout style**

In `web/frontend/src/styles.css`, after the `.idle__caption` rule (line 149), add:

```css
.idle__temp {
  margin: 0 0 4px;
  color: var(--ink-soft);
  font-size: 32px;
  letter-spacing: 2px;
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 7: Run the targeted tests to verify green**

Run: `cd web/frontend && bun test src/reduce.test.ts src/views/idle-screen.test.tsx`
Expected: PASS — both readout cases render; reducer test green.

- [ ] **Step 8: Full frontend suite + typecheck**

Run: `cd web/frontend && bun test && bun run tsc --noEmit`
Expected: PASS — `app.test.tsx` still passes with the new prop wired through.

- [ ] **Step 9: Commit**

```bash
git add web/frontend/src/app.tsx web/frontend/src/views/idle-screen.tsx web/frontend/src/views/idle-screen.test.tsx web/frontend/src/reduce.test.ts web/frontend/src/styles.css
git commit -m "feat(web): show live ambient temperature on the idle start screen"
```

---

### Final verification

- [ ] **Backend:** `cd web/backend && pytest`  → all green.
- [ ] **Frontend:** `cd web/frontend && bun test && bun run tsc --noEmit`  → all green.
- [ ] **Manual (local):** run backend + frontend with `UDCPINE_MOCK_SENSOR=1`, land on the idle screen, confirm a ~20–25 °C ambient °F number ticks before starting. Start a firing → confirm the dashboard's live number takes over without regression.
- [ ] **PR:** push `feat/idle-temp-readout`, open PR with summary + test plan per the project workflow.

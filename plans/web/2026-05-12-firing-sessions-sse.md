# Firing Sessions + SSE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Context

PR #17 shipped a static hardcoded `LiveState` over a fetch. This plan replaces
the hardcoded value with a **live, in-memory session** that the user can
start/stop, and pushes temperature updates over **SSE** while a firing is
active. No DB, no sensord, no auth — just the wire path proven for live
updates.

By the end of this plan: visiting `localhost:5173/` while idle shows a big
"START FIRING" CTA; clicking it kicks off a session that streams ~1Hz
temperature samples; the Hero Number ticks up as the (mocked) hearth heats;
clicking STOP ends the firing and returns to idle.

**Goal:** A user can start a firing from the UI, watch the (mocked) temperature climb live over SSE, and stop the firing — all in a single page session, with state living only in Flask process memory.

**Architecture:** A new `web/backend/.../store.py` module is the single source of truth for the live session — a thread-safe singleton holding `firing`, `latest_sample`, and a fan-out queue of subscribers. POSTs to `/api/firing/start` and `/api/firing/stop` mutate it; a background `MockSensorThread` produces a smooth-ramp sample once per second while a firing is active and publishes `sample` `LiveEvent`s. `GET /api/stream` opens a long-lived SSE response per client, draining the subscriber queue. `GET /api/state` returns a one-shot snapshot for initial page load. On the frontend, an `IdleScreen` swaps in when `firing === null`; the existing `HeroNumber` view gains a STOP control; a `useLiveState` hook bootstraps from `/api/state`, then folds incoming `LiveEvent`s into the local state via a reducer.

**Tech Stack:**
- **Backend:** Flask 3, Python `queue.Queue` + `threading.Thread` (no asyncio, no Celery — the in-memory model is intentionally boring). Pydantic v2 for response/event validation.
- **Frontend:** Preact + Zod. Browser-native `EventSource` for SSE; no library.
- **Shared:** existing Zod ↔ Pydantic bridge gains `LiveEventSchema` (discriminated union) and request-body types.

---

## Conscious decisions

1. **Single SSE stream of typed JSON, not per-event-name channels.** Per the design doc (`plans/web/2026-04-21-live-dashboard-design.md:264`). Each SSE message is `data: {type: "<discriminator>", …}`. The frontend uses `EventSource.onmessage` and a Zod discriminated union to narrow.
2. **In-memory state, lost on restart.** YAGNI for now. SQLite lands when there's a real reason to want persistence (probably plan D).
3. **`LiveState.firing` becomes nullable.** Idle is now a representable state on the wire. Otherwise we'd need a separate idle DTO or weasel-word fake firings.
4. **Mock sensor thread, not on-demand sampling.** The Pi's real `sensord` will produce 1Hz samples as a background process; the mock mirrors that shape exactly so the store interface doesn't change when we swap in the real driver.
5. **Smooth-ramp temperature curve, not random walk.** Linear climb from 70°F at start → 850°F at +10min, then small ±5°F noise around the plateau. Deterministic enough to demo and assert on; alive enough to look real.
6. **No pizza events in this plan.** The `LiveEvent` union has obvious slots for `pizza_started`/`pizza_ended` per the design doc, but the backend won't emit them and the frontend won't render any pizza UI. Adds in a dedicated future plan.
7. **STOP requires no confirmation.** The kiosk audience is one person (the chef). If they hit STOP they mean it. Double-tap-confirm is polish-phase work.
8. **Empty request bodies still get named schemas (`StartFiringRequest`, `EndFiringRequest`).** Per the design doc, so the bridge has a versioning anchor.

## Future scope (deferred)

- Pizza start/end events and active-pizza state mutation.
- SSE auto-reconnect with state re-fetch (browsers retry automatically, but we don't re-prime state from `/api/state` after a gap).
- Persistence (SQLite + restore on boot).
- Auth (token cookie, kiosk-localhost bypass).
- Drive uploader.
- Real `sensord` (SPI thermocouple).

---

## File structure

```
udcpinepdx/
├── plans/web/2026-05-12-firing-sessions-sse.md     (this plan)
├── shared/
│   └── src/
│       ├── live-event.ts                            (NEW — discriminated union)
│       ├── live-state.ts                            (MODIFY — firing: Firing | null)
│       ├── start-firing-request.ts                  (NEW — empty schema, named)
│       ├── end-firing-request.ts                    (NEW — empty schema, named)
│       └── index.ts                                 (MODIFY — register new schemas)
├── shared/tests/fixtures/
│   ├── liveevent/                                   (NEW — sample, firing_started, firing_ended)
│   └── livestate/valid/idle.json                    (MODIFY — already has firing; will change to null)
├── web/backend/
│   └── src/udcpine_backend/
│       ├── store.py                                 (NEW — Store singleton + LiveBus)
│       ├── mock_sensor.py                           (NEW — MockSensorThread with smooth ramp)
│       ├── app.py                                   (MODIFY — POST start/stop, GET stream, /api/state from store)
│       ├── mock_state.py                            (DELETE — no longer needed)
│       └── time_source.py                           (NEW — injectable now() for deterministic tests)
└── web/backend/tests/
    ├── test_store.py                                (NEW — start/stop/publish/subscribe semantics)
    ├── test_mock_sensor.py                          (NEW — ramp math + thread lifecycle)
    └── test_api.py                                  (MODIFY — POSTs, SSE smoke, /api/state when idle)
├── web/frontend/
│   └── src/
│       ├── api.ts                                   (MODIFY — add startFiring(), endFiring())
│       ├── use-live-state.ts                        (NEW — hook: fetch + SSE reducer)
│       ├── reduce.ts                                (NEW — pure reducer LiveState × LiveEvent → LiveState)
│       ├── views/
│       │   ├── idle-screen.tsx                      (NEW — START FIRING CTA)
│       │   └── hero-number.tsx                      (MODIFY — STOP button; live temp)
│       ├── app.tsx                                  (MODIFY — switch on firing presence)
│       └── styles.css                               (MODIFY — idle + stop button + small polish)
```

---

## Task 1: Make `LiveState.firing` nullable

**Files:**
- Modify: `shared/src/live-state.ts`
- Modify: `shared/tests/fixtures/livestate/valid/idle.json`
- Modify: `shared/tests/fixtures/livestate/valid/active.json` (no change needed — keep as reference)

- [ ] **Step 1: Update `shared/src/live-state.ts`**

Replace the file with:

```typescript
import { z } from "zod";
import { FiringSchema } from "./firing.ts";
import { SampleSchema } from "./sample.ts";
import { PizzaSchema } from "./pizza.ts";

/**
 * Snapshot DTO returned by GET /api/state. Carries everything the dashboard
 * needs to render "what's happening right now" in a single fetch:
 *   - the firing (null when the oven is idle between sessions),
 *   - the most recent thermocouple reading (null before sensord first reports),
 *   - the active pizza (null between pizzas).
 *
 * SSE pushes `LiveEvent` values that incrementally update the fields of this
 * snapshot client-side.
 */
export const LiveStateSchema = z.object({
  firing: FiringSchema.nullable(),
  latest_sample: SampleSchema.nullable(),
  active_pizza: PizzaSchema.nullable(),
});

export type LiveState = z.infer<typeof LiveStateSchema>;
```

- [ ] **Step 2: Replace the idle fixture so `firing` is now null**

Rewrite `shared/tests/fixtures/livestate/valid/idle.json`:

```json
{
  "firing": null,
  "latest_sample": null,
  "active_pizza": null
}
```

- [ ] **Step 3: Regenerate the bridge**

Run: `make codegen`
Expected: `shared/generated/schemas/all.json` has `LiveState.firing` as `anyOf: [{$ref: #/$defs/Firing}, {type: null}]`; `shared/generated/pydantic/__init__.py` has `firing: Firing | None`.

- [ ] **Step 4: Run the shared contract tests**

Run: `make shared-test`
Expected: still 11 PASS. (The existing idle.json gets `firing: null`; active.json unchanged.)

- [ ] **Step 5: Commit**

```bash
git add shared/src/live-state.ts shared/tests/fixtures/livestate/valid/idle.json shared/generated/
git commit -m "feat(shared): LiveState.firing is nullable (idle state)"
```

---

## Task 2: Add `LiveEvent` discriminated union

**Files:**
- Create: `shared/src/live-event.ts`
- Modify: `shared/src/index.ts`

- [ ] **Step 1: Write `shared/src/live-event.ts`**

```typescript
import { z } from "zod";
import { FiringSchema } from "./firing.ts";
import { SampleSchema } from "./sample.ts";

/**
 * Payload of one SSE message on /api/stream. Discriminated by `type`.
 * The frontend uses a discriminated-union switch to narrow each variant.
 *
 * `pizza_started` and `pizza_ended` are deliberately NOT in this union yet —
 * they land in a future plan. Add them here when pizza state ships, not
 * before, to keep the surface honest.
 */
export const LiveEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("sample"),
    t: z.string().datetime({ offset: true }),
    temp_f: z.number(),
  }),
  z.object({
    type: z.literal("firing_started"),
    firing: FiringSchema,
  }),
  z.object({
    type: z.literal("firing_ended"),
    firing_id: z.number().int().nonnegative(),
  }),
]);

export type LiveEvent = z.infer<typeof LiveEventSchema>;

// Re-export the inner Sample shape for convenience; the `sample` event
// shares its `{t, temp_f}` shape with the SampleSchema by construction,
// so we want one canonical name in app code.
export type SampleEvent = Extract<LiveEvent, { type: "sample" }>;
```

- [ ] **Step 2: Register `LiveEventSchema` in `shared/src/index.ts`**

Replace the file with:

```typescript
import { FiringSchema } from "./firing.ts";
import { SampleSchema } from "./sample.ts";
import { PizzaSchema } from "./pizza.ts";
import { LiveStateSchema } from "./live-state.ts";
import { LiveEventSchema } from "./live-event.ts";

export { FiringSchema, SampleSchema, PizzaSchema, LiveStateSchema, LiveEventSchema };
export type { Firing } from "./firing.ts";
export type { Sample } from "./sample.ts";
export type { Pizza } from "./pizza.ts";
export type { LiveState } from "./live-state.ts";
export type { LiveEvent, SampleEvent } from "./live-event.ts";

export const ALL_SCHEMAS = {
  Firing: FiringSchema,
  Sample: SampleSchema,
  Pizza: PizzaSchema,
  LiveState: LiveStateSchema,
  LiveEvent: LiveEventSchema,
} as const;
```

- [ ] **Step 3: Regenerate**

Run: `make codegen`
Expected: `shared/generated/pydantic/__init__.py` now contains classes for each variant — probably `Sample1` or similar anonymous classes from the union, plus a top-level `LiveEvent`. Verify it imports cleanly:

Run: `cd shared && uv run python -c "from generated.pydantic import LiveEvent; print(LiveEvent)"`
Expected: prints a class or a Union type.

If `datamodel-code-generator` produces an awkward `Union[X, Y, Z]` instead of a tagged variant, that's acceptable for now — Pydantic will still validate by trying each. Note any roughness; it's not blocking.

- [ ] **Step 4: Add a valid LiveEvent fixture**

Create `shared/tests/fixtures/liveevent/valid/sample.json`:

```json
{
  "type": "sample",
  "t": "2026-04-28T19:46:48-07:00",
  "temp_f": 847.0
}
```

Create `shared/tests/fixtures/liveevent/valid/firing-started.json`:

```json
{
  "type": "firing_started",
  "firing": {
    "id": 42,
    "started_at": "2026-04-28T18:24:00-07:00",
    "ended_at": null,
    "status": "active"
  }
}
```

Create `shared/tests/fixtures/liveevent/valid/firing-ended.json`:

```json
{
  "type": "firing_ended",
  "firing_id": 42
}
```

Create `shared/tests/fixtures/liveevent/invalid/unknown-type.json`:

```json
{
  "type": "explosion",
  "magnitude": 9000
}
```

Create `shared/tests/fixtures/liveevent/invalid/sample-missing-temp.json`:

```json
{
  "type": "sample",
  "t": "2026-04-28T19:46:48-07:00"
}
```

- [ ] **Step 5: Register `LiveEvent` in the Python contract test**

Edit `shared/tests/test_contract.py`. Change:

```python
from generated.pydantic import Firing, LiveState, Pizza, Sample
```

to:

```python
from generated.pydantic import Firing, LiveEvent, LiveState, Pizza, Sample
```

And in the `MODELS` dict, add `"liveevent": LiveEvent`.

- [ ] **Step 6: Run the tests**

Run: `make shared-test`
Expected: 16 PASS (11 prior + 3 valid liveevent + 2 invalid liveevent).

If the Pydantic union shape produced by datamodel-codegen rejects a valid fixture, it's likely because the codegen flattened the discriminated union poorly. Workaround: set `--use-union-operator` and `--use-schema-description` are already on; try adding `--collapse-root-models` or accept and adapt the import name. Document the choice in the commit message.

- [ ] **Step 7: Commit**

```bash
git add shared/src/live-event.ts shared/src/index.ts shared/tests/fixtures/liveevent/ shared/tests/test_contract.py shared/generated/
git commit -m "feat(shared): LiveEvent discriminated union (sample, firing_started, firing_ended)"
```

---

## Task 3: Add `StartFiringRequest` and `EndFiringRequest`

**Files:**
- Create: `shared/src/start-firing-request.ts`
- Create: `shared/src/end-firing-request.ts`
- Modify: `shared/src/index.ts`

- [ ] **Step 1: Write `shared/src/start-firing-request.ts`**

```typescript
import { z } from "zod";

/**
 * POST /api/firing/start body. Empty today, but typed-and-named so that
 * adding fields later (e.g. an oven preset) is a typed schema change
 * picked up by both sides, not a freeform JSON evolution.
 */
export const StartFiringRequestSchema = z.object({}).strict();

export type StartFiringRequest = z.infer<typeof StartFiringRequestSchema>;
```

- [ ] **Step 2: Write `shared/src/end-firing-request.ts`**

```typescript
import { z } from "zod";

/**
 * POST /api/firing/stop body. Empty today; see StartFiringRequest for why
 * it's kept as a named schema rather than an inline {}.
 */
export const EndFiringRequestSchema = z.object({}).strict();

export type EndFiringRequest = z.infer<typeof EndFiringRequestSchema>;
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

export {
  FiringSchema,
  SampleSchema,
  PizzaSchema,
  LiveStateSchema,
  LiveEventSchema,
  StartFiringRequestSchema,
  EndFiringRequestSchema,
};
export type { Firing } from "./firing.ts";
export type { Sample } from "./sample.ts";
export type { Pizza } from "./pizza.ts";
export type { LiveState } from "./live-state.ts";
export type { LiveEvent, SampleEvent } from "./live-event.ts";
export type { StartFiringRequest } from "./start-firing-request.ts";
export type { EndFiringRequest } from "./end-firing-request.ts";

export const ALL_SCHEMAS = {
  Firing: FiringSchema,
  Sample: SampleSchema,
  Pizza: PizzaSchema,
  LiveState: LiveStateSchema,
  LiveEvent: LiveEventSchema,
  StartFiringRequest: StartFiringRequestSchema,
  EndFiringRequest: EndFiringRequestSchema,
} as const;
```

- [ ] **Step 4: Codegen + verify**

Run: `make codegen && make shared-test`
Expected: still 16 PASS (no fixtures for empty request types — their validation is structural).

- [ ] **Step 5: Commit**

```bash
git add shared/src/start-firing-request.ts shared/src/end-firing-request.ts shared/src/index.ts shared/generated/
git commit -m "feat(shared): empty named request types for firing start/stop"
```

---

## Task 4: Backend `time_source.py` — injectable clock

**Files:**
- Create: `web/backend/src/udcpine_backend/time_source.py`

Why: the store will record `started_at` from a clock. To make `test_store.py` deterministic, we inject a clock instead of calling `datetime.now()` everywhere.

- [ ] **Step 1: Write `web/backend/src/udcpine_backend/time_source.py`**

```python
"""A tiny clock abstraction so tests can pin time.

Production code calls SystemClock.now(); tests pass a fake.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Protocol


class Clock(Protocol):
    def now(self) -> datetime: ...


class SystemClock:
    def now(self) -> datetime:
        return datetime.now(timezone.utc)
```

- [ ] **Step 2: Commit**

```bash
git add web/backend/src/udcpine_backend/time_source.py
git commit -m "chore(web): introduce injectable Clock for backend"
```

---

## Task 5: Backend `Store` — TDD start/stop

**Files:**
- Create: `web/backend/tests/test_store.py`
- Create: `web/backend/src/udcpine_backend/store.py`

- [ ] **Step 1: Write failing tests `web/backend/tests/test_store.py`**

```python
"""Store: thread-safe in-memory session state."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from udcpine_backend.store import Store
from udcpine_backend.time_source import Clock


class FixedClock(Clock):
    def __init__(self, when: datetime) -> None:
        self._when = when

    def now(self) -> datetime:
        return self._when


T0 = datetime(2026, 5, 12, 18, 0, 0, tzinfo=timezone.utc)


def test_new_store_is_idle() -> None:
    s = Store(clock=FixedClock(T0))
    assert s.firing() is None
    assert s.latest_sample() is None


def test_start_firing_creates_active_firing() -> None:
    s = Store(clock=FixedClock(T0))
    firing = s.start_firing()
    assert firing.status == "active"
    assert firing.id >= 0
    assert firing.ended_at is None
    assert s.firing() is firing


def test_starting_while_active_returns_existing_firing() -> None:
    s = Store(clock=FixedClock(T0))
    first = s.start_firing()
    second = s.start_firing()
    assert first is second


def test_stop_firing_marks_ended() -> None:
    s = Store(clock=FixedClock(T0))
    s.start_firing()
    ended = s.stop_firing()
    assert ended is not None
    assert ended.status == "ended"
    assert ended.ended_at is not None
    assert s.firing() is None


def test_stop_while_idle_returns_none() -> None:
    s = Store(clock=FixedClock(T0))
    assert s.stop_firing() is None


def test_firing_ids_increment_across_sessions() -> None:
    s = Store(clock=FixedClock(T0))
    f1 = s.start_firing()
    s.stop_firing()
    f2 = s.start_firing()
    assert f2.id == f1.id + 1
```

- [ ] **Step 2: Run; verify they fail with import error**

Run: `cd web/backend && uv run pytest tests/test_store.py -v`
Expected: collection error or `ImportError` for `udcpine_backend.store`.

- [ ] **Step 3: Write `web/backend/src/udcpine_backend/store.py`**

```python
"""In-memory session state for the dashboard.

A Store instance is the single source of truth for "what's the oven doing
right now." It holds at most one active firing, the most recent sample,
and a list of SSE subscribers (added in a later task). All access is
serialized by an internal lock so the Flask threadpool and the mock
sensor thread can hit it concurrently without races.
"""

from __future__ import annotations

import threading

from generated.pydantic import Firing, Sample

from .time_source import Clock, SystemClock


class Store:
    def __init__(self, clock: Clock | None = None) -> None:
        self._clock: Clock = clock if clock is not None else SystemClock()
        self._lock = threading.Lock()
        self._firing: Firing | None = None
        self._latest_sample: Sample | None = None
        self._next_id = 1

    def firing(self) -> Firing | None:
        with self._lock:
            return self._firing

    def latest_sample(self) -> Sample | None:
        with self._lock:
            return self._latest_sample

    def start_firing(self) -> Firing:
        with self._lock:
            if self._firing is not None:
                return self._firing
            firing = Firing(
                id=self._next_id,
                started_at=self._clock.now(),
                ended_at=None,
                status="active",
            )
            self._next_id += 1
            self._firing = firing
            self._latest_sample = None
            return firing

    def stop_firing(self) -> Firing | None:
        with self._lock:
            if self._firing is None:
                return None
            ended = self._firing.model_copy(
                update={"ended_at": self._clock.now(), "status": "ended"}
            )
            self._firing = None
            self._latest_sample = None
            return ended
```

- [ ] **Step 4: Run tests**

Run: `cd web/backend && uv run pytest tests/test_store.py -v`
Expected: 6 PASS.

- [ ] **Step 5: Commit**

```bash
git add web/backend/src/udcpine_backend/store.py web/backend/tests/test_store.py
git commit -m "feat(web): in-memory Store with start/stop"
```

---

## Task 6: Store — pub/sub for SSE

**Files:**
- Modify: `web/backend/src/udcpine_backend/store.py`
- Modify: `web/backend/tests/test_store.py`

- [ ] **Step 1: Add failing pub/sub tests**

Append to `web/backend/tests/test_store.py`:

```python
def test_subscriber_receives_published_event() -> None:
    s = Store(clock=FixedClock(T0))
    q = s.subscribe()
    s.publish_sample(temp_f=847.0)
    event = q.get(timeout=0.5)
    assert event["type"] == "sample"
    assert event["temp_f"] == 847.0
    assert "t" in event


def test_start_firing_publishes_firing_started() -> None:
    s = Store(clock=FixedClock(T0))
    q = s.subscribe()
    s.start_firing()
    event = q.get(timeout=0.5)
    assert event["type"] == "firing_started"
    assert event["firing"]["status"] == "active"


def test_stop_firing_publishes_firing_ended() -> None:
    s = Store(clock=FixedClock(T0))
    s.start_firing()
    q = s.subscribe()
    s.stop_firing()
    event = q.get(timeout=0.5)
    assert event["type"] == "firing_ended"
    assert "firing_id" in event


def test_publish_sample_updates_latest_sample() -> None:
    s = Store(clock=FixedClock(T0))
    s.publish_sample(temp_f=200.0)
    assert s.latest_sample() is not None
    assert s.latest_sample().temp_f == 200.0


def test_unsubscribe_stops_delivery() -> None:
    s = Store(clock=FixedClock(T0))
    q = s.subscribe()
    s.unsubscribe(q)
    s.publish_sample(temp_f=100.0)
    with pytest.raises(Exception):
        q.get(timeout=0.05)


def test_emitted_events_validate_against_live_event_schema() -> None:
    """Server-side contract test: every dict the Store broadcasts must
    validate against the generated LiveEvent Pydantic class. Catches
    drift between the Store's hand-built dict shape and the shared
    schema — e.g. a typo in `"type"` or a missing field that would
    otherwise only fail silently on the frontend."""
    from generated.pydantic import LiveEvent

    s = Store(clock=FixedClock(T0))
    q = s.subscribe()
    s.start_firing()
    s.publish_sample(temp_f=847.0)
    s.stop_firing()

    for _ in range(3):
        event = q.get(timeout=0.5)
        LiveEvent.model_validate(event)
```

- [ ] **Step 2: Run and verify they fail**

Run: `cd web/backend && uv run pytest tests/test_store.py -v`
Expected: 6 PASS, 6 FAIL (the new tests).

- [ ] **Step 3: Add pub/sub methods to `Store`**

Replace the entire contents of `web/backend/src/udcpine_backend/store.py` with:

```python
"""In-memory session state for the dashboard.

A Store instance is the single source of truth for "what's the oven doing
right now." It holds at most one active firing, the most recent sample,
and a list of SSE subscribers. All access is serialized by an internal
lock so the Flask threadpool and the mock sensor thread can hit it
concurrently without races.

Published events are plain dicts (NOT Pydantic models). The SSE handler
JSON-encodes them; tests inspect them as dicts. The wire shape is
exercised by the shared/tests contract tests, so we don't duplicate
validation here.
"""

from __future__ import annotations

import queue
import threading
from typing import Any

from generated.pydantic import Firing, Sample

from .time_source import Clock, SystemClock


class Store:
    def __init__(self, clock: Clock | None = None) -> None:
        self._clock: Clock = clock if clock is not None else SystemClock()
        self._lock = threading.Lock()
        self._firing: Firing | None = None
        self._latest_sample: Sample | None = None
        self._next_id = 1
        self._subscribers: list[queue.Queue[dict[str, Any]]] = []

    # ---- state accessors --------------------------------------------------
    def firing(self) -> Firing | None:
        with self._lock:
            return self._firing

    def latest_sample(self) -> Sample | None:
        with self._lock:
            return self._latest_sample

    # ---- mutators ---------------------------------------------------------
    def start_firing(self) -> Firing:
        with self._lock:
            if self._firing is not None:
                return self._firing
            firing = Firing(
                id=self._next_id,
                started_at=self._clock.now(),
                ended_at=None,
                status="active",
            )
            self._next_id += 1
            self._firing = firing
            self._latest_sample = None
            event: dict[str, Any] = {
                "type": "firing_started",
                "firing": firing.model_dump(mode="json"),
            }
        self._broadcast(event)
        return firing

    def stop_firing(self) -> Firing | None:
        with self._lock:
            if self._firing is None:
                return None
            ended = self._firing.model_copy(
                update={"ended_at": self._clock.now(), "status": "ended"}
            )
            firing_id = ended.id
            self._firing = None
            self._latest_sample = None
            event: dict[str, Any] = {"type": "firing_ended", "firing_id": firing_id}
        self._broadcast(event)
        return ended

    def publish_sample(self, *, temp_f: float) -> None:
        with self._lock:
            t = self._clock.now()
            self._latest_sample = Sample(t=t, temp_f=temp_f)
            event: dict[str, Any] = {
                "type": "sample",
                "t": t.isoformat(),
                "temp_f": temp_f,
            }
        self._broadcast(event)

    # ---- pub/sub ----------------------------------------------------------
    def subscribe(self) -> queue.Queue[dict[str, Any]]:
        q: queue.Queue[dict[str, Any]] = queue.Queue(maxsize=1024)
        with self._lock:
            self._subscribers.append(q)
        return q

    def unsubscribe(self, q: queue.Queue[dict[str, Any]]) -> None:
        with self._lock:
            if q in self._subscribers:
                self._subscribers.remove(q)

    def _broadcast(self, event: dict[str, Any]) -> None:
        with self._lock:
            subs = list(self._subscribers)
        for q in subs:
            try:
                q.put_nowait(event)
            except queue.Full:
                # A subscriber that can't keep up is treated as dropped; the
                # client will reconnect and re-prime from /api/state.
                self.unsubscribe(q)
```

- [ ] **Step 4: Run all store tests**

Run: `cd web/backend && uv run pytest tests/test_store.py -v`
Expected: 12 PASS.

- [ ] **Step 5: Commit**

```bash
git add web/backend/src/udcpine_backend/store.py web/backend/tests/test_store.py
git commit -m "feat(web): Store pub/sub for SSE fan-out"
```

---

## Task 7: `MockSensorThread` — smooth ramp + plateau

**Files:**
- Create: `web/backend/tests/test_mock_sensor.py`
- Create: `web/backend/src/udcpine_backend/mock_sensor.py`

- [ ] **Step 1: Failing tests `web/backend/tests/test_mock_sensor.py`**

```python
"""MockSensorThread: deterministic temperature curve for demos."""

from __future__ import annotations

import pytest

from udcpine_backend.mock_sensor import ramp_temp_f


def test_ramp_at_t0_is_starting_temp() -> None:
    assert ramp_temp_f(elapsed_s=0) == pytest.approx(70.0, abs=0.01)


def test_ramp_reaches_target_at_plateau_time() -> None:
    # 850°F by +600s (10 minutes)
    assert ramp_temp_f(elapsed_s=600) == pytest.approx(850.0, abs=1.0)


def test_ramp_holds_target_after_plateau() -> None:
    # Sustained heat: noise band ±5°F around 850°F
    for t in (601, 700, 1200, 3600):
        v = ramp_temp_f(elapsed_s=t)
        assert 845.0 <= v <= 855.0, f"out-of-band at t={t}: {v}"


def test_ramp_is_monotonic_in_ramp_phase() -> None:
    samples = [ramp_temp_f(elapsed_s=t) for t in range(0, 600, 10)]
    for a, b in zip(samples, samples[1:]):
        assert b >= a, f"non-monotonic: {a} -> {b}"


def test_ramp_is_deterministic() -> None:
    # Same input -> same output, every call. Noise is keyed off elapsed_s.
    assert ramp_temp_f(elapsed_s=750) == ramp_temp_f(elapsed_s=750)
```

- [ ] **Step 2: Verify they fail**

Run: `cd web/backend && uv run pytest tests/test_mock_sensor.py -v`
Expected: ImportError.

- [ ] **Step 3: Write `web/backend/src/udcpine_backend/mock_sensor.py`**

```python
"""Background thread that produces mock 1Hz hearth samples while a
firing is active. The temperature curve is:

  - linear climb from 70°F at t=0 → 850°F at t=600s,
  - then a steady plateau at 850°F with small ±5°F noise.

Noise is deterministic (seeded by integer-seconds elapsed) so tests can
assert exact values.
"""

from __future__ import annotations

import math
import threading
import time
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .store import Store

START_TEMP_F = 70.0
TARGET_TEMP_F = 850.0
RAMP_SECONDS = 600
NOISE_BAND_F = 5.0


def ramp_temp_f(*, elapsed_s: float) -> float:
    """Pure function: elapsed seconds since firing start → degrees F."""
    if elapsed_s <= 0:
        return START_TEMP_F
    if elapsed_s < RAMP_SECONDS:
        slope = (TARGET_TEMP_F - START_TEMP_F) / RAMP_SECONDS
        return START_TEMP_F + slope * elapsed_s
    # Plateau with deterministic noise: a low-frequency sine keyed by the
    # integer second. Avoids RNG state so the function stays pure.
    noise = math.sin(elapsed_s * 0.137) * NOISE_BAND_F
    return TARGET_TEMP_F + noise


class MockSensorThread(threading.Thread):
    """Publishes one sample/second to the store while a firing is active."""

    def __init__(self, store: "Store", interval_s: float = 1.0) -> None:
        super().__init__(daemon=True, name="mock-sensor")
        self._store = store
        self._interval_s = interval_s
        self._stop = threading.Event()

    def stop(self) -> None:
        self._stop.set()

    def run(self) -> None:
        while not self._stop.is_set():
            firing = self._store.firing()
            if firing is not None:
                elapsed = (
                    self._store._clock.now() - firing.started_at  # noqa: SLF001
                ).total_seconds()
                self._store.publish_sample(temp_f=ramp_temp_f(elapsed_s=elapsed))
            self._stop.wait(self._interval_s)
```

- [ ] **Step 4: Run tests**

Run: `cd web/backend && uv run pytest tests/test_mock_sensor.py -v`
Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add web/backend/src/udcpine_backend/mock_sensor.py web/backend/tests/test_mock_sensor.py
git commit -m "feat(web): MockSensorThread with smooth ramp + plateau"
```

---

## Task 8: Backend `/api/firing/start` and `/api/firing/stop`

**Files:**
- Modify: `web/backend/src/udcpine_backend/app.py`
- Delete: `web/backend/src/udcpine_backend/mock_state.py`
- Modify: `web/backend/tests/test_api.py`

- [ ] **Step 1: Replace `app.py`**

```python
"""Flask app factory and route definitions.

The app is intentionally tiny: one shared Store + a mock sensor thread.
Each subsequent plan replaces a chunk.
"""

from __future__ import annotations

from flask import Flask, Response

from generated.pydantic import LiveState

from .mock_sensor import MockSensorThread
from .store import Store


def create_app(store: Store | None = None) -> Flask:
    app = Flask(__name__)
    s = store if store is not None else Store()
    app.config["STORE"] = s

    # The mock sensor runs for the lifetime of the app. It only publishes
    # when a firing is active; otherwise it sleeps. Daemon thread = dies
    # with the process. Started lazily on first request to play nice with
    # Flask's debug-mode child reloads (the parent process should NOT
    # spawn the thread; only the reloaded child should).
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

    return app
```

- [ ] **Step 2: Delete `web/backend/src/udcpine_backend/mock_state.py`**

```bash
git rm web/backend/src/udcpine_backend/mock_state.py
```

- [ ] **Step 3: Rewrite `web/backend/tests/test_api.py`**

```python
"""Contract tests for the Flask backend endpoints.

These tests assert that responses deserialize cleanly into the shared Pydantic
models — the same models the Pi will use, the same shapes the Zod schemas on
the frontend will accept.
"""

from __future__ import annotations

import json

import pytest
from generated.pydantic import Firing, LiveState

from udcpine_backend.app import create_app
from udcpine_backend.store import Store


@pytest.fixture()
def store() -> Store:
    return Store()


@pytest.fixture()
def client(store):
    app = create_app(store=store)
    app.config.update(TESTING=True)
    return app.test_client()


def test_get_state_when_idle(client) -> None:
    res = client.get("/api/state")
    assert res.status_code == 200
    state = LiveState.model_validate(json.loads(res.data))
    assert state.firing is None
    assert state.latest_sample is None
    assert state.active_pizza is None


def test_post_start_returns_active_firing(client) -> None:
    res = client.post("/api/firing/start")
    assert res.status_code == 200
    firing = Firing.model_validate(json.loads(res.data))
    assert firing.status == "active"
    assert firing.ended_at is None


def test_state_after_start_reflects_active_firing(client) -> None:
    client.post("/api/firing/start")
    state = LiveState.model_validate(json.loads(client.get("/api/state").data))
    assert state.firing is not None
    assert state.firing.status == "active"


def test_double_start_is_idempotent(client) -> None:
    a = Firing.model_validate(json.loads(client.post("/api/firing/start").data))
    b = Firing.model_validate(json.loads(client.post("/api/firing/start").data))
    assert a.id == b.id


def test_stop_without_start_is_409(client) -> None:
    res = client.post("/api/firing/stop")
    assert res.status_code == 409


def test_stop_after_start_returns_ended_firing(client) -> None:
    client.post("/api/firing/start")
    res = client.post("/api/firing/stop")
    assert res.status_code == 200
    firing = Firing.model_validate(json.loads(res.data))
    assert firing.status == "ended"
    assert firing.ended_at is not None


def test_state_returns_to_idle_after_stop(client) -> None:
    client.post("/api/firing/start")
    client.post("/api/firing/stop")
    state = LiveState.model_validate(json.loads(client.get("/api/state").data))
    assert state.firing is None
```

- [ ] **Step 4: Run tests**

Run: `cd web/backend && uv run pytest -v`
Expected: 7 API tests + 12 store tests + 5 sensor tests = 24 PASS.

- [ ] **Step 5: Commit**

```bash
git add web/backend/src/udcpine_backend/app.py web/backend/tests/test_api.py
git rm web/backend/src/udcpine_backend/mock_state.py
git commit -m "feat(web): /api/firing/start and /api/firing/stop with in-memory Store"
```

---

## Task 9: Backend `/api/stream` SSE endpoint

**Files:**
- Modify: `web/backend/src/udcpine_backend/app.py`
- Modify: `web/backend/tests/test_api.py`

- [ ] **Step 1: Add the failing SSE smoke test to `test_api.py`**

Append:

```python
def test_stream_emits_firing_started_event(client, store) -> None:
    """Open the SSE stream, start a firing, and read one event."""
    # Subscribe BEFORE the action so we don't race.
    with client.get("/api/stream", buffered=False) as res:
        assert res.status_code == 200
        assert res.content_type.startswith("text/event-stream")
        # Trigger an event via the store directly (the test client doesn't
        # do concurrent requests cleanly).
        store.start_firing()
        # Pull one SSE record off the wire. Flask's streaming response
        # iterator yields raw bytes; we look for the JSON body line.
        chunks = []
        for raw in res.response:
            chunks.append(raw)
            if b"\n\n" in raw:
                break
        body = b"".join(chunks).decode("utf-8")
        # Format: "data: {...}\n\n"
        assert "data: " in body
        payload_line = next(line for line in body.splitlines() if line.startswith("data: "))
        payload = json.loads(payload_line.removeprefix("data: "))
        assert payload["type"] == "firing_started"
```

- [ ] **Step 2: Run; verify failure**

Run: `cd web/backend && uv run pytest tests/test_api.py::test_stream_emits_firing_started_event -v`
Expected: FAIL (route doesn't exist).

- [ ] **Step 3: Add the SSE route to `app.py`**

Add inside `create_app`, after `post_firing_stop`:

```python
    @app.get("/api/stream")
    def get_stream() -> Response:
        q = s.subscribe()

        def gen():
            try:
                # First, a no-op comment line so the client knows the
                # stream is alive even before any real event arrives.
                yield ": connected\n\n"
                while True:
                    event = q.get()
                    yield f"data: {json.dumps(event)}\n\n"
            finally:
                s.unsubscribe(q)

        return Response(gen(), mimetype="text/event-stream")
```

Add the import at the top:

```python
import json
```

- [ ] **Step 4: Run tests**

Run: `cd web/backend && uv run pytest -v`
Expected: 25 PASS.

If the streaming test hangs: increase the chunk read with a timeout, or break after a fixed number of reads. The body must include `firing_started` for the test to pass.

- [ ] **Step 5: Commit**

```bash
git add web/backend/src/udcpine_backend/app.py web/backend/tests/test_api.py
git commit -m "feat(web): /api/stream SSE endpoint"
```

---

## Task 10: Frontend — POST helpers + LiveEvent parsing

**Files:**
- Modify: `web/frontend/src/api.ts`

- [ ] **Step 1: Replace `web/frontend/src/api.ts`**

```typescript
import {
  FiringSchema,
  LiveStateSchema,
  type Firing,
  type LiveState,
} from "@udcpine/shared";

/**
 * Fetch the current dashboard snapshot. Validates against the shared Zod
 * schema; throws on network or contract violations.
 */
export async function fetchState(): Promise<LiveState> {
  const res = await fetch("/api/state");
  if (!res.ok) throw new Error(`/api/state returned ${res.status}`);
  const json = (await res.json()) as unknown;
  const parsed = LiveStateSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`/api/state contract violation: ${parsed.error.message}`);
  }
  return parsed.data;
}

export async function startFiring(): Promise<Firing> {
  const res = await fetch("/api/firing/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!res.ok) throw new Error(`/api/firing/start returned ${res.status}`);
  const json = (await res.json()) as unknown;
  const parsed = FiringSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`/api/firing/start contract violation: ${parsed.error.message}`);
  }
  return parsed.data;
}

export async function endFiring(): Promise<Firing> {
  const res = await fetch("/api/firing/stop", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!res.ok) throw new Error(`/api/firing/stop returned ${res.status}`);
  const json = (await res.json()) as unknown;
  const parsed = FiringSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`/api/firing/stop contract violation: ${parsed.error.message}`);
  }
  return parsed.data;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web/frontend && bun run lint`
Expected: PASS.

---

## Task 11: Frontend — `reduce.ts` (pure event reducer)

**Files:**
- Create: `web/frontend/src/reduce.ts`

- [ ] **Step 1: Write `web/frontend/src/reduce.ts`**

```typescript
import type { LiveEvent, LiveState } from "@udcpine/shared";

/**
 * Fold one LiveEvent into a LiveState. Pure — no I/O, no time. Each
 * event maps to a single field swap; unknown variants (shouldn't reach
 * here because the dispatcher pre-validates with Zod) pass through.
 */
export function applyEvent(state: LiveState, event: LiveEvent): LiveState {
  switch (event.type) {
    case "sample":
      return {
        ...state,
        latest_sample: { t: event.t, temp_f: event.temp_f },
      };
    case "firing_started":
      return {
        ...state,
        firing: event.firing,
        latest_sample: null,
      };
    case "firing_ended":
      return {
        ...state,
        firing: null,
        latest_sample: null,
        active_pizza: null,
      };
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web/frontend && bun run lint`
Expected: PASS.

- [ ] **Step 3: Commit (groups Tasks 10 + 11)**

```bash
git add web/frontend/src/api.ts web/frontend/src/reduce.ts
git commit -m "feat(web): frontend POST helpers + LiveEvent reducer"
```

---

## Task 12: Frontend — `useLiveState` hook

**Files:**
- Create: `web/frontend/src/use-live-state.ts`

- [ ] **Step 1: Write `web/frontend/src/use-live-state.ts`**

```typescript
import { useEffect, useReducer } from "preact/hooks";
import { LiveEventSchema, type LiveState } from "@udcpine/shared";
import { applyEvent } from "./reduce";

type Action =
  | { kind: "reset"; state: LiveState }
  | { kind: "event"; raw: unknown };

function reducer(state: LiveState, action: Action): LiveState {
  switch (action.kind) {
    case "reset":
      return action.state;
    case "event": {
      const parsed = LiveEventSchema.safeParse(action.raw);
      if (!parsed.success) {
        console.warn("dropping malformed SSE event", parsed.error.message);
        return state;
      }
      return applyEvent(state, parsed.data);
    }
  }
}

/**
 * Subscribe to /api/stream and fold incoming LiveEvents into local state.
 * The caller seeds initial state from a prior /api/state fetch — we don't
 * re-fetch on reconnect (a deliberate simplification; documented in the
 * plan as a known limitation).
 */
export function useLiveState(initial: LiveState): LiveState {
  const [state, dispatch] = useReducer(reducer, initial);

  useEffect(() => {
    dispatch({ kind: "reset", state: initial });
    const es = new EventSource("/api/stream");
    es.onmessage = (e) => {
      try {
        const raw = JSON.parse(e.data);
        dispatch({ kind: "event", raw });
      } catch (err) {
        console.warn("dropping non-JSON SSE event", err);
      }
    };
    es.onerror = () => {
      // Browser EventSource auto-reconnects with exponential backoff.
      // Nothing for us to do.
    };
    return () => es.close();
    // We intentionally re-seed if the parent passes a new initial — e.g.
    // on retry after an error screen.
  }, [initial]);

  return state;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web/frontend && bun run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add web/frontend/src/use-live-state.ts
git commit -m "feat(web): useLiveState hook (fetch seed + SSE updates)"
```

---

## Task 13: Frontend — `IdleScreen` component

**Files:**
- Create: `web/frontend/src/views/idle-screen.tsx`
- Modify: `web/frontend/src/styles.css`

- [ ] **Step 1: Write `web/frontend/src/views/idle-screen.tsx`**

```tsx
import { useState } from "preact/hooks";
import { startFiring } from "../api";

interface IdleScreenProps {
  onStarted: () => void;
}

export function IdleScreen({ onStarted }: IdleScreenProps) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
      </header>

      <section class="idle">
        <button
          type="button"
          class="idle__start"
          onClick={onClick}
          disabled={busy}
        >
          {busy ? "STARTING…" : "START FIRING"}
        </button>
        <p class="idle__caption">begin a new session</p>
        {err !== null && <p class="idle__error">error: {err}</p>}
      </section>
    </main>
  );
}
```

- [ ] **Step 2: Add CSS for idle**

Append to `web/frontend/src/styles.css`:

```css
.idle {
  position: relative; z-index: 1;
  align-self: center;
  display: grid;
  place-items: center;
  gap: 18px;
  text-align: center;
}
.idle__start {
  appearance: none;
  background: var(--signal);
  color: var(--bg);
  border: 0;
  border-radius: 999px;
  padding: 28px 56px;
  font-family: inherit;
  font-weight: 700;
  font-size: 42px;
  letter-spacing: 6px;
  cursor: pointer;
  box-shadow: 0 0 0 1px rgba(255,255,255,0.08), 0 30px 80px rgba(255,106,26,0.35);
  transition: transform 120ms ease, box-shadow 120ms ease;
}
.idle__start:hover:not(:disabled) { transform: translateY(-2px); }
.idle__start:active:not(:disabled) { transform: translateY(1px); }
.idle__start:disabled { opacity: 0.6; cursor: progress; }
.idle__caption { color: var(--ink-soft); font-size: 14px; letter-spacing: 4px; }
.idle__error { color: var(--signal); font-size: 13px; }
```

- [ ] **Step 3: Typecheck**

Run: `cd web/frontend && bun run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add web/frontend/src/views/idle-screen.tsx web/frontend/src/styles.css
git commit -m "feat(web): IdleScreen view with START FIRING CTA"
```

---

## Task 14: Frontend — STOP button in HeroNumber + live-temp rendering

**Files:**
- Modify: `web/frontend/src/views/hero-number.tsx`
- Modify: `web/frontend/src/styles.css`

- [ ] **Step 1: Replace `web/frontend/src/views/hero-number.tsx`**

```tsx
import { useEffect, useState } from "preact/hooks";
import type { Firing, LiveState } from "@udcpine/shared";
import { endFiring } from "../api";

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
        {latest_sample === null && (
          <div class="hero__delta">awaiting sensor data</div>
        )}
      </section>
    </main>
  );
}
```

- [ ] **Step 2: Append STOP button styles to `web/frontend/src/styles.css`**

```css
.hero__right { display: inline-flex; align-items: center; gap: 16px; }
.hero__stop {
  appearance: none;
  background: transparent;
  color: var(--ink);
  border: 1px solid var(--bg-3);
  border-radius: 999px;
  padding: 6px 14px;
  font-family: inherit;
  font-size: 12px;
  letter-spacing: 3px;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
}
.hero__stop:hover:not(:disabled) {
  background: var(--signal);
  border-color: var(--signal);
  color: var(--bg);
}
.hero__stop:disabled { opacity: 0.6; cursor: progress; }
```

- [ ] **Step 3: Typecheck**

Run: `cd web/frontend && bun run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add web/frontend/src/views/hero-number.tsx web/frontend/src/styles.css
git commit -m "feat(web): HeroNumber gets STOP control + live temp"
```

---

## Task 15: Wire it all together in `App`

**Files:**
- Modify: `web/frontend/src/app.tsx`

- [ ] **Step 1: Replace `web/frontend/src/app.tsx`**

```tsx
import { useEffect, useState } from "preact/hooks";
import type { LiveState } from "@udcpine/shared";
import { fetchState } from "./api";
import { useLiveState } from "./use-live-state";
import { HeroNumber } from "./views/hero-number";
import { IdleScreen } from "./views/idle-screen";

type Boot =
  | { kind: "loading" }
  | { kind: "ok"; initial: LiveState }
  | { kind: "error"; message: string };

export function App() {
  const [boot, setBoot] = useState<Boot>({ kind: "loading" });

  // Tick this to force a re-fetch + re-mount of the live hook. Used after
  // start/stop to re-prime state cleanly, in case any SSE events were
  // dropped between the POST returning and the next SSE message landing.
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchState()
      .then((initial) => {
        if (!cancelled) setBoot({ kind: "ok", initial });
      })
      .catch((err: unknown) => {
        if (!cancelled) setBoot({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  if (boot.kind === "loading") return <main class="hero"><div class="hero__delta">loading…</div></main>;
  if (boot.kind === "error") return <main class="hero"><div class="hero__delta">error: {boot.message}</div></main>;

  return <Live initial={boot.initial} onAction={() => setNonce((n) => n + 1)} />;
}

function Live({
  initial,
  onAction,
}: {
  initial: LiveState;
  onAction: () => void;
}) {
  const state = useLiveState(initial);
  if (state.firing === null) return <IdleScreen onStarted={onAction} />;
  return <HeroNumber state={{ ...state, firing: state.firing }} onEnded={onAction} />;
}
```

- [ ] **Step 2: Typecheck + build**

Run: `cd web/frontend && bun run lint && bun run build`
Expected: both PASS; `dist/` produced.

- [ ] **Step 3: Commit**

```bash
git add web/frontend/src/app.tsx
git commit -m "feat(web): App switches Idle ↔ HeroNumber based on firing state"
```

---

## Task 16: End-to-end smoke test

**Files:** none — verification only.

- [ ] **Step 1: Cold start**

```bash
make build && make codegen && make lint && make test
```
Expected: all green; `git status` clean.

- [ ] **Step 2: Run both servers**

Run: `make dev`
Expected: Flask on `:5001`, Vite on `:5173`. Both stay up.

- [ ] **Step 3: Verify idle render**

Open `http://localhost:5173/`. Expected:
- Top-left: `OVEN · IDLE`.
- Center: big orange pill button labeled `START FIRING` with the caption "begin a new session" beneath.
- No errors in console (favicon 404 is OK).

- [ ] **Step 4: Verify start → live temp**

Click `START FIRING`. Expected:
- View flips to HeroNumber.
- Top-left: `FIRING #001 · ACTIVE 0:00:0X` ticking up.
- The big number begins at ~70 and climbs roughly 1.3 per second (linear ramp toward 850 over 10 min).
- Top-right shows LIVE + a STOP pill.

In DevTools → Network, the `/api/stream` row stays open; `EventSource` shows multiple `data: {...}` messages per second.

- [ ] **Step 5: Verify stop → idle**

Click `STOP`. Expected:
- View flips back to IdleScreen.
- `GET /api/state` re-fetched; returns idle.
- `EventSource` reopens for the next session.

- [ ] **Step 6: Restart-resistance check (server side)**

While idle, `Ctrl-C` Flask, restart with `make web-backend-run` in another shell. The frontend's EventSource auto-reconnects within a few seconds. State on reload reflects fresh idle (we lost in-memory state — expected per "no persistence").

- [ ] **Step 7: Stop the servers, no commit (verification only).**

---

## Self-review checklist

- [ ] Every file in File Structure has a creating or modifying task.
- [ ] No "TBD"/"TODO"/"implement later" anywhere in the task bodies.
- [ ] Identifiers cross-reference correctly: `Store` (Task 5/6), `MockSensorThread` (Task 7), `LiveEventSchema` (Task 2), `applyEvent` (Task 11), `useLiveState` (Task 12), `IdleScreen` (Task 13).
- [ ] Schema changes in shared/ are matched by codegen-regeneration steps in those same tasks.
- [ ] Backend tests use TDD (failing-first) for `Store`, `MockSensorThread`, and the API surface.
- [ ] Frontend changes don't ship without `bun run lint` and `bun run build` passing.
- [ ] Drift sanity check is implicit in Step 6 of Task 16; we don't repeat the explicit edit-and-revert this time because the bridge was exercised hard in PR #17.
- [ ] `mock_state.py` is fully removed; no orphan references remain.
- [ ] The SSE stream's wire shape matches `LiveEventSchema` (verified by Task 9 test).
- [ ] Idle and active UIs share the `hero__ember` background; no jarring layout shift between them.
- [ ] CLAUDE.md safety rails respected: no GitHub writes proposed; pushes/PRs deferred to user instruction; no hook-skip.

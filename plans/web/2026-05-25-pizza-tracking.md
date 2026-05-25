# Pizza Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Context

A firing is a session that bakes pizzas, but pizzas don't yet exist as a
first-class concept in the app. The `LiveState.active_pizza` slot has been
in the wire shape since the firing-state plan but has always been `null`;
the `LiveEvent` union has shaped-but-unused slots for `pizza_started` and
`pizza_ended` in the design doc that we deferred. This plan lands them.

The dashboard's main interaction during a firing becomes: type a pizza
name on your phone, tap **NEXT PIZZA** — that ends the currently-baking
pizza (if any) and starts a new one. Each tap = one pizza. Stopping the
firing auto-ends whatever pizza is in the oven.

**Goal:** A user can record a sequence of named pizzas during a firing — each tap of NEXT PIZZA ends the active pizza and starts a new one — with the dashboard showing the currently-baking pizza's name and elapsed time, and full pizza history persisted in SQLite.

**Architecture:** A new `pizza` SQLite table (`id, firing_id, seq, name, started_at, ended_at`) is added to the schema. The firing `Store` gains `active_pizza()`, `next_pizza(name)`, `end_active_pizza()`, and `pizzas(firing_id)` methods — write-through to SQLite with an in-memory `_active_pizza` cache, identical pattern to the existing `_firing`/`_latest_sample` caches. `next_pizza` atomically ends any active pizza and starts a new one with `seq = max(seq)+1` within the firing. `stop_firing` calls `end_active_pizza()` internally. The Store broadcasts `pizza_started` and `pizza_ended` SSE events alongside the existing `firing_started`/`firing_ended`/`sample`. A new `POST /api/pizza/next` endpoint with body `{ name }` drives it from the frontend; the active firing's HeroNumber view gains a pizza card showing name + elapsed, plus a text input and the NEXT PIZZA button. Shared wire types: `PizzaSchema` drops `target_seconds`, `PizzaNextRequestSchema` is added (`{ name }`), and `LiveEventSchema` grows the two new variants.

**Tech Stack:** No new dependencies. Same SQLite/Flask/Preact stack.

---

## Conscious decisions

1. **One atomic endpoint, `POST /api/pizza/next`, not separate start/end.** Matches the single-button "NEXT PIZZA" UX. End-and-start happens in one transaction in the Store, so two clients tapping simultaneously can't race into two active pizzas. (The `Store._lock` already serializes everything; the atomicity is free.)
2. **`seq` is per-firing, autoincremented inside the Store, not by SQLite.** Computed as `MAX(seq) + 1` for the firing on every `next_pizza`. Matches the design doc's `UNIQUE(firing_id, seq)`; resets to 1 each firing. SQLite `AUTOINCREMENT` on a global `id` doesn't give per-firing sequences.
3. **`target_seconds` dropped from `PizzaSchema`.** Decided this session — we'll show elapsed only; chef judges by eye + temperature. Removing it is a wire-type break vs. PR #17, but no live frontend code reads it (the current HeroNumber doesn't render a pizza card at all yet).
4. **`stop_firing` auto-ends the active pizza.** No "you must end the pizza first" friction. The firing-ended path internally calls `end_active_pizza()` before its own DB update; both events broadcast.
5. **The text input lives next to the NEXT PIZZA button.** Same UI on phone and kiosk — a phone has a soft keyboard, the laptop kiosk has a real one, the future Pi touch-screen will get an on-screen keyboard. No device-specific code path.
6. **Empty name is rejected (400).** `PizzaNextRequest` requires `name: z.string().min(1)`. The frontend disables the button while the input is empty; the backend enforces. No silent default like "Pizza N" — Pete chose explicit naming.
7. **No separate pizza_id stream / no `/api/pizza/list` endpoint.** The history is queryable via the Store's `pizzas(firing_id)` (consumed by the future Drive plan); not exposed over HTTP yet because nothing on the frontend wants it. (If session history later wants it, add the endpoint then.)

## Out of scope

- Editing a pizza after it ends (rename, adjust times) — design doc puts this in Polish.
- Pizza photos.
- Per-pizza progress bars / target cook times.
- A "list past pizzas in this firing" view — `pizzas(firing_id)` exists in the Store but no UI/endpoint surfaces it yet.

---

## File structure

```
udcpinepdx/
├── plans/web/2026-05-25-pizza-tracking.md            (NEW — this plan)
├── shared/
│   ├── src/
│   │   ├── pizza.ts                                   (MODIFY — drop target_seconds)
│   │   ├── pizza-next-request.ts                      (NEW — { name })
│   │   ├── live-event.ts                              (MODIFY — add pizza_started / pizza_ended)
│   │   └── index.ts                                   (MODIFY — register PizzaNextRequest)
│   └── tests/fixtures/
│       ├── pizza/valid/cooking.json                   (MODIFY — drop target_seconds)
│       ├── pizza/invalid/empty-name.json              (unchanged — still invalid: empty name)
│       ├── livestate/valid/active.json                (MODIFY — drop active_pizza.target_seconds)
│       ├── liveevent/valid/pizza-started.json         (NEW)
│       ├── liveevent/valid/pizza-ended.json           (NEW)
│       └── pizzanextrequest/                          (NEW — valid + invalid)
├── web/backend/
│   ├── src/udcpine_backend/
│   │   ├── schema.sql                                 (MODIFY — pizza table)
│   │   ├── store.py                                   (MODIFY — pizza methods + cache + auto-end on stop)
│   │   └── app.py                                     (MODIFY — POST /api/pizza/next + LiveState wires active_pizza)
│   └── tests/
│       ├── test_store.py                              (MODIFY — pizza tests)
│       └── test_api.py                                (MODIFY — /api/pizza/next tests, stop auto-ends pizza)
└── web/frontend/
    └── src/
        ├── api.ts                                     (MODIFY — nextPizza(name))
        ├── reduce.ts                                  (MODIFY — fold pizza_started / pizza_ended)
        ├── views/hero-number.tsx                      (MODIFY — pizza card + input + NEXT PIZZA button)
        └── styles.css                                 (MODIFY — pizza card + form styles)
```

The e2e spec keeps its existing scope (no new pizza test) — the firing-flow
test already drives idle → start → live temp → stop and is unaffected.
A pizza-flow e2e test is sensible follow-up if pizza ever breaks; for this
plan the Store-level unit tests + manual smoke verify the flow.

---

## Task 1: Shared wire types — Pizza shape, new request, two new events

**Files:**
- Modify: `shared/src/pizza.ts`
- Create: `shared/src/pizza-next-request.ts`
- Modify: `shared/src/live-event.ts`
- Modify: `shared/src/index.ts`
- Modify: `shared/tests/fixtures/pizza/valid/cooking.json`
- Modify: `shared/tests/fixtures/livestate/valid/active.json`
- Create: `shared/tests/fixtures/liveevent/valid/pizza-started.json`
- Create: `shared/tests/fixtures/liveevent/valid/pizza-ended.json`
- Create: `shared/tests/fixtures/pizzanextrequest/valid/normal.json`
- Create: `shared/tests/fixtures/pizzanextrequest/invalid/empty-name.json`
- Modify: `shared/tests/test_contract.py`

- [ ] **Step 1: Update `shared/src/pizza.ts` to drop `target_seconds`**

Replace the file with:

```typescript
import { z } from "zod";

/**
 * One pizza inside a firing. `seq` is its order within the firing
 * (1 = first pizza of the night). The chef judges done-ness by eye +
 * temperature; we record start/end times and a name, nothing more.
 */
export const PizzaSchema = z.object({
  id: z.number().int().nonnegative(),
  firing_id: z.number().int().nonnegative(),
  seq: z.number().int().positive(),
  name: z.string().min(1),
  started_at: z.string().datetime({ offset: true }),
  ended_at: z.string().datetime({ offset: true }).nullable(),
});

export type Pizza = z.infer<typeof PizzaSchema>;
```

Note `firing_id` is now part of the wire shape (it was only on the design
doc's SQL table before), and `ended_at` is now nullable (it was missing
from the wire type — Pizza was implicitly "currently cooking"). Both
align the wire shape with the SQL table.

- [ ] **Step 2: Write `shared/src/pizza-next-request.ts`**

```typescript
import { z } from "zod";

/**
 * POST /api/pizza/next body. Atomically ends any currently-active pizza
 * in the firing and starts a new one with the given name.
 */
export const PizzaNextRequestSchema = z.object({
  name: z.string().min(1),
});

export type PizzaNextRequest = z.infer<typeof PizzaNextRequestSchema>;
```

- [ ] **Step 3: Add `pizza_started` / `pizza_ended` to `shared/src/live-event.ts`**

Replace the file with:

```typescript
import { z } from "zod";
import { FiringSchema } from "./firing.ts";
import { PizzaSchema } from "./pizza.ts";

/**
 * Payload of one SSE message on /api/stream. Discriminated by `type`.
 * The frontend uses a discriminated-union switch to narrow each variant.
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
  z.object({
    type: z.literal("pizza_started"),
    pizza: PizzaSchema,
  }),
  z.object({
    type: z.literal("pizza_ended"),
    pizza: PizzaSchema,
  }),
]);

export type LiveEvent = z.infer<typeof LiveEventSchema>;
export type SampleEvent = Extract<LiveEvent, { type: "sample" }>;
```

Note `pizza_ended` carries the full `Pizza` (not just an id) because the
ended pizza is the natural unit a frontend reducer wants — it includes the
populated `ended_at` and the same `id` for matching against any cached
state.

- [ ] **Step 4: Register `PizzaNextRequestSchema` in `shared/src/index.ts`**

Add the import, export, type re-export, and `ALL_SCHEMAS` entry. The file becomes:

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
import { PizzaNextRequestSchema } from "./pizza-next-request.ts";

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
  PizzaNextRequestSchema,
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
export type { PizzaNextRequest } from "./pizza-next-request.ts";

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
  PizzaNextRequest: PizzaNextRequestSchema,
} as const;
```

- [ ] **Step 5: Update fixtures**

Replace `shared/tests/fixtures/pizza/valid/cooking.json` with:

```json
{
  "id": 3,
  "firing_id": 42,
  "seq": 3,
  "name": "Margherita",
  "started_at": "2026-04-28T19:46:18-07:00",
  "ended_at": null
}
```

Replace `shared/tests/fixtures/livestate/valid/active.json` with:

```json
{
  "firing": {
    "id": 42,
    "started_at": "2026-04-28T18:24:00-07:00",
    "ended_at": null,
    "status": "active"
  },
  "latest_sample": {
    "t": "2026-04-28T19:46:48-07:00",
    "temp_f": 847.0
  },
  "active_pizza": {
    "id": 3,
    "firing_id": 42,
    "seq": 3,
    "name": "Margherita",
    "started_at": "2026-04-28T19:46:18-07:00",
    "ended_at": null
  }
}
```

Create `shared/tests/fixtures/liveevent/valid/pizza-started.json`:

```json
{
  "type": "pizza_started",
  "pizza": {
    "id": 1,
    "firing_id": 42,
    "seq": 1,
    "name": "Margherita",
    "started_at": "2026-04-28T18:46:18-07:00",
    "ended_at": null
  }
}
```

Create `shared/tests/fixtures/liveevent/valid/pizza-ended.json`:

```json
{
  "type": "pizza_ended",
  "pizza": {
    "id": 1,
    "firing_id": 42,
    "seq": 1,
    "name": "Margherita",
    "started_at": "2026-04-28T18:46:18-07:00",
    "ended_at": "2026-04-28T18:48:36-07:00"
  }
}
```

Create `shared/tests/fixtures/pizzanextrequest/valid/normal.json`:

```json
{ "name": "Margherita" }
```

Create `shared/tests/fixtures/pizzanextrequest/invalid/empty-name.json`:

```json
{ "name": "" }
```

- [ ] **Step 6: Register `PizzaNextRequest` in `shared/tests/test_contract.py`**

Change the import:

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

to:

```python
from generated.pydantic import (
    ExchangeRequest,
    Firing,
    LiveEvent,
    LiveState,
    PairingToken,
    Pizza,
    PizzaNextRequest,
    Sample,
)
```

And add to the `MODELS` dict (insert in alphabetic position):

```python
    "pizzanextrequest": PizzaNextRequest,
```

- [ ] **Step 7: Regenerate + test**

Run: `make codegen && make shared-test`
Expected: codegen succeeds; shared tests pass. New count: prior 19 + 2 valid pizza events + 1 valid pizza-next-request + 1 invalid pizza-next-request = **23**.

- [ ] **Step 8: Commit**

```bash
git add shared/src/ shared/tests/fixtures/ shared/tests/test_contract.py shared/generated/
git commit -m "feat(shared): pizza_started/pizza_ended events + PizzaNextRequest; Pizza without target_seconds"
```

---

## Task 2: SQLite `pizza` table

**Files:**
- Modify: `web/backend/src/udcpine_backend/schema.sql`
- Modify: `web/backend/tests/test_db.py`

- [ ] **Step 1: Add the `pizza` table to `web/backend/src/udcpine_backend/schema.sql`**

Append (before EOF):

```sql
CREATE TABLE IF NOT EXISTS pizza (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  firing_id   INTEGER NOT NULL REFERENCES firing(id),
  seq         INTEGER NOT NULL,
  name        TEXT NOT NULL,
  started_at  TEXT NOT NULL,
  ended_at    TEXT,
  UNIQUE (firing_id, seq)
);

CREATE INDEX IF NOT EXISTS pizza_firing_idx ON pizza(firing_id);
```

- [ ] **Step 2: Extend `web/backend/tests/test_db.py`**

Append:

```python
def test_pizza_table_exists(tmp_path) -> None:
    conn = connect(str(tmp_path / "t.db"))
    tables = {
        row[0]
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
    }
    assert "pizza" in tables


def test_pizza_seq_unique_per_firing(tmp_path) -> None:
    conn = connect(str(tmp_path / "t.db"))
    conn.execute(
        "INSERT INTO firing (started_at, ended_at, status) VALUES (?, ?, ?)",
        ("2026-01-01T00:00:00Z", None, "active"),
    )
    firing_id = conn.execute("SELECT id FROM firing").fetchone()["id"]
    conn.execute(
        "INSERT INTO pizza (firing_id, seq, name, started_at, ended_at) VALUES (?, 1, 'a', '2026-01-01T00:00:00Z', NULL)",
        (firing_id,),
    )
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO pizza (firing_id, seq, name, started_at, ended_at) VALUES (?, 1, 'b', '2026-01-01T00:00:00Z', NULL)",
            (firing_id,),
        )
    conn.commit()
```

- [ ] **Step 3: Run db tests**

Run: `cd web/backend && uv run pytest tests/test_db.py -v`
Expected: 6 PASS (4 prior + 2 new).

- [ ] **Step 4: Commit**

```bash
git add web/backend/src/udcpine_backend/schema.sql web/backend/tests/test_db.py
git commit -m "feat(web): pizza table in SQLite schema"
```

---

## Task 3: Store pizza methods — `next_pizza`, `end_active_pizza`, accessors

**Files:**
- Modify: `web/backend/src/udcpine_backend/store.py`
- Modify: `web/backend/tests/test_store.py`

- [ ] **Step 1: Write failing tests in `web/backend/tests/test_store.py`**

Append:

```python
def test_new_store_has_no_active_pizza(db_path) -> None:
    s = Store(db_path, clock=FixedClock(T0))
    s.start_firing()
    assert s.active_pizza() is None


def test_next_pizza_starts_first_pizza(db_path) -> None:
    s = Store(db_path, clock=FixedClock(T0))
    firing = s.start_firing()
    pizza = s.next_pizza(name="Margherita")
    assert pizza is not None
    assert pizza.firing_id == firing.id
    assert pizza.seq == 1
    assert pizza.name == "Margherita"
    assert pizza.ended_at is None
    assert s.active_pizza() == pizza


def test_next_pizza_ends_previous_and_increments_seq(db_path) -> None:
    s = Store(db_path, clock=AdvancingClock(T0))
    s.start_firing()
    first = s.next_pizza(name="Margherita")
    second = s.next_pizza(name="Funghi")
    assert second.seq == first.seq + 1
    # The first must now be ended (queryable via pizzas()).
    history = s.pizzas(first.firing_id)
    by_seq = {p.seq: p for p in history}
    assert by_seq[1].ended_at is not None
    assert by_seq[2].ended_at is None  # the current active one
    assert s.active_pizza() == second


def test_next_pizza_with_no_firing_returns_none(db_path) -> None:
    s = Store(db_path, clock=FixedClock(T0))
    assert s.next_pizza(name="Margherita") is None
    assert s.active_pizza() is None


def test_end_active_pizza_returns_the_ended_pizza(db_path) -> None:
    s = Store(db_path, clock=AdvancingClock(T0))
    s.start_firing()
    started = s.next_pizza(name="Margherita")
    ended = s.end_active_pizza()
    assert ended is not None
    assert ended.id == started.id
    assert ended.ended_at is not None
    assert s.active_pizza() is None


def test_end_active_pizza_when_none_returns_none(db_path) -> None:
    s = Store(db_path, clock=FixedClock(T0))
    s.start_firing()
    assert s.end_active_pizza() is None


def test_stop_firing_auto_ends_active_pizza(db_path) -> None:
    s = Store(db_path, clock=AdvancingClock(T0))
    firing = s.start_firing()
    s.next_pizza(name="Margherita")
    s.stop_firing()
    assert s.active_pizza() is None
    # The pizza row remains with ended_at populated.
    [pizza] = s.pizzas(firing.id)
    assert pizza.ended_at is not None


def test_pizza_events_broadcast(db_path) -> None:
    s = Store(db_path, clock=AdvancingClock(T0))
    s.start_firing()
    q = s.subscribe()
    s.next_pizza(name="Margherita")
    # First a pizza_started for the new pizza (no prior active to end).
    e1 = q.get(timeout=0.5)
    assert e1["type"] == "pizza_started"
    assert e1["pizza"]["name"] == "Margherita"
    s.next_pizza(name="Funghi")
    # Now two events: pizza_ended (Margherita), pizza_started (Funghi).
    e2 = q.get(timeout=0.5)
    e3 = q.get(timeout=0.5)
    assert e2["type"] == "pizza_ended"
    assert e2["pizza"]["name"] == "Margherita"
    assert e2["pizza"]["ended_at"] is not None
    assert e3["type"] == "pizza_started"
    assert e3["pizza"]["name"] == "Funghi"


def test_emitted_pizza_events_validate_against_schema(db_path) -> None:
    from generated.pydantic import LiveEvent

    s = Store(db_path, clock=AdvancingClock(T0))
    q = s.subscribe()
    s.start_firing()
    s.next_pizza(name="Margherita")
    s.next_pizza(name="Funghi")
    s.stop_firing()
    # 6 events total: firing_started, pizza_started, pizza_ended,
    # pizza_started, pizza_ended (auto on stop), firing_ended.
    for _ in range(6):
        LiveEvent.model_validate(q.get(timeout=0.5))


def test_active_pizza_is_rehydrated_by_a_new_store(db_path) -> None:
    s1 = Store(db_path, clock=AdvancingClock(T0))
    s1.start_firing()
    started = s1.next_pizza(name="Margherita")
    s2 = Store(db_path, clock=AdvancingClock(T0))
    resumed = s2.active_pizza()
    assert resumed is not None
    assert resumed.id == started.id
    assert resumed.name == "Margherita"
    assert resumed.ended_at is None
```

- [ ] **Step 2: Run; verify failures**

Run: `cd web/backend && uv run pytest tests/test_store.py -v`
Expected: all the new tests fail (`Store` has no pizza methods).

- [ ] **Step 3: Add pizza methods to `web/backend/src/udcpine_backend/store.py`**

Add `Pizza` to the generated-pydantic import:

```python
from generated.pydantic import Firing, Pizza, Sample
```

Add a row-to-Pizza helper near `_firing_from_row`:

```python
def _pizza_from_row(row: Any) -> Pizza:
    return Pizza.model_validate(
        {
            "id": row["id"],
            "firing_id": row["firing_id"],
            "seq": row["seq"],
            "name": row["name"],
            "started_at": row["started_at"],
            "ended_at": row["ended_at"],
        }
    )
```

In `Store.__init__`, add the cache (after `_latest_sample`):

```python
        self._active_pizza: Pizza | None = None
```

Extend `_rehydrate` to also load the active pizza. After the existing
`self._latest_sample = ...` block, add:

```python
        prow = self._conn.execute(
            "SELECT * FROM pizza WHERE firing_id=? AND ended_at IS NULL ORDER BY seq DESC LIMIT 1",
            (self._firing.id,),
        ).fetchone()
        if prow is not None:
            self._active_pizza = _pizza_from_row(prow)
```

Add the public accessors near `latest_sample`:

```python
    def active_pizza(self) -> Pizza | None:
        with self._lock:
            return self._active_pizza

    def pizzas(self, firing_id: int) -> list[Pizza]:
        """All pizzas for a firing, in seq order."""
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM pizza WHERE firing_id=? ORDER BY seq",
                (firing_id,),
            ).fetchall()
        return [_pizza_from_row(r) for r in rows]
```

Add the mutators. Put `_end_active_pizza_locked` as an internal helper
that callers already holding `self._lock` use, and a public
`end_active_pizza` that takes the lock. Together with `next_pizza`:

```python
    def _end_active_pizza_locked(self) -> Pizza | None:
        """Caller must hold self._lock. Returns the ended pizza, or None."""
        if self._active_pizza is None:
            return None
        ended_at = self._clock.now().isoformat()
        self._conn.execute(
            "UPDATE pizza SET ended_at=? WHERE id=?",
            (ended_at, self._active_pizza.id),
        )
        self._conn.commit()
        ended = self._active_pizza.model_copy(update={"ended_at": self._clock.now()})
        self._active_pizza = None
        return ended

    def end_active_pizza(self) -> Pizza | None:
        with self._lock:
            ended = self._end_active_pizza_locked()
            if ended is None:
                return None
            event: dict[str, Any] = {
                "type": "pizza_ended",
                "pizza": ended.model_dump(mode="json"),
            }
        self._broadcast(event)
        return ended

    def next_pizza(self, *, name: str) -> Pizza | None:
        """End any active pizza, then start a new one with `name`. Returns
        the new pizza, or None if no firing is active."""
        events: list[dict[str, Any]] = []
        with self._lock:
            if self._firing is None:
                return None
            ended = self._end_active_pizza_locked()
            if ended is not None:
                events.append(
                    {"type": "pizza_ended", "pizza": ended.model_dump(mode="json")}
                )
            row = self._conn.execute(
                "SELECT COALESCE(MAX(seq), 0) AS s FROM pizza WHERE firing_id=?",
                (self._firing.id,),
            ).fetchone()
            seq = row["s"] + 1
            started_at = self._clock.now().isoformat()
            cur = self._conn.execute(
                "INSERT INTO pizza (firing_id, seq, name, started_at, ended_at) VALUES (?, ?, ?, ?, NULL)",
                (self._firing.id, seq, name, started_at),
            )
            self._conn.commit()
            pizza = Pizza.model_validate(
                {
                    "id": cur.lastrowid,
                    "firing_id": self._firing.id,
                    "seq": seq,
                    "name": name,
                    "started_at": started_at,
                    "ended_at": None,
                }
            )
            self._active_pizza = pizza
            events.append(
                {"type": "pizza_started", "pizza": pizza.model_dump(mode="json")}
            )
        for ev in events:
            self._broadcast(ev)
        return pizza
```

Modify `stop_firing` to auto-end the active pizza first. Change the
existing `stop_firing` method's `with self._lock:` block so that, before
the firing UPDATE, it ends any active pizza. The full updated method:

```python
    def stop_firing(self) -> Firing | None:
        events: list[dict[str, Any]] = []
        with self._lock:
            if self._firing is None:
                return None
            ended_pizza = self._end_active_pizza_locked()
            if ended_pizza is not None:
                events.append(
                    {"type": "pizza_ended", "pizza": ended_pizza.model_dump(mode="json")}
                )
            ended_at = self._clock.now().isoformat()
            self._conn.execute(
                "UPDATE firing SET ended_at=?, status='ended' WHERE id=?",
                (ended_at, self._firing.id),
            )
            self._conn.commit()
            ended = self._firing.model_copy(
                update={"ended_at": self._clock.now(), "status": "ended"}
            )
            firing_id = ended.id
            self._firing = None
            self._latest_sample = None
            events.append({"type": "firing_ended", "firing_id": firing_id})
        for ev in events:
            self._broadcast(ev)
        return ended
```

Finally, `start_firing` must clear `_active_pizza` (a new firing starts
with no active pizza). Update its cache-clearing line. The existing line:

```python
            self._latest_sample = None
```

becomes:

```python
            self._latest_sample = None
            self._active_pizza = None
```

- [ ] **Step 4: Run all store tests**

Run: `cd web/backend && uv run pytest tests/test_store.py -v`
Expected: 27 PASS (17 prior + 10 new).

- [ ] **Step 5: Commit**

```bash
git add web/backend/src/udcpine_backend/store.py web/backend/tests/test_store.py
git commit -m "feat(web): Store pizza methods (next/end/active/series) + auto-end on stop_firing"
```

---

## Task 4: API — `POST /api/pizza/next` + `LiveState.active_pizza` wired

**Files:**
- Modify: `web/backend/src/udcpine_backend/app.py`
- Modify: `web/backend/tests/test_api.py`

- [ ] **Step 1: Append failing tests to `web/backend/tests/test_api.py`**

```python
def test_pizza_next_without_firing_is_409(paired_client) -> None:
    res = paired_client.post("/api/pizza/next", json={"name": "Margherita"})
    assert res.status_code == 409


def test_pizza_next_starts_a_pizza(paired_client) -> None:
    paired_client.post("/api/firing/start")
    res = paired_client.post("/api/pizza/next", json={"name": "Margherita"})
    assert res.status_code == 200
    body = json.loads(res.data)
    assert body["name"] == "Margherita"
    assert body["seq"] == 1
    assert body["ended_at"] is None


def test_pizza_next_rejects_empty_name(paired_client) -> None:
    paired_client.post("/api/firing/start")
    res = paired_client.post("/api/pizza/next", json={"name": ""})
    assert res.status_code == 400


def test_state_reflects_active_pizza(paired_client) -> None:
    paired_client.post("/api/firing/start")
    paired_client.post("/api/pizza/next", json={"name": "Margherita"})
    state = LiveState.model_validate(json.loads(paired_client.get("/api/state").data))
    assert state.active_pizza is not None
    assert state.active_pizza.name == "Margherita"


def test_stop_firing_clears_active_pizza_in_state(paired_client) -> None:
    paired_client.post("/api/firing/start")
    paired_client.post("/api/pizza/next", json={"name": "Margherita"})
    paired_client.post("/api/firing/stop")
    state = LiveState.model_validate(json.loads(paired_client.get("/api/state").data))
    assert state.firing is None
    assert state.active_pizza is None
```

- [ ] **Step 2: Verify failures**

Run: `cd web/backend && uv run pytest tests/test_api.py -v`
Expected: 5 new tests fail.

- [ ] **Step 3: Update `web/backend/src/udcpine_backend/app.py`**

Extend the generated-pydantic import:

```python
from generated.pydantic import ExchangeRequest, LiveState, PizzaNextRequest
```

Wire `active_pizza` into the `get_state` response. The existing
`get_state`:

```python
    @app.get("/api/state")
    def get_state() -> Response:
        firing = s.firing()
        sample = s.latest_sample()
        state = LiveState(firing=firing, latest_sample=sample, active_pizza=None)
        return Response(state.model_dump_json(), mimetype="application/json")
```

becomes:

```python
    @app.get("/api/state")
    def get_state() -> Response:
        firing = s.firing()
        sample = s.latest_sample()
        pizza = s.active_pizza()
        state = LiveState(firing=firing, latest_sample=sample, active_pizza=pizza)
        return Response(state.model_dump_json(), mimetype="application/json")
```

Add the new route — place it next to the firing routes, before the auth
routes for grouping:

```python
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
            return Response(
                '{"error":"no active firing"}', status=409, mimetype="application/json"
            )
        return Response(pizza.model_dump_json(), mimetype="application/json")
```

- [ ] **Step 4: Run the full backend suite**

Run: `cd web/backend && uv run pytest -v`
Expected: all pass — `test_db.py` (6), `test_store.py` (27), `test_auth_store.py` (7), `test_mock_sensor.py` (5), `test_api.py` (19). Total **64**.

- [ ] **Step 5: Commit**

```bash
git add web/backend/src/udcpine_backend/app.py web/backend/tests/test_api.py
git commit -m "feat(web): POST /api/pizza/next + LiveState carries active_pizza"
```

---

## Task 5: Frontend — `nextPizza` API + reducer handles pizza events

**Files:**
- Modify: `web/frontend/src/api.ts`
- Modify: `web/frontend/src/reduce.ts`

- [ ] **Step 1: Add `nextPizza` to `web/frontend/src/api.ts`**

Extend the imports at the top of the file:

```typescript
import {
  FiringSchema,
  LiveStateSchema,
  PairingTokenSchema,
  PizzaSchema,
  type Firing,
  type LiveState,
  type PairingToken,
  type Pizza,
} from "@udcpine/shared";
```

Append the function near the existing `startFiring`/`endFiring`:

```typescript
export async function nextPizza(name: string): Promise<Pizza> {
  const res = await fetch("/api/pizza/next", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new Error(`/api/pizza/next returned ${res.status}`);
  const parsed = PizzaSchema.safeParse(await res.json());
  if (!parsed.success) {
    throw new Error(`/api/pizza/next contract violation: ${parsed.error.message}`);
  }
  return parsed.data;
}
```

- [ ] **Step 2: Extend the reducer in `web/frontend/src/reduce.ts`**

Replace the file with:

```typescript
import type { LiveEvent, LiveState } from "@udcpine/shared";

/**
 * Fold one LiveEvent into a LiveState. Pure — no I/O, no time.
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
        active_pizza: null,
      };
    case "firing_ended":
      return {
        ...state,
        firing: null,
        latest_sample: null,
        active_pizza: null,
      };
    case "pizza_started":
      return {
        ...state,
        active_pizza: event.pizza,
      };
    case "pizza_ended":
      // The backend will follow up with a pizza_started if there's a new
      // pizza; we just drop the active one here. If the ended pizza isn't
      // the one we have cached (unlikely), clear anyway — server is truth.
      return {
        ...state,
        active_pizza:
          state.active_pizza !== null && state.active_pizza.id === event.pizza.id
            ? null
            : state.active_pizza,
      };
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `cd web/frontend && bun run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add web/frontend/src/api.ts web/frontend/src/reduce.ts
git commit -m "feat(web): nextPizza API + reducer handles pizza events"
```

---

## Task 6: Frontend — pizza card + NEXT PIZZA control in HeroNumber

**Files:**
- Modify: `web/frontend/src/views/hero-number.tsx`
- Modify: `web/frontend/src/styles.css`

The pizza affordance has **three visible states**, so the input never
"competes" with the active pizza card:

1. **No active pizza** (firing started, no pizza yet) — input + "START PIZZA" button.
2. **Active pizza, read mode** — card with name + elapsed; small "NEXT PIZZA →" button. No input visible.
3. **Active pizza, composing next** — a compact "now baking: {name} · {elapsed}" label, plus input + "GO" button + "cancel" link. Pressing the link returns to read mode without changing pizza state. Submitting ends the current pizza and starts the new one (the existing atomic `nextPizza` call), which clears `composing` via an effect when `active_pizza.id` changes.

- [ ] **Step 1: Rewrite `web/frontend/src/views/hero-number.tsx`**

```tsx
import { useEffect, useState } from "preact/hooks";
import type { Firing, LiveState } from "@udcpine/shared";
import { endFiring, nextPizza } from "../api";
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

function formatMS(ms: number): string {
  if (Number.isNaN(ms) || ms < 0) return "0:00";
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function HeroNumber({ state, onEnded }: HeroNumberProps) {
  const now = useTick(1000);
  const [stopBusy, setStopBusy] = useState(false);
  const [pairing, setPairing] = useState(false);
  const [pizzaName, setPizzaName] = useState("");
  const [pizzaBusy, setPizzaBusy] = useState(false);
  // `composing` only matters when there IS an active pizza. When there
  // isn't, the form is always shown (state 1). When there is, we toggle
  // between read mode (state 2) and composing (state 3).
  const [composing, setComposing] = useState(false);
  const { firing, latest_sample, active_pizza } = state;

  // When the active pizza changes — either we just submitted and a new
  // one started via SSE, or the firing ended — exit composing mode so the
  // UI returns to read mode (or no-pizza mode) cleanly.
  const activePizzaId = active_pizza?.id ?? null;
  useEffect(() => {
    setComposing(false);
  }, [activePizzaId]);

  const firingElapsed = formatHMS(now - Date.parse(firing.started_at));
  const tempLabel =
    latest_sample !== null ? Math.round(latest_sample.temp_f).toString() : "—";
  const pizzaElapsed =
    active_pizza !== null
      ? formatMS(now - Date.parse(active_pizza.started_at))
      : null;

  async function onStop() {
    setStopBusy(true);
    try {
      await endFiring();
      onEnded();
    } catch {
      setStopBusy(false);
    }
  }

  async function onSubmitPizza(e: Event) {
    e.preventDefault();
    const name = pizzaName.trim();
    if (name.length === 0 || pizzaBusy) return;
    setPizzaBusy(true);
    try {
      await nextPizza(name);
      setPizzaName("");
      // `composing` clears via the activePizzaId effect once SSE lands.
    } finally {
      setPizzaBusy(false);
    }
  }

  const showForm = active_pizza === null || composing;
  const formButtonLabel = active_pizza === null ? "START PIZZA" : "GO";

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

      <footer class="hero__pizza-bar">
        {active_pizza !== null && !composing && (
          /* State 2: read mode — card with name + elapsed + NEXT button. */
          <div class="pizza-card">
            <span class="pizza-card__label">NOW BAKING</span>
            <span class="pizza-card__name">{active_pizza.name}</span>
            <span class="pizza-card__elapsed" aria-label="pizza elapsed">
              {pizzaElapsed}
            </span>
            <button
              type="button"
              class="pizza-card__next"
              onClick={() => setComposing(true)}
            >
              NEXT PIZZA →
            </button>
          </div>
        )}

        {active_pizza !== null && composing && (
          /* State 3: composing-next — compact context label above the form. */
          <div class="pizza-current">
            now baking: <b>{active_pizza.name}</b> · {pizzaElapsed}
          </div>
        )}

        {showForm && (
          <form class="pizza-form" onSubmit={onSubmitPizza}>
            <input
              class="pizza-form__input"
              type="text"
              placeholder={active_pizza === null ? "first pizza name" : "next pizza name"}
              value={pizzaName}
              onInput={(e) => setPizzaName((e.target as HTMLInputElement).value)}
              disabled={pizzaBusy}
              aria-label="pizza name"
              autofocus
            />
            <button
              type="submit"
              class="pizza-form__submit"
              disabled={pizzaBusy || pizzaName.trim().length === 0}
            >
              {pizzaBusy ? "…" : formButtonLabel}
            </button>
            {active_pizza !== null && (
              <button
                type="button"
                class="pizza-form__cancel"
                onClick={() => {
                  setPizzaName("");
                  setComposing(false);
                }}
                disabled={pizzaBusy}
              >
                cancel
              </button>
            )}
          </form>
        )}
      </footer>

      {pairing && <PairPhoneOverlay onClose={() => setPairing(false)} />}
    </main>
  );
}
```

- [ ] **Step 2: Append pizza styles to `web/frontend/src/styles.css`**

Add **before** the existing `@media (max-width: 640px)` block:

```css
/* Pizza bar — sits at the bottom of HeroNumber, above the ember. */
.hero__pizza-bar {
  position: relative; z-index: 1;
  margin-bottom: 30px;
  display: grid;
  gap: 12px;
}

/* State 2: read mode — card with name + elapsed + NEXT PIZZA button. */
.pizza-card {
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  align-items: baseline;
  gap: 14px;
  background: var(--bg-2);
  border: 1px solid var(--bg-3);
  border-radius: 12px;
  padding: 16px 22px;
}
.pizza-card__label {
  font-size: 11px; letter-spacing: 3px; color: var(--ink-soft);
  text-transform: uppercase;
}
.pizza-card__name { font-size: 22px; font-weight: 600; color: var(--ink); }
.pizza-card__elapsed {
  font-size: 24px; font-weight: 600; font-variant-numeric: tabular-nums;
  color: var(--ink);
}
.pizza-card__next {
  appearance: none;
  background: transparent;
  color: var(--ink-soft);
  border: 1px solid var(--bg-3);
  border-radius: 999px;
  padding: 6px 14px;
  font-family: inherit; font-size: 11px;
  letter-spacing: 2px; cursor: pointer;
  transition: color 120ms ease, border-color 120ms ease;
}
.pizza-card__next:hover { color: var(--ink); border-color: var(--ink-soft); }

/* State 3: small "now baking" context label shown above the form. */
.pizza-current {
  font-size: 13px; color: var(--ink-soft);
  padding: 0 4px;
}
.pizza-current b { color: var(--ink); font-weight: 600; }

/* State 1 and 3: the form. */
.pizza-form {
  display: flex; gap: 8px; align-items: center;
}
.pizza-form__input {
  appearance: none;
  background: var(--bg-2);
  color: var(--ink);
  border: 1px solid var(--bg-3);
  border-radius: 999px;
  padding: 10px 16px;
  font-family: inherit; font-size: 14px;
  flex: 1;
  min-width: 0;
}
.pizza-form__input:focus {
  outline: none;
  border-color: var(--signal);
}
.pizza-form__submit {
  appearance: none;
  background: var(--signal);
  color: var(--bg);
  border: 0; border-radius: 999px;
  padding: 10px 18px;
  font-family: inherit; font-weight: 700; font-size: 12px;
  letter-spacing: 3px; cursor: pointer;
}
.pizza-form__submit:disabled { opacity: 0.5; cursor: not-allowed; }
.pizza-form__cancel {
  appearance: none;
  background: transparent;
  color: var(--ink-soft);
  border: 0;
  padding: 6px 10px;
  font-family: inherit; font-size: 12px;
  cursor: pointer;
  text-decoration: underline;
}
.pizza-form__cancel:hover { color: var(--ink); }
```

Inside the existing `@media (max-width: 640px)` block, append portrait
overrides (just before its closing brace):

```css
  /* Pizza card reflows to wrap on a phone — name on its own row,
     elapsed + next button on the next. */
  .pizza-card {
    grid-template-columns: 1fr auto;
    grid-template-areas:
      "label    elapsed"
      "name     name"
      "next     next";
    row-gap: 8px;
  }
  .pizza-card__label   { grid-area: label; }
  .pizza-card__elapsed { grid-area: elapsed; text-align: right; }
  .pizza-card__name    { grid-area: name; }
  .pizza-card__next    { grid-area: next; justify-self: start; }

  .pizza-form { flex-wrap: wrap; }
  .pizza-form__input { width: 100%; }
```

- [ ] **Step 3: Typecheck + build**

Run: `cd web/frontend && bun run lint && bun run build`
Expected: both PASS.

- [ ] **Step 4: Commit**

```bash
git add web/frontend/src/views/hero-number.tsx web/frontend/src/styles.css
git commit -m "feat(web): pizza card + NEXT PIZZA control in HeroNumber"
```

---

## Task 7: End-to-end verification

**Files:** none — verification only.

- [ ] **Step 1: Full local gate**

```bash
make build && make codegen && make lint && make test && make e2e
```
Expected: all green; `git status` clean. `make test` = 23 shared + 64
backend; `make e2e` = 4 passing (the existing firing-flow tests are
unaffected by pizza work — they don't drive the pizza form).

- [ ] **Step 2: Manual flow check**

`make db-reset && make dev`. Pair (open the printed bootstrap link).
Click **START FIRING**.

Expected — **state 1**: pizza bar shows just an input + a **START PIZZA**
button. No card yet.

Type `Margherita`, hit Enter (or click **START PIZZA**).

Expected — **state 2**: the input disappears; a card appears showing
"NOW BAKING · Margherita · 0:01" with the elapsed timer ticking up. A
small "NEXT PIZZA →" button sits on the card.

Click **NEXT PIZZA →**.

Expected — **state 3**: the card collapses to a small "now baking:
**Margherita** · 0:14" label; below it, the input + **GO** button +
**cancel** link appear. The input is focused.

Click **cancel**.

Expected: returns to state 2 cleanly — current pizza unchanged.

Click **NEXT PIZZA →** again, type `Funghi`, hit Enter.

Expected: back to state 2 with the card showing "NOW BAKING · Funghi ·
0:00". In DevTools → Network → `stream`, you should see a `pizza_ended`
(for Margherita, with `ended_at` populated) immediately followed by a
`pizza_started` (for Funghi).

Click **STOP**.

Expected: dashboard returns to idle. The Funghi pizza was auto-ended on
firing stop.

- [ ] **Step 3: Verify the data in SQLite**

```bash
sqlite3 web/backend/udcpine.db \
  "SELECT firing_id, seq, name, started_at, ended_at FROM pizza ORDER BY firing_id, seq;"
```
Expected: two rows, both with `ended_at` populated (one ended by the next
pizza, one auto-ended by STOP).

- [ ] **Step 4: Negative checks**

```bash
# An empty name is rejected with 400.
curl -s -b /tmp/jar.txt -o /dev/null -w "%{http_code}\n" -X POST \
  http://localhost:5001/api/pizza/next -H 'content-type: application/json' \
  -d '{"name":""}'
```
Expected: `400`.

```bash
# Calling /api/pizza/next when no firing is active returns 409.
# (After STOP, the firing is over.)
curl -s -b /tmp/jar.txt -o /dev/null -w "%{http_code}\n" -X POST \
  http://localhost:5001/api/pizza/next -H 'content-type: application/json' \
  -d '{"name":"Marinara"}'
```
Expected: `409`.

- [ ] **Step 5: Stop the servers; `make db-reset` to clean up.**

- [ ] **Step 6: Done — no commit.**

After the PR is pushed, confirm CI's `shared` and `e2e` jobs pass.

---

## Self-review checklist

- [ ] Every file in File Structure has a creating or modifying task.
- [ ] No "TBD"/"TODO"/"implement later" in any task body.
- [ ] The `Pizza` wire type shape — `{id, firing_id, seq, name, started_at, ended_at}` — is consistent in shared/, the SQL `pizza` table, the Store row mapper, the route's response, and the reducer's event shape.
- [ ] `seq` is computed per-firing inside the Store (`MAX(seq)+1`), not by SQLite autoincrement.
- [ ] `stop_firing` auto-ends the active pizza — tested in Store (`test_stop_firing_auto_ends_active_pizza`) and API (`test_stop_firing_clears_active_pizza_in_state`).
- [ ] Empty name is rejected at the wire boundary by `PizzaNextRequest.model_validate` → 400.
- [ ] No firing → `next_pizza` returns None → 409.
- [ ] The reducer handles both new events; `firing_started` and `firing_ended` also clear `active_pizza` (defense in depth — the server already auto-ends, but the reducer doesn't trust stale state across reconnects).
- [ ] CSS for the pizza form has a portrait-mode override so the input + button stack cleanly on a phone.
- [ ] CLAUDE.md workflow respected: completion is push + PR; no destructive GitHub writes.

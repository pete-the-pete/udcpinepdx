# Warm-up Lifecycle + Chuck Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make warm-up a first-class phase: light the fire on a simplified idle screen, watch a dedicated warm-up screen (Chuck thawing + elapsed timer) until you start the first pizza, then fall through to the existing cooking dashboard.

**Architecture:** A single new wire signal `cooking_started_at` (the active firing's first-pizza timestamp, or `null`) drives both routing and survives kiosk reloads. The backend derives it from existing `pizza` rows in `/api/state`; the reducer folds it from SSE `pizza_started`. The frontend routes `(firing, cooking_started_at)` to one of three screens and extracts a shared `ChefStage` so idle, warm-up, and the dashboard all render Chuck from one core.

**Tech Stack:** Zod→Pydantic codegen (`make codegen`), Flask + SQLite (pytest), Preact + `bun:test` + `@testing-library/preact`.

**Source design:** `plans/2026-06-10-warmup-lifecycle-chuck.md` (approved). Decision: the optional "time-to-ready" stat on the dashboard is **deferred** — not in this plan.

---

## File structure

```
shared/
  src/live-state.ts                          (MODIFY — add cooking_started_at)
  generated/schemas/all.json                 (REGEN — make codegen)
  generated/pydantic/__init__.py             (REGEN — make codegen)
web/backend/
  src/udcpine_backend/store.py               (MODIFY — cooking_started_at())
  src/udcpine_backend/app.py                 (MODIFY — wire into /api/state)
  tests/test_store.py                        (MODIFY — cooking_started_at cases)
  tests/test_api.py                          (MODIFY — /api/state field)
web/frontend/src/
  reduce.ts                                  (MODIFY — fold cooking_started_at)
  reduce.test.ts                             (MODIFY — reducer cases)
  chef/ChefStage.tsx                         (CREATE — extracted core)
  chef/ChefStage.test.tsx                    (CREATE)
  chef/ChefWidget.tsx                        (MODIFY — wrap ChefStage)
  views/idle-screen.tsx                      (MODIFY — simplify, add Chuck)
  views/idle-screen.test.tsx                 (MODIFY — new behavior)
  views/warming-up-screen.tsx                (CREATE)
  views/warming-up-screen.test.tsx           (CREATE)
  app.tsx                                     (MODIFY — three-way routing)
  app.test.tsx                               (MODIFY — routing cases)
```

Test-data helper used throughout the frontend tests — an idle `LiveState` literal now needs the new field:

```ts
{ firing: null, latest_sample: null, active_pizza: null, cooking_started_at: null }
```

---

## Task 1: shared — add `cooking_started_at` to LiveState

**Files:**
- Modify: `shared/src/live-state.ts`
- Regen: `shared/generated/schemas/all.json`, `shared/generated/pydantic/__init__.py`

- [ ] **Step 1: Add the field to the Zod schema**

In `shared/src/live-state.ts`, extend the object and document it:

```ts
export const LiveStateSchema = z.object({
  firing: FiringSchema.nullable(),
  latest_sample: SampleSchema.nullable(),
  active_pizza: PizzaSchema.nullable(),
  /**
   * ISO timestamp of the active firing's FIRST pizza (its `started_at`), or
   * null while the oven is lit but no pizza has started yet ("warming up").
   * Derived server-side from pizza rows; drives idle→warm-up→cooking routing
   * and survives a kiosk reload (the /api/state snapshot only carries the
   * *active* pizza, which can't distinguish warm-up from between-pizzas).
   */
  cooking_started_at: z.string().datetime({ offset: true }).nullable(),
});
```

- [ ] **Step 2: Regenerate the Pydantic model**

Run: `make codegen`
Expected: succeeds; `git diff shared/generated` shows `cooking_started_at: str | None` added to `class LiveState` in `shared/generated/pydantic/__init__.py` and the field in `all.json`.

- [ ] **Step 3: Verify the contract test still passes**

Run: `cd shared && bun test`
Expected: PASS (the existing `shared/tests/contract.test.ts` validates the Zod↔JSON-schema contract).

- [ ] **Step 4: Commit**

```bash
git add shared/src/live-state.ts shared/generated
git commit -m "feat(shared): add cooking_started_at to LiveState"
```

---

## Task 2: backend — derive `cooking_started_at` in `/api/state`

`cooking_started_at` is computed from the DB on every read, so it is rehydration-safe by construction (a restart mid-firing recomputes it from the persisted `pizza` rows — no cache).

**Files:**
- Modify: `web/backend/src/udcpine_backend/store.py`
- Modify: `web/backend/src/udcpine_backend/app.py:135-141`
- Test: `web/backend/tests/test_store.py`, `web/backend/tests/test_api.py`

- [ ] **Step 1: Write failing Store tests**

Append to `web/backend/tests/test_store.py` (uses the existing `db_path` fixture and `FixedClock`/`AdvancingClock` already in that file):

```python
def test_cooking_started_at_is_none_when_idle(db_path) -> None:
    s = Store(db_path, clock=FixedClock(T0))
    assert s.cooking_started_at() is None


def test_cooking_started_at_is_none_while_warming_up(db_path) -> None:
    s = Store(db_path, clock=FixedClock(T0))
    s.start_firing()  # fire lit, no pizza yet
    assert s.cooking_started_at() is None


def test_cooking_started_at_is_first_pizza_started_at(db_path) -> None:
    s = Store(db_path, clock=AdvancingClock(T0))
    s.start_firing()
    first = s.next_pizza(name="margherita")
    assert first is not None
    s.next_pizza(name="pepperoni")  # second pizza must not move it
    assert s.cooking_started_at() == first.started_at


def test_cooking_started_at_rehydrates_across_store_instances(db_path) -> None:
    s1 = Store(db_path, clock=AdvancingClock(T0))
    s1.start_firing()
    first = s1.next_pizza(name="margherita")
    assert first is not None
    s2 = Store(db_path, clock=AdvancingClock(T0))  # "restart"
    assert s2.cooking_started_at() == first.started_at
```

- [ ] **Step 2: Run; verify failure**

Run: `cd web/backend && uv run pytest tests/test_store.py -k cooking_started_at -v`
Expected: FAIL — `Store` has no attribute `cooking_started_at`.

- [ ] **Step 3: Implement the Store method**

In `web/backend/src/udcpine_backend/store.py`, add this method to the `Store` class next to the other state accessors (e.g. just after `active_pizza`):

```python
    def cooking_started_at(self) -> str | None:
        """ISO timestamp of the active firing's first pizza (earliest `seq`),
        or None when idle or still warming up. Read straight from the DB so it
        is correct after a mid-firing restart."""
        with self._lock:
            if self._firing is None:
                return None
            row = self._conn.execute(
                "SELECT started_at FROM pizza WHERE firing_id=? ORDER BY seq LIMIT 1",
                (self._firing.id,),
            ).fetchone()
            return row["started_at"] if row is not None else None
```

- [ ] **Step 4: Run Store tests**

Run: `cd web/backend && uv run pytest tests/test_store.py -k cooking_started_at -v`
Expected: 4 PASS.

- [ ] **Step 5: Write failing API test**

Append to `web/backend/tests/test_api.py` (uses the existing `paired_client` fixture and `LiveState`/`json` imports already in that file):

```python
def test_state_cooking_started_at_null_until_first_pizza(paired_client) -> None:
    paired_client.post("/api/firing/start")
    state = LiveState.model_validate(json.loads(paired_client.get("/api/state").data))
    assert state.cooking_started_at is None  # warming up

    paired_client.post("/api/pizza/next", json={"name": "margherita"})
    state = LiveState.model_validate(json.loads(paired_client.get("/api/state").data))
    assert state.cooking_started_at is not None
    assert state.cooking_started_at == state.active_pizza.started_at
```

- [ ] **Step 6: Run; verify failure**

Run: `cd web/backend && uv run pytest tests/test_api.py -k cooking_started_at -v`
Expected: FAIL — `LiveState(...)` in `app.py` doesn't pass `cooking_started_at`, so the field is missing/validation error.

- [ ] **Step 7: Wire into `/api/state`**

In `web/backend/src/udcpine_backend/app.py`, change the `get_state` handler:

```python
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
```

- [ ] **Step 8: Run the full backend suite**

Run: `cd web/backend && uv run pytest -q`
Expected: all pass (existing tests plus the 5 new ones).

- [ ] **Step 9: Commit**

```bash
git add web/backend/src/udcpine_backend/store.py web/backend/src/udcpine_backend/app.py web/backend/tests/test_store.py web/backend/tests/test_api.py
git commit -m "feat(backend): derive cooking_started_at in /api/state"
```

---

## Task 3: frontend — fold `cooking_started_at` in the reducer

**Files:**
- Modify: `web/frontend/src/reduce.ts:6-44`
- Test: `web/frontend/src/reduce.test.ts`

- [ ] **Step 1: Write failing reducer tests**

Append to `web/frontend/src/reduce.test.ts` (match the existing `describe`/`test` + `applyEvent` style; define a local idle state). Use a `Pizza`-shaped literal:

```ts
describe("applyEvent — cooking_started_at", () => {
  const IDLE = {
    firing: null,
    latest_sample: null,
    active_pizza: null,
    cooking_started_at: null,
  };
  const FIRING = { id: 1, started_at: "2026-06-16T00:00:00Z", ended_at: null, status: "active" as const };
  const pizza = (id: number, started_at: string) => ({
    id, firing_id: 1, seq: id, name: `p${id}`, started_at, ended_at: null,
  });

  test("first pizza_started sets cooking_started_at to its started_at", () => {
    const warming = applyEvent(IDLE, { type: "firing_started", firing: FIRING });
    expect(warming.cooking_started_at).toBeNull();
    const cooking = applyEvent(warming, {
      type: "pizza_started",
      pizza: pizza(1, "2026-06-16T00:05:00Z"),
    });
    expect(cooking.cooking_started_at).toBe("2026-06-16T00:05:00Z");
  });

  test("second pizza_started does not overwrite cooking_started_at", () => {
    const cooking = { ...IDLE, firing: FIRING, cooking_started_at: "2026-06-16T00:05:00Z" };
    const next = applyEvent(cooking, {
      type: "pizza_started",
      pizza: pizza(2, "2026-06-16T00:20:00Z"),
    });
    expect(next.cooking_started_at).toBe("2026-06-16T00:05:00Z");
  });

  test("firing_started and firing_ended reset cooking_started_at to null", () => {
    const cooking = { ...IDLE, firing: FIRING, cooking_started_at: "2026-06-16T00:05:00Z" };
    expect(applyEvent(cooking, { type: "firing_started", firing: FIRING }).cooking_started_at).toBeNull();
    expect(applyEvent(cooking, { type: "firing_ended", firing_id: 1 }).cooking_started_at).toBeNull();
  });
});
```

- [ ] **Step 2: Run; verify failure**

Run: `cd web/frontend && bun test src/reduce.test.ts`
Expected: FAIL — `cooking_started_at` is `undefined` (reducer doesn't manage it).

- [ ] **Step 3: Update the reducer**

In `web/frontend/src/reduce.ts`, set the field in the three relevant cases:

```ts
    case "firing_started":
      return {
        ...state,
        firing: event.firing,
        latest_sample: null,
        active_pizza: null,
        cooking_started_at: null,
      };
    case "firing_ended":
      return {
        ...state,
        firing: null,
        latest_sample: null,
        active_pizza: null,
        cooking_started_at: null,
      };
    case "pizza_started":
      return {
        ...state,
        active_pizza: event.pizza,
        // Set only on the FIRST pizza of the firing; later pizzas keep it.
        cooking_started_at: state.cooking_started_at ?? event.pizza.started_at,
      };
```

(`sample` and `pizza_ended` already `...state`, so they preserve it untouched.)

- [ ] **Step 4: Run reducer tests**

Run: `cd web/frontend && bun test src/reduce.test.ts`
Expected: PASS (new + existing).

- [ ] **Step 5: Commit**

```bash
git add web/frontend/src/reduce.ts web/frontend/src/reduce.test.ts
git commit -m "feat(web): fold cooking_started_at in the reducer"
```

---

## Task 4: frontend — extract `ChefStage` from `ChefWidget`

Extract the reusable core (sprite glob, keyframe injection, `selectState`+hysteresis, `ChefSprite`) into `ChefStage`. `ChefWidget` keeps its compact/expanded + click + temp-label wrapper and renders `<ChefStage>` inside it — **dashboard behavior unchanged**.

**Files:**
- Create: `web/frontend/src/chef/ChefStage.tsx`
- Create: `web/frontend/src/chef/ChefStage.test.tsx`
- Modify: `web/frontend/src/chef/ChefWidget.tsx`

- [ ] **Step 1: Create `ChefStage.tsx`** (moves the sprite internals + state selection out of `ChefWidget.tsx`)

```tsx
import { useEffect, useRef } from "preact/hooks";
import type { JSX } from "preact";
import type { Sample } from "@udcpine/shared";
import { manifest, type ChefState } from "./manifest";
import { selectState } from "./state-machine";
import "./chef.css";

const sheetUrls = import.meta.glob("../assets/chef/chef_*.png", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

function sheetFor(state: ChefState): string | undefined {
  for (const [path, url] of Object.entries(sheetUrls)) {
    if (path.endsWith(`/chef_${state}.png`)) return url;
  }
  return undefined;
}

let keyframesInjected = false;
function injectCycleKeyframes(): void {
  if (keyframesInjected) return;
  keyframesInjected = true;
  const rules: string[] = [];
  for (const [state, spec] of Object.entries(manifest.states)) {
    if (spec.frames > 1) {
      rules.push(
        `@keyframes chef-cycle-${state} {` +
          " from { background-position-x: 0%; }" +
          " to { background-position-x: 100%; } }",
      );
    }
  }
  if (rules.length === 0) return;
  const el = document.createElement("style");
  el.dataset.chef = "cycle-keyframes";
  el.textContent = rules.join("\n");
  document.head.appendChild(el);
}

interface ChefEffect {
  sprite: string;
  steam?: boolean;
  aura?: boolean;
}

const CHEF_EFFECTS: Record<string, ChefEffect> = {
  shiver: { sprite: "chef-shiver 0.18s ease-in-out infinite" },
  jig: { sprite: "chef-jig 0.72s ease-in-out infinite" },
  heat: { sprite: "chef-hot-glow 1.3s ease-in-out infinite", steam: true },
  transcendence: {
    sprite:
      "chef-transcend 16s linear infinite, chef-trippy-filter 12s linear infinite",
    aura: true,
  },
};

function ChefSprite({ state }: { state: ChefState }) {
  const spec = manifest.states[state];
  const effect = spec.css_animation ? CHEF_EFFECTS[spec.css_animation] : undefined;
  const url = sheetFor(state);
  const style: JSX.CSSProperties = {
    backgroundImage: url ? `url("${url}")` : "none",
  };
  const animations: string[] = [];
  if (spec.frames > 1) {
    const fps = spec.fps ?? 8;
    style.backgroundSize = `${spec.frames * 100}% 100%`;
    animations.push(`chef-cycle-${state} ${spec.frames / fps}s steps(${spec.frames}) infinite`);
  } else {
    style.backgroundSize = "100% 100%";
  }
  if (effect) animations.push(effect.sprite);
  if (animations.length > 0) style.animation = animations.join(", ");

  return (
    <div class="chef__stage">
      {effect?.aura && (
        <div class="chef__aura" aria-hidden="true">
          <span class="chef__halo" />
          <span class="chef__halo" />
          <span class="chef__halo" />
        </div>
      )}
      {effect?.steam && (
        <div class="chef__steam" aria-hidden="true">
          <span class="chef__wisp" />
          <span class="chef__wisp" />
          <span class="chef__wisp" />
        </div>
      )}
      <div class="chef__sprite" style={style} aria-hidden="true" />
    </div>
  );
}

interface ChefStageProps {
  latest_sample: Sample | null;
}

/**
 * The reusable Chuck core: maps a reading to a state (with hysteresis) and
 * renders the animated sprite. Shared by ChefWidget (dashboard), IdleScreen,
 * and WarmingUpScreen.
 */
export function ChefStage({ latest_sample }: ChefStageProps) {
  const prevState = useRef<ChefState | null>(null);
  useEffect(() => {
    injectCycleKeyframes();
  }, []);
  const tempC = latest_sample?.temp_c ?? null;
  const state = selectState(tempC, prevState.current, manifest);
  prevState.current = state;
  return <ChefSprite state={state} />;
}
```

- [ ] **Step 2: Rewrite `ChefWidget.tsx` to wrap `ChefStage`** (replace the whole file)

```tsx
import { useState } from "preact/hooks";
import type { Sample } from "@udcpine/shared";
import { formatHearthTempF } from "../temp";
import { ChefStage } from "./ChefStage";
import "./chef.css";

interface ChefWidgetProps {
  latest_sample: Sample | null;
}

/**
 * The pizza chef screensaver shown on the cooking dashboard. Compact in a
 * corner; click to take over the screen. Rendering + state selection live in
 * ChefStage; this wrapper owns the dashboard's mode/click/temp-label chrome.
 */
export function ChefWidget({ latest_sample }: ChefWidgetProps) {
  const [mode, setMode] = useState<"compact" | "expanded">("compact");
  const tempC = latest_sample?.temp_c ?? null;

  if (mode === "compact") {
    return (
      <div
        class="chef chef--compact"
        role="button"
        tabIndex={0}
        aria-label="pizza chef — click to expand"
        onClick={() => setMode("expanded")}
      >
        <ChefStage latest_sample={latest_sample} />
      </div>
    );
  }

  return (
    <div
      class="chef chef--expanded"
      role="button"
      tabIndex={0}
      aria-label="pizza chef — click to collapse"
      onClick={() => setMode("compact")}
    >
      <ChefStage latest_sample={latest_sample} />
      <div class="chef__temp">{formatHearthTempF(tempC)}</div>
    </div>
  );
}
```

> Note: the old `aria-label` interpolated the state (`pizza chef — ${state} — …`); that state now lives in `ChefStage`. The simplified label keeps the widget testable without leaking state up. If a test asserted the state text, update it in Step 4.

- [ ] **Step 3: Write `ChefStage.test.tsx`**

```tsx
import { describe, expect, test } from "bun:test";
import { render, cleanup } from "@testing-library/preact";
import { ChefStage } from "./ChefStage";

describe("ChefStage", () => {
  test("renders a sprite stage for a cold reading (frozen)", () => {
    const { container } = render(
      <ChefStage latest_sample={{ t: "2026-06-16T00:00:00Z", temp_c: 18 }} />,
    );
    expect(container.querySelector(".chef__stage")).not.toBeNull();
    expect(container.querySelector(".chef__sprite")).not.toBeNull();
    cleanup();
  });

  test("renders a stage even with no sample (null → coldest state)", () => {
    const { container } = render(<ChefStage latest_sample={null} />);
    expect(container.querySelector(".chef__sprite")).not.toBeNull();
    cleanup();
  });
});
```

- [ ] **Step 4: Run chef tests**

Run: `cd web/frontend && bun test src/chef/`
Expected: PASS — `ChefStage.test.tsx` and the existing `state-machine.test.ts`. If any prior `ChefWidget` test asserted the state-in-aria-label, fix it to the new label.

- [ ] **Step 5: Commit**

```bash
git add web/frontend/src/chef/ChefStage.tsx web/frontend/src/chef/ChefStage.test.tsx web/frontend/src/chef/ChefWidget.tsx
git commit -m "refactor(web): extract ChefStage from ChefWidget"
```

---

## Task 5: frontend — simplify IdleScreen (Chuck + Start fire only)

Remove the first-pizza name input; `START FIRING` becomes fire-only (`startFiring()`); render Chuck (`ChefStage`) with the ambient temperature read off him.

**Files:**
- Modify: `web/frontend/src/views/idle-screen.tsx`
- Modify: `web/frontend/src/views/idle-screen.test.tsx`

- [ ] **Step 1: Rewrite `idle-screen.tsx`** (replace the whole file)

```tsx
import { useState } from "preact/hooks";
import type { Sample } from "@udcpine/shared";
import { startFiring } from "../api";
import { formatHearthTempF } from "../temp";
import { ChefStage } from "../chef/ChefStage";
import { PairPhoneOverlay } from "./pair-phone-overlay";

interface IdleScreenProps {
  /** Called after the fire is lit, so the app can route to warm-up. */
  onStarted: () => void;
  /** Latest hearth reading (ambient when idle), or null before the sensor reports. */
  latestSample: Sample | null;
}

/**
 * Idle screen: the oven is cold and inviting. Chuck sits frozen with the
 * ambient temperature, and a single Start fire button lights the firing.
 * The first pizza is named later, on the warm-up screen.
 */
export function IdleScreen({ onStarted, latestSample }: IdleScreenProps) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pairing, setPairing] = useState(false);

  async function onStart() {
    if (busy) return;
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
        <div class="idle__chef">
          <ChefStage latest_sample={latestSample} />
          <output class="idle__temp" aria-label="current hearth temperature">
            {formatHearthTempF(latestSample?.temp_c ?? null)}
          </output>
        </div>
        <button
          type="button"
          class="idle__start"
          onClick={onStart}
          disabled={busy}
        >
          {busy ? "LIGHTING…" : "START FIRING"}
        </button>
        <p class="idle__caption">light the fire to begin</p>
        {err !== null && <p class="idle__error">error: {err}</p>}
      </section>

      {pairing && <PairPhoneOverlay onClose={() => setPairing(false)} />}
    </main>
  );
}
```

- [ ] **Step 2: Rewrite `idle-screen.test.tsx`** (replace the whole file — behavior changed)

```tsx
import { describe, expect, test, afterEach, mock } from "bun:test";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/preact";

const startFiring = mock(async () => ({
  id: 1, started_at: "2026-06-16T00:00:00Z", ended_at: null, status: "active",
}));
mock.module("../api", () => ({ startFiring }));

import { IdleScreen } from "./idle-screen";

afterEach(() => {
  cleanup();
  startFiring.mockClear();
});

describe("IdleScreen", () => {
  test("renders Chuck, ambient temp, and a Start fire button — no name input", () => {
    render(<IdleScreen onStarted={() => {}} latestSample={{ t: "2026-06-16T00:00:00Z", temp_c: 20 }} />);
    expect(screen.getByRole("button", { name: /start firing/i })).toBeDefined();
    expect(screen.getByLabelText(/current hearth temperature/i)).toBeDefined();
    expect(document.querySelector(".chef__sprite")).not.toBeNull();
    expect(screen.queryByLabelText(/pizza name/i)).toBeNull();
  });

  test("Start fire calls startFiring only, then onStarted", async () => {
    const onStarted = mock(() => {});
    render(<IdleScreen onStarted={onStarted} latestSample={null} />);
    fireEvent.click(screen.getByRole("button", { name: /start firing/i }));
    await waitFor(() => expect(onStarted).toHaveBeenCalledTimes(1));
    expect(startFiring).toHaveBeenCalledTimes(1);
  });
});
```

> If the repo's existing `idle-screen.test.tsx` uses a different mocking idiom than `mock.module`, match that file's existing idiom instead (check it first); the assertions above stay the same.

- [ ] **Step 3: Run; verify pass**

Run: `cd web/frontend && bun test src/views/idle-screen.test.tsx`
Expected: PASS.

- [ ] **Step 4: Add minimal idle layout CSS**

In `web/frontend/src/styles.css`, add a rule so Chuck + temp stack centered (match the existing `.idle` block's style):

```css
.idle__chef {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}
```

- [ ] **Step 5: Commit**

```bash
git add web/frontend/src/views/idle-screen.tsx web/frontend/src/views/idle-screen.test.tsx web/frontend/src/styles.css
git commit -m "feat(web): simplify idle screen to Chuck + Start fire"
```

---

## Task 6: frontend — new WarmingUpScreen

**Files:**
- Create: `web/frontend/src/views/warming-up-screen.tsx`
- Create: `web/frontend/src/views/warming-up-screen.test.tsx`

- [ ] **Step 1: Create `warming-up-screen.tsx`**

```tsx
import { useEffect, useState } from "preact/hooks";
import type { Firing, Sample } from "@udcpine/shared";
import { endFiring, nextPizza } from "../api";
import { formatHearthTempF } from "../temp";
import { ChefStage } from "../chef/ChefStage";

interface WarmingUpScreenProps {
  firing: Firing;
  latestSample: Sample | null;
  /** Called after start-first-pizza or cancel, so the app can re-route. */
  onAction: () => void;
}

function useTick(intervalMs: number): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function formatMS(ms: number): string {
  if (Number.isNaN(ms) || ms < 0) return "0:00";
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Warm-up screen: the fire is lit, no pizza yet. Watch Chuck thaw with the
 * live temperature and an elapsed timer; name and start the first pizza, or
 * cancel a false start (which ends the firing back to idle).
 */
export function WarmingUpScreen({ firing, latestSample, onAction }: WarmingUpScreenProps) {
  const now = useTick(1000);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const elapsed = formatMS(now - Date.parse(firing.started_at));
  const canStart = name.trim().length > 0 && !busy && !cancelBusy;

  async function onSubmit(e: Event) {
    e.preventDefault();
    if (!canStart) return;
    setBusy(true);
    try {
      await nextPizza(name.trim());
      onAction();
    } finally {
      setBusy(false);
    }
  }

  async function onCancel() {
    if (cancelBusy) return;
    setCancelBusy(true);
    try {
      await endFiring();
      onAction();
    } catch {
      setCancelBusy(false);
    }
  }

  return (
    <main class="hero">
      <div class="hero__ember" aria-hidden="true" />
      <header class="hero__status">
        <span class="hero__id">WARMING UP · {elapsed}</span>
        <button
          type="button"
          class="hero__stop"
          onClick={onCancel}
          disabled={cancelBusy}
          aria-label="cancel firing"
        >
          {cancelBusy ? "…" : "CANCEL"}
        </button>
      </header>

      <section class="idle">
        <div class="idle__chef">
          <ChefStage latest_sample={latestSample} />
          <output class="idle__temp" aria-label="current hearth temperature">
            {formatHearthTempF(latestSample?.temp_c ?? null)}
          </output>
        </div>
        <form class="idle__form" onSubmit={onSubmit}>
          <input
            class="idle__name"
            type="text"
            placeholder="first pizza name"
            value={name}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
            disabled={busy}
            aria-label="first pizza name"
            autofocus
          />
          <button type="submit" class="idle__start" disabled={!canStart}>
            {busy ? "STARTING…" : "START FIRST PIZZA"}
          </button>
        </form>
        <p class="idle__caption">name your first pizza when the hearth is hot</p>
      </section>
    </main>
  );
}
```

- [ ] **Step 2: Create `warming-up-screen.test.tsx`**

```tsx
import { describe, expect, test, afterEach, mock } from "bun:test";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/preact";

const nextPizza = mock(async () => ({
  id: 1, firing_id: 1, seq: 1, name: "margherita",
  started_at: "2026-06-16T00:05:00Z", ended_at: null,
}));
const endFiring = mock(async () => ({
  id: 1, started_at: "2026-06-16T00:00:00Z", ended_at: "2026-06-16T00:01:00Z", status: "ended",
}));
mock.module("../api", () => ({ nextPizza, endFiring }));

import { WarmingUpScreen } from "./warming-up-screen";

const FIRING = { id: 1, started_at: "2026-06-16T00:00:00Z", ended_at: null, status: "active" as const };

afterEach(() => {
  cleanup();
  nextPizza.mockClear();
  endFiring.mockClear();
});

describe("WarmingUpScreen", () => {
  test("renders Chuck, temp, elapsed timer, and the first-pizza form", () => {
    render(<WarmingUpScreen firing={FIRING} latestSample={{ t: "2026-06-16T00:00:30Z", temp_c: 80 }} onAction={() => {}} />);
    expect(screen.getByText(/warming up/i)).toBeDefined();
    expect(screen.getByLabelText(/first pizza name/i)).toBeDefined();
    expect(document.querySelector(".chef__sprite")).not.toBeNull();
  });

  test("Start first pizza calls nextPizza(name) then onAction", async () => {
    const onAction = mock(() => {});
    render(<WarmingUpScreen firing={FIRING} latestSample={null} onAction={onAction} />);
    fireEvent.input(screen.getByLabelText(/first pizza name/i), { target: { value: "margherita" } });
    fireEvent.click(screen.getByRole("button", { name: /start first pizza/i }));
    await waitFor(() => expect(onAction).toHaveBeenCalledTimes(1));
    expect(nextPizza).toHaveBeenCalledWith("margherita");
  });

  test("Cancel calls endFiring then onAction", async () => {
    const onAction = mock(() => {});
    render(<WarmingUpScreen firing={FIRING} latestSample={null} onAction={onAction} />);
    fireEvent.click(screen.getByRole("button", { name: /cancel firing/i }));
    await waitFor(() => expect(onAction).toHaveBeenCalledTimes(1));
    expect(endFiring).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run; verify pass**

Run: `cd web/frontend && bun test src/views/warming-up-screen.test.tsx`
Expected: 3 PASS.

- [ ] **Step 4: Commit**

```bash
git add web/frontend/src/views/warming-up-screen.tsx web/frontend/src/views/warming-up-screen.test.tsx
git commit -m "feat(web): add WarmingUpScreen"
```

---

## Task 7: frontend — three-way routing in `app.tsx`

**Files:**
- Modify: `web/frontend/src/app.tsx` (the `Live` component, ~lines 107-124)
- Modify: `web/frontend/src/app.test.tsx`

- [ ] **Step 1: Write failing routing tests**

Append to `web/frontend/src/app.test.tsx` (reuse the file's existing `NoopEventSource` + fetch-mock setup; render `<App />` and seed `/api/state`). Add a small helper that mocks `/api/state` with a given body and asserts which screen renders:

```ts
async function bootWith(stateBody: object) {
  window.sessionStorage.setItem(BOOTSTRAP_TOKEN_KEY, "abc");
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url === "/api/state") return new Response(JSON.stringify(stateBody), { status: 200 });
    if (url === "/api/auth/exchange") return new Response('{"ok":true}', { status: 200 });
    throw new Error(`unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
  render(<App />);
}

const FIRING = { id: 1, started_at: "2026-06-16T00:00:00Z", ended_at: null, status: "active" };
const PIZZA = { id: 1, firing_id: 1, seq: 1, name: "margherita", started_at: "2026-06-16T00:05:00Z", ended_at: null };

test("routes to IdleScreen when firing is null", async () => {
  await bootWith({ firing: null, latest_sample: null, active_pizza: null, cooking_started_at: null });
  await waitFor(() => expect(screen.getByRole("button", { name: /start firing/i })).toBeDefined());
});

test("routes to WarmingUpScreen when firing active and cooking_started_at is null", async () => {
  await bootWith({ firing: FIRING, latest_sample: null, active_pizza: null, cooking_started_at: null });
  await waitFor(() => expect(screen.getByText(/warming up/i)).toBeDefined());
});

test("routes to the cooking dashboard when cooking_started_at is set", async () => {
  await bootWith({ firing: FIRING, latest_sample: null, active_pizza: PIZZA, cooking_started_at: PIZZA.started_at });
  await waitFor(() => expect(screen.getByText(/degrees fahrenheit/i)).toBeDefined());
});
```

- [ ] **Step 2: Run; verify failure**

Run: `cd web/frontend && bun test src/app.test.tsx`
Expected: FAIL on the WarmingUpScreen case (currently any active firing renders HeroNumber).

- [ ] **Step 3: Update the `Live` component**

In `web/frontend/src/app.tsx`, import the new screen and add the middle branch:

```tsx
import { WarmingUpScreen } from "./views/warming-up-screen";
```

```tsx
function Live({ initial, onAction }: { initial: LiveState; onAction: () => void }) {
  const { state, connectionState } = useLiveState(initial);
  const overlay = connectionState === "reconnecting" ? <ReconnectingOverlay /> : null;
  if (state.firing === null) {
    return (
      <>
        <IdleScreen onStarted={onAction} latestSample={state.latest_sample} />
        {overlay}
      </>
    );
  }
  if (state.cooking_started_at === null) {
    return (
      <>
        <WarmingUpScreen firing={state.firing} latestSample={state.latest_sample} onAction={onAction} />
        {overlay}
      </>
    );
  }
  return (
    <>
      <HeroNumber state={{ ...state, firing: state.firing }} onEnded={onAction} />
      {overlay}
    </>
  );
}
```

- [ ] **Step 4: Run; verify pass**

Run: `cd web/frontend && bun test src/app.test.tsx`
Expected: PASS (new routing cases + existing boot-flow tests — the idle boot test still finds "start firing").

- [ ] **Step 5: Commit**

```bash
git add web/frontend/src/app.tsx web/frontend/src/app.test.tsx
git commit -m "feat(web): route idle → warming-up → cooking on cooking_started_at"
```

---

## Task 8: full-stack verification

**Files:** none — verification only.

- [ ] **Step 1: Lint + typecheck + unit tests**

Run: `make lint && make test`
Expected: all green. `make test` includes shared, backend (with the 5 new cases), and frontend bun tests.

- [ ] **Step 2: e2e**

Run: `make e2e`
Expected: existing Playwright specs pass. If a spec drove the old idle flow (typed a pizza name on the idle screen then expected the dashboard), update it: idle **Start firing** → warm-up screen; type the name + **Start first pizza** there → dashboard. Keep the change minimal and within the existing spec's structure.

- [ ] **Step 3: Manual walkthrough (mock sensor)**

Run backend + frontend with `UDCPINE_MOCK_SENSOR=1` (`make dev`), pair via the printed link, then:
1. Idle screen shows **frozen Chuck + ambient °F + START FIRING** (no name input).
2. **START FIRING** → **WARMING UP** screen with the elapsed timer ticking and Chuck; **CANCEL** returns to idle.
3. Type a name + **START FIRST PIZZA** → cooking dashboard (HeroNumber).
4. Reload mid-warm-up (before any pizza) → returns to the **warm-up** screen, not the dashboard (this is the `cooking_started_at` rehydration check).

- [ ] **Step 4: Done — no commit.** Confirm `git status` clean and CI green after push.

---

## Self-review checklist

- [ ] Every spec section maps to a task: `cooking_started_at` shared (T1) + backend (T2) + reducer (T3); ChefStage extraction (T4); IdleScreen simplification (T5); WarmingUpScreen (T6); routing (T7); testing/verification (T1-T8).
- [ ] No placeholders — every code step shows complete code; every run step shows the command + expected result.
- [ ] Type/name consistency: `cooking_started_at` (snake_case wire field) used identically in Zod, Pydantic, reducer, and routing; `ChefStage` prop is `latest_sample` (matching `ChefWidget`); `onAction`/`onStarted` callbacks match each screen's props.
- [ ] Deferred per decision: the dashboard "time-to-ready" stat is **not** in this plan.
- [ ] No DB schema change (derived from existing `pizza` rows); rehydration covered by T2 Step 1 and T8 Step 3.4.
- [ ] Cancel reuses `endFiring()`/`stop_firing` — no new backend endpoint.

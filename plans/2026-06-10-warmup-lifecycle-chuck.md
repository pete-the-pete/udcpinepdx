# Design: warm-up lifecycle + Chuck on the start/warm-up screens

**Date:** 2026-06-10
**Scope:** cross-cutting — `shared` (LiveState), `backend` (state computation),
`web` (routing + two screens + Chuck reuse).
**Status:** approved design (brainstorm). Implementation plan to follow.

## Goal

Make the oven's **warm-up** a first-class phase you can watch and time. You
light the chiminea and hit **Start fire**; the hearth heats while you watch the
live temperature climb and the pizza chef ("Chuck") thaw → active → hot; when
it's hot enough you **Start your first pizza**. The gap between fire-lit and
first-pizza is your **time to ready**. A **Cancel** handles false starts.

This grew out of "show Chuck on the idle screen" — Chuck is still on the idle
screen (frozen, inviting), but his real progression now happens on a dedicated
warm-up screen driven by the live thermocouple reading.

## Lifecycle & screen routing

`app.tsx`'s `Live` component selects the screen from `(firing, cooking_started_at)`:

| State | Screen | Primary action |
|---|---|---|
| `firing === null` | **IdleScreen** | **Start fire** (`start_firing`) |
| `firing` active, `cooking_started_at === null` | **WarmingUpScreen** | **Start first pizza** (`nextPizza`) / **Cancel** (`stop_firing`) |
| `firing` active, `cooking_started_at !== null` | **HeroNumber** (existing dashboard) | NEXT PIZZA / END (unchanged) |

Today the idle screen's `START FIRING` does two things at once (`start_firing` +
name the first pizza). This design **splits them**: `start_firing` now means
"fire lit," and naming/starting the first pizza becomes a separate action on the
warm-up screen.

## Data model: one new signal, `cooking_started_at`

The frontend can't tell "warming up" (no pizza yet) from "between pizzas"
(already cooking) after a kiosk reload, because the `/api/state` snapshot only
carries the *active* pizza. So `LiveState` gains:

```
cooking_started_at: string | null   // ISO timestamp of the firing's FIRST pizza, else null
```

- **Shared** (`shared/src/live-state.ts`): add the field (Zod → regenerates the
  Pydantic model via the existing codegen). It is the firing's first pizza's
  `started_at`.
- **No DB schema change** — it's derived from existing `pizza` rows. The backend
  computes it in `/api/state` (the first pizza by `seq` for the active firing,
  or `null`).
- **Reducer** (`web/frontend/src/reduce.ts`): set `cooking_started_at` from the
  event on the **first** `pizza_started` (i.e. when it's currently `null`);
  reset to `null` on `firing_started` and `firing_ended`.

It does double duty: **routing** (`null` ⇒ warming up) and the **time-to-ready**
metric (`cooking_started_at − firing.started_at`).

## Screens

### IdleScreen (simplified) — `web/frontend/src/views/idle-screen.tsx`

- Chuck as a frozen centerpiece (`ChefStage`), with the **ambient temperature
  reading off him** (`formatHearthTempF`) — this replaces the standalone
  `idle__temp` `<output>` added in the previous PR (the number now lives with
  Chuck).
- **[Start fire]** button → `startFiring()` **only** (no pizza name).
- Keep PAIR A PHONE.
- The first-pizza name input is **removed** from this screen (it moves to the
  warm-up screen).
- `selectState(null)` resolves to the coldest state, so before any reading Chuck
  is frozen; in mock/dev mode the ~20 °C ambient keeps him frozen until a real
  burn — accurate, not a bug.

### WarmingUpScreen (new) — `web/frontend/src/views/warming-up-screen.tsx`

- Header: **WARMING UP · `MM:SS`** — live elapsed since `firing.started_at`
  (reuse `HeroNumber`'s `useTick` + `formatHMS`).
- Chuck (`ChefStage`) progressing with the live temp + `formatHearthTempF`.
- The first-pizza form relocated from the old idle screen: a name input and a
  **[Start first pizza]** button → `nextPizza(name)`.
- **[Cancel]** button → `endFiring()` (the existing `stop_firing`) — ends the
  false-start firing and returns to idle. Cancel only exists here (by definition
  no pizza has been cooked yet).
- Transitions happen via the normal SSE state change (first `pizza_started`
  routes to the dashboard; `firing_ended` routes to idle).

### HeroNumber (cooking dashboard) — unchanged behavior

- Now reached only once `cooking_started_at !== null`, so its existing
  "NEXT PIZZA when no active pizza" path serves **between-pizzas** only (never
  warm-up).
- **Time-to-ready stat (nice-to-have):** a small "🔥 fire ready in `Nm`"
  readout (`cooking_started_at − firing.started_at`). Included but isolated so
  it can be cut without affecting the rest.

## Chuck reuse — extract `ChefStage`

Extract the reusable core of `ChefWidget` into **`ChefStage`**
(`web/frontend/src/chef/ChefStage.tsx`): given `latest_sample`, it owns the
`selectState` + `prevState` hysteresis + keyframe injection and renders the
animated `ChefSprite`. One job: "show Chuck for this reading."

- `ChefWidget` refactors to render `<ChefStage>` inside its existing
  compact/expanded + click + temp-label wrapper — **dashboard behavior
  unchanged**.
- `WarmingUpScreen` and `IdleScreen` each render `<ChefStage>` + a
  `formatHearthTempF` label in their own (non-interactive, prominent) layout.

Three consumers now share the core, which is what justifies the extraction (it's
the clean version of the "renderer seam" the code already gestures at).

## Cancel semantics

Cancel reuses the existing `stop_firing` (`/api/firing/stop`, frontend
`endFiring()`). The false-start firing becomes a normal "ended" firing with zero
pizzas. No new backend code, no delete, no new status value.

## Explicitly out of scope

- No readiness gating — Chuck's progression *is* the "hot enough" signal; Start
  fire / Start first pizza are always available.
- No discard/delete of cancelled firings (we end them normally) and no new
  firing-history view or status filtering.
- No DB schema change.

## Testing

- **shared**: `LiveState` includes `cooking_started_at`. Reducer: first
  `pizza_started` sets it; a second `pizza_started` does not overwrite it;
  `firing_started` and `firing_ended` reset it to `null`.
- **backend**: `start_firing` alone leaves `cooking_started_at` null;
  `/api/state` returns `cooking_started_at` = first pizza's `started_at` once a
  pizza exists, else `null`; rehydration (restart mid-firing) reports the right
  value.
- **frontend**:
  - Routing: `firing===null` → IdleScreen; `firing` + `cooking_started_at===null`
    → WarmingUpScreen; `firing` + `cooking_started_at!==null` → HeroNumber.
  - IdleScreen: **Start fire** calls `startFiring` only (no pizza), renders Chuck
    + ambient temp, no name input.
  - WarmingUpScreen: renders Chuck + temp + elapsed; **Start first pizza** calls
    `nextPizza(name)`; **Cancel** calls `endFiring`.
  - `ChefStage`: renders the expected sprite/state for a given sample; `ChefWidget`
    still renders identically after the refactor.

## Verification (local)

Run backend + frontend (`UDCPINE_MOCK_SENSOR=1`):
1. Idle screen shows frozen Chuck + ambient °F + **Start fire**.
2. Start fire → warm-up screen with the elapsed timer running and Chuck;
   **Cancel** returns to idle.
3. Start first pizza → cooking dashboard; the (optional) time-to-ready stat
   reflects elapsed warm-up. Start a firing with the mock ramp to watch Chuck
   actually progress through his states.

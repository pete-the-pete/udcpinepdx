# Pizza Chef Engine — Plan

## Context

The live dashboard plan (`plans/web/2026-04-21-live-dashboard-design.md`)
defines Product 4 as a "Pizza chef screensaver. Spritesheet-driven
animation whose state is a function of live oven temperature." The
spritesheets plan (`plans/web/2026-04-28-pizza-chef-spritesheets.md`)
owns the **art track** — producing the sprite sheets and the
`chef.manifest.json` contract. This plan owns the **engine track**: the
frontend code that consumes that contract and renders the chef on the
dashboard.

The art track has shipped its Session 1 skeleton — `frozen`, `thawing`,
`active`, and `hot` each have a 1-frame sheet; `very_hot` is deferred.
The manifest's v1 escape hatch means the engine renders whatever states
exist, so the engine can be built and demoed now against the 4-state
manifest.

## What the user sees

The chef is a **two-mode widget** on the `HeroNumber` dashboard view
(the view shown during an active firing):

- **Compact:** a ~200×200 element in a corner of the dashboard, always
  visible during a firing, animating to reflect the current oven
  temperature.
- **Expanded:** clicking the compact widget expands the chef to a
  full-screen takeover that also shows the live temperature readout.
  Clicking anywhere collapses it back to compact.

The chef does **not** appear on the `IdleScreen` (no active firing). He
is a fixture of an in-progress cook, not the idle dashboard.

There is no idle timer and no re-show logic — the chef is simply always
present during a firing, at one of two sizes.

## Decisions locked by this plan

1. **CSS-driven sprite animation (Approach A).** Frame cycling is a CSS
   `@keyframes` animation stepping `background-position` across the
   horizontal-strip sheet with `steps(frames)`. There is no JS
   `requestAnimationFrame` loop. The browser drives every frame; the
   engine only picks *which* sheet is active.

   *Future expansion (Approach B):* a canvas + `requestAnimationFrame`
   renderer would unlock crossfade transitions and engine-rendered FX
   overlays. Those capabilities are deliberately out of scope here
   (transitions are hard-cut; FX is baked into the sprite frames). If
   they are wanted later, the renderer is a unit behind an interface
   (see Module structure) and Approach B can replace Approach A without
   restructuring the state machine or the widget.

2. **Hard-cut transitions.** When the oven temperature crosses a band
   edge and the chef changes state, the engine swaps sheets instantly.
   No crossfade. State changes are infrequent (only on band crossings),
   so the abruptness is rarely seen.

3. **The engine does no unit conversion.** The manifest's `temp_f`
   bands, the backend's `latest_sample.temp_f`, and the dashboard
   display are all °F. The state machine compares temperatures
   directly.

4. **The engine owns the `css_animation` catalogue.** The manifest
   declares which states want a named CSS animation (per the
   spritesheets plan); this plan defines what those names mean. For now
   the catalogue has one entry: `shiver`.

## Module structure

A new `web/frontend/src/chef/` directory, four focused units:

```
web/frontend/src/chef/
  manifest.ts            ← imports chef.manifest.json, exports it typed
  state-machine.ts       ← pure: temperature → ChefState (+ hysteresis)
  state-machine.test.ts  ← unit tests for the above
  ChefWidget.tsx         ← Preact component: compact ↔ full-screen modes
  chef.css               ← sprite-strip styles + the shiver keyframe
```

- **`manifest.ts`** — Vite imports `chef.manifest.json` directly; this
  module attaches a TypeScript type so the rest of the engine is
  type-safe against the contract. It also exposes the list of states
  that actually have sheets (the manifest only lists those).
- **`state-machine.ts`** — the engine's brain. Pure, no DOM, no Preact.
  Trivially testable.
- **`ChefWidget.tsx`** — the only stateful unit. Holds the
  compact/expanded mode and the previous-state ref, runs the state
  machine, renders the sprite. The "renderer" boundary lives here: the
  sprite is rendered behind a small internal seam so a future Approach
  B canvas renderer can replace the CSS sprite without touching the
  state machine or mode logic.
- **`chef.css`** — static styles: layout for both modes and the
  `shiver` keyframe. The per-state frame-cycling keyframes are *not*
  here — they are generated at runtime (see Sprite rendering).

### Mounting

The current dashboard structure (post-SSE rebase):

```
App → Live (calls useLiveState) → HeroNumber  (firing active)
                                 → IdleScreen  (no firing)
```

`ChefWidget` is rendered inside `HeroNumber`'s JSX and receives
`latest_sample` from the `LiveState` that `HeroNumber` already holds.
Because `useLiveState` keeps that state current via SSE
(`/api/stream`), the widget re-renders as the temperature changes — no
polling, no extra fetch.

The compact widget is a positioned element within the `HeroNumber`
layout. The expanded view is a `position: fixed; inset: 0` overlay, so
it takes over the screen regardless of where the compact widget sits.

## The state machine

One pure function:

```
selectState(tempF: number | null, prevState: ChefState | null, manifest): ChefState
```

Logic, in order:

1. **Null sample → `frozen`.** If `latest_sample` is null (no sensor
   data), return the coldest state. A dark oven is cold.
2. **Band lookup.** Find the manifest state whose `temp_f: [low, high]`
   contains `tempF`. Edges are **`[low, high)`** — the low edge is
   inclusive, the high edge exclusive. `null` low means −∞, `null` high
   means +∞.
3. **Hysteresis (dead-band).** If `prevState` is set and `tempF` is
   still within `prevState`'s band widened by the hysteresis margin,
   keep `prevState`. The state only switches when `tempF` moves more
   than the margin past an edge. **Margin: 8°F.** This prevents the
   chef flapping between adjacent states when the oven hovers on an
   edge. The margin is a single named constant, easy to tune later.
4. **Missing-state clamp.** The manifest lists only states that have
   sheets. If `tempF` falls in a band with no sheet (e.g. `very_hot`
   while it is still deferred), clamp to the nearest present state —
   the closest band that does have a sheet. This is the v1 escape
   hatch working end-to-end: the engine renders whatever exists.

`ChefWidget` holds the previous `ChefState` in a ref and feeds it back
in on each render so hysteresis has memory. On first render `prevState`
is `null` and step 3 is skipped.

## Sprite rendering

Each `chef_<state>.png` is a horizontal strip, `frames × 512` wide,
512 tall. The sprite element is a `<div>` with that strip as
`background-image`.

- **Frame cycling.** A CSS `@keyframes` animation steps
  `background-position-x` across the strip with `steps(frames)`.
  Animation duration is `frames ÷ fps` seconds (both from the
  manifest). `fps` is **advisory** — it sets the CSS duration; there is
  no strict frame clock.
- **Runtime keyframe generation.** `steps(n)` cannot take a CSS
  variable, and frame counts are per-state and known only from the
  manifest. At module load the engine reads the manifest and injects
  one `<style>` block containing a `@keyframes chef-cycle-<state>` for
  each state with `frames > 1`. States with `frames === 1` get no
  cycle animation — a static background. Under the current v1 skeleton
  every state has 1 frame, so sprites render static today; the cycling
  keyframes light up automatically as the art track deepens states.
  The engine needs no change when that happens.
- **`frozen` / `shiver`.** `frozen` has `frames: 1` and
  `css_animation: "shiver"`. No cycling; instead the engine applies the
  `shiver` keyframe — a small `transform: rotate()` wobble defined
  statically in `chef.css`. Cycling (`background-position`) and the
  shiver transform are different CSS properties, so a future state
  could use both at once without conflict.
- **Sizing.** Both modes use the same sprite `<div>`. Compact sizes it
  to ~200×200; expanded scales it up via `background-size`. The
  512×512 frame aspect is preserved in both.

## The widget component

`ChefWidget.tsx`:

- **Props:** `latest_sample: Sample | null`.
- **State:** `mode: "compact" | "expanded"` (`useState`); previous
  `ChefState` (a ref, for hysteresis).
- **Render:** read `temp_f` from `latest_sample`, call `selectState`,
  store the result back into the previous-state ref, render the sprite.
  - *compact:* a ~200×200 element; `onClick` → `mode = "expanded"`.
  - *expanded:* a `position: fixed; inset: 0` overlay containing the
    scaled-up sprite and the live temperature readout; `onClick`
    anywhere → `mode = "compact"`.

## Error handling

- **Null sample** — handled by the state machine (→ `frozen`).
- **Missing state** — handled by the state machine (→ nearest present
  state).
- **Sheet image fails to load** — the sheets are bundled assets; a load
  failure means a broken build, not a runtime condition to design
  around. No special handling. The sprite `<div>` simply shows its
  (transparent) background.
- **Malformed manifest** — `manifest.ts` types the import; a manifest
  that does not match the type is a build-time TypeScript error, not a
  runtime path.

## Testing & verification

**Unit tests — `state-machine.test.ts`.** The frontend has no test
runner today; this plan adds `"test": "bun test"` to
`web/frontend/package.json` (`bun` is already the repo package manager;
`shared/` already tests this way). Cases:

- Each band: a temperature inside frozen/thawing/active/hot returns
  that state.
- Edge behavior: temperatures exactly at 250/350/450/550 land in the
  upper band (`[low, high)`).
- Hysteresis: with `prevState` set, a temperature just past an edge
  keeps `prevState`; past edge + 8°F it switches.
- Null sample → `frozen`.
- Missing-state clamp: 600°F with `very_hot` absent → `hot`.

**Manual verification — the widget.** Sprite animation is visual and
not meaningfully unit-testable. Steps:

1. `cd web/frontend && bun run dev`, open the dashboard, start a
   firing.
2. Confirm the compact ~200×200 widget appears on `HeroNumber` and
   shows the state matching the current temperature.
3. Click it — confirm full-screen expansion with the temperature
   readout; click anywhere — confirm collapse to compact.
4. Drive the temperature across each band edge (250/350/450/550 °F) and
   confirm the chef changes state with no flapping at the edges, and
   that the `frozen` shiver is visible.

The exact mechanism for driving temperature in step 4 (a backend test
hook, a mock SSE feed, or manual DB edits) is deferred to execution —
it depends on what the backend exposes.

## Out of scope

- Crossfade transitions and engine-rendered FX overlays — Approach B
  territory; see Decision 1.
- Articulation / locomotion — owned by a future "ambient mascot" plan,
  per the spritesheets plan.
- The chef on the `IdleScreen` — this plan scopes the widget to
  `HeroNumber` only.
- Deepening sprite sheets or producing `very_hot` — art track, owned by
  the spritesheets plan.

## Open questions deferred to execution

- How to drive temperature across band edges for manual verification
  (test hook vs mock SSE vs DB edits) — depends on backend surface.
- The exact corner/placement of the compact widget within the
  `HeroNumber` layout — a visual judgement best made against the
  running dashboard.

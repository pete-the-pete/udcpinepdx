# Chef Transcendence (very_hot effect) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the `very_hot` state a "transcendence" treatment — slow
celestial rotation + zoom, drifting trippy color, and emanating halo rings
— so Chuck reads as having ascended to pizza godhood.

**Architecture:** Extends the existing engine catalogue (`CHEF_EFFECTS` in
`ChefWidget.tsx`) with a new `transcendence` entry. The sprite gets one
combined `transform` keyframe (rotate + translateZ — only one transform
value can animate at a time) plus one `filter` keyframe (different period
so the composition drifts and never quite repeats). A new `aura?: boolean`
flag on `ChefEffect` triggers three halo decoration elements rendered
inside `.chef__stage`, mirroring how `steam?` already drives the wisps.

**Tech Stack:** CSS `@keyframes`, Preact, the Python `pack.py` art
pipeline. No new dependencies.

## Context

The chef engine's catalogue was designed exactly for this kind of growth:
each state names an effect, and the engine defines what the name means.
After this plan the catalogue has four entries — `shiver`, `jig`, `heat`,
`transcendence`.

`very_hot` was just folded into the system (`chef_very_hot.png` + manifest
entry, no `css_animation` yet). This plan picks up where that left off and
gives the state its motion.

The "series of trippy animations" feel comes from layering effects on
different periods (transform 16s, filter 12s, three halos staggered across
4.5s each) rather than from a phase scheduler — the combined visual never
exactly repeats, which reads as screensaver variety.

## File structure

- `design/chef/scripts/pack.py` — `STATES`: gain `"css_animation":
  "transcendence"` on `very_hot`.
- `web/frontend/src/assets/chef/chef.manifest.json` — generated artifact,
  hand-edited to match.
- `web/frontend/src/chef/chef.css` — three new keyframes (`chef-transcend`,
  `chef-trippy-filter`, `chef-halo`) plus `.chef__aura` / `.chef__halo`
  decoration styles.
- `web/frontend/src/chef/ChefWidget.tsx` — `ChefEffect` gains `aura?:
  boolean`; catalogue gains the `transcendence` entry; `ChefSprite` renders
  three `.chef__halo` spans inside a `.chef__aura` wrapper when set.

The four files must agree on the `css_animation` name `"transcendence"`
exactly.

## Notes on composition

CSS only animates one value per property at a time. So:
- `chef-transcend` is the *single* transform keyframe — it combines
  `rotate(...)` and `translateZ(...)` together at each waypoint.
- `chef-trippy-filter` is the *single* filter keyframe — it combines
  `hue-rotate`, `saturate`, `brightness`, and `drop-shadow` together.

Transform and filter are different properties, so the two animations run in
parallel without conflict. The halo decorations live on separate DOM
elements with their own animations, so they don't fight the sprite's
transform/filter at all.

`perspective(900px)` is inline in `chef-transcend`'s transform function so
the `translateZ` produces visible depth without needing 3D context on a
parent.

---

### Task 1: Declare `transcendence` in the manifest source + artifact

**Files:**
- Modify: `design/chef/scripts/pack.py` (`STATES`, ~line 34)
- Modify: `web/frontend/src/assets/chef/chef.manifest.json` (`very_hot`
  entry)

- [ ] **Step 1: Add `css_animation` to `very_hot` in `pack.py`**

In `design/chef/scripts/pack.py`, find this line in the `STATES` table:

```python
    "very_hot": {"fps": 12, "temp_f": [550, None]},
```

Change it to:

```python
    "very_hot": {"fps": 12, "css_animation": "transcendence", "temp_f": [550, None]},
```

- [ ] **Step 2: Hand-edit `chef.manifest.json` to match**

In `web/frontend/src/assets/chef/chef.manifest.json`, the `very_hot` entry
currently reads:

```json
    "very_hot": {
      "frames": 1,
      "fps": 12,
      "temp_f": [
        550,
        null
      ]
    }
```

Change it to (inserting `css_animation` between `fps` and `temp_f`,
matching the field order `pack.py`'s `rebuild_manifest` produces):

```json
    "very_hot": {
      "frames": 1,
      "fps": 12,
      "css_animation": "transcendence",
      "temp_f": [
        550,
        null
      ]
    }
```

- [ ] **Step 3: Verify it type-checks**

Run: `cd web/frontend && bun run lint`
Expected: `tsc --noEmit` exits 0, no output.

- [ ] **Step 4: Commit**

```bash
git add design/chef/scripts/pack.py web/frontend/src/assets/chef/chef.manifest.json
git commit -m "art(chef): declare transcendence css_animation for very_hot"
```

---

### Task 2: Add the transcendence keyframes and aura styles to chef.css

**Files:**
- Modify: `web/frontend/src/chef/chef.css`

- [ ] **Step 1: Append the new keyframes and decoration styles**

Append the following block to the end of `web/frontend/src/chef/chef.css`
(after the existing `@keyframes chef-steam` block):

```css
/* `very_hot` — Chuck ascends. One combined transform keyframe (rotate +
   translateZ) and one combined filter keyframe (hue-rotate, saturate,
   brightness, drop-shadow) — both properties animate in parallel because
   they're distinct, but multiple animations on the same property would
   fight, so each property gets one keyframe that bakes in everything. */
@keyframes chef-transcend {
  0%   { transform: perspective(900px) rotate(0deg)   translateZ(0); }
  50%  { transform: perspective(900px) rotate(180deg) translateZ(60px); }
  100% { transform: perspective(900px) rotate(360deg) translateZ(0); }
}

@keyframes chef-trippy-filter {
  0%   { filter: hue-rotate(0deg)   saturate(1.3) brightness(1.0)  drop-shadow(0 0 14px rgba(255, 190, 100, 0.7)); }
  50%  { filter: hue-rotate(180deg) saturate(1.6) brightness(1.25) drop-shadow(0 0 32px rgba(180, 100, 255, 0.85)); }
  100% { filter: hue-rotate(360deg) saturate(1.3) brightness(1.0)  drop-shadow(0 0 14px rgba(255, 190, 100, 0.7)); }
}

/* Halo rings that emanate outward forever. Rendered behind the sprite
   inside `.chef__aura`, staggered so a new ring is always cresting while
   the previous one fades. */
.chef__aura {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.chef__halo {
  position: absolute;
  inset: 15%;
  border-radius: 50%;
  background: radial-gradient(
    circle,
    rgba(255, 220, 140, 0) 50%,
    rgba(255, 200, 140, 0.45) 70%,
    rgba(255, 220, 140, 0) 82%
  );
  opacity: 0;
  animation: chef-halo 4.5s ease-out infinite;
}

.chef__halo:nth-child(1) { animation-delay: 0s; }
.chef__halo:nth-child(2) { animation-delay: 1.5s; }
.chef__halo:nth-child(3) { animation-delay: 3s; }

@keyframes chef-halo {
  0%   { transform: scale(0.5); opacity: 0; }
  20%  { opacity: 0.8; }
  100% { transform: scale(2.0); opacity: 0; }
}
```

- [ ] **Step 2: Commit**

```bash
git add web/frontend/src/chef/chef.css
git commit -m "feat(web): chef transcendence keyframes + aura styles"
```

---

### Task 3: Wire `transcendence` into the engine catalogue

**Files:**
- Modify: `web/frontend/src/chef/ChefWidget.tsx`

- [ ] **Step 1: Extend `ChefEffect` with `aura?` and add the catalogue entry**

In `web/frontend/src/chef/ChefWidget.tsx`, find this block:

```tsx
interface ChefEffect {
  sprite: string;
  steam?: boolean;
}

const CHEF_EFFECTS: Record<string, ChefEffect> = {
  shiver: { sprite: "chef-shiver 0.18s ease-in-out infinite" },
  jig: { sprite: "chef-jig 0.72s ease-in-out infinite" },
  heat: { sprite: "chef-hot-glow 1.3s ease-in-out infinite", steam: true },
};
```

Replace it with:

```tsx
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
```

- [ ] **Step 2: Render the aura in `ChefSprite`**

In the same file, find the `ChefSprite` return block:

```tsx
  return (
    <div class="chef__stage">
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
```

Replace it with (aura rendered before the sprite so it paints behind, same
ordering trick as steam):

```tsx
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
```

- [ ] **Step 3: Verify lint, build, and tests**

Run: `cd web/frontend && bun run lint`
Expected: `tsc --noEmit` exits 0, no output.

Run: `cd web/frontend && bun run build`
Expected: build succeeds, no errors.

Run: `cd web/frontend && bun test src`
Expected: 6 tests pass.

- [ ] **Step 4: Commit**

```bash
git add web/frontend/src/chef/ChefWidget.tsx
git commit -m "feat(web): chef transcendence — catalogue entry + aura rendering"
```

---

## Verification

- **Automated:** `cd web/frontend && bun run lint`, `bun run build`, `bun
  test src` (6 passing).
- **Manual/visual:** `cd web/frontend && bun run demo`, then either drag
  the slider above 550 °F or hit the `very_hot (clamp)` button at 620 °F.
  Confirm:
  - Chuck slowly rotates around his centerpoint (full revolution every
    16s) and pulses forward in depth.
  - His colors slowly drift across the hue wheel — warm → cosmic violet →
    warm — with the brightness and glow shifting in sync.
  - Concentric halo rings emanate outward from him on a continuous loop,
    one new ring cresting roughly every 1.5s.
  - The combined motion reads as continuously evolving (the transform and
    filter periods are out of phase so it doesn't tick-tock).
  - Clicking the chef expands him to full-screen with the same effect at
    larger scale; clicking again collapses back.
  - The other states (`frozen` shiver, `active` jig, `hot` glow + steam)
    are unchanged.

## Out of scope

- `prefers-reduced-motion` handling — still a candidate for a separate
  accessibility pass across all chef animations.
- Phase scheduling (a true "series" of distinct scenes that swap over
  time) — the layered-composition approach delivers the screensaver feel
  without the complexity. If true scene cycling becomes desirable later,
  it would be a separate plan.
- Multi-frame animation for `very_hot` — sheet is still 1 frame.

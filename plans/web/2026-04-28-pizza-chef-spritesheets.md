# Pizza Chef Spritesheets — Art Plan

## Context

The live dashboard plan (`plans/web/2026-04-21-live-dashboard-design.md`)
defines Product 4 as a "Pizza chef screensaver. Spritesheet-driven animation
whose state is a function of live oven temperature." This plan owns **only
the art track** for that product: producing the spritesheet assets the
future engine plan will consume.

The character is a stylized male pizza chef hero (ginger beard, tall white
chef hat, chef whites, retro-arcade aesthetic with modern detail). He is
already registered as a reusable character in Ideogram via the Characters
feature; the source prompt and reference image are committed alongside
this plan as `chef-character-prompt.md` so the registration can be
reproduced if lost.

## Why this plan is art-only

Earlier brainstorming explored a unified plan that covered both engine
and art. Splitting them gives two real properties:

1. **Independent cadence.** Art progress is gated by Ideogram credits,
   which arrive in irregular drips. The engine plan is gated by code time.
   Linking them would mean either blocks the other.
2. **A clean interface.** The art track delivers a fixed contract (sprite
   sheets + manifest). The engine plan consumes that contract. Either
   side can be revised without invalidating the other.

The plan is also explicitly **incremental**: there is a first-done state
(after Session 1, every state has ≥1 frame and the engine plan can begin)
and a fully-done state (all sheets at target frame counts). Each session
between them ships a strict improvement; nothing downstream ever breaks.

## Decisions locked by this plan

These are foundations for the art pipeline. Changing them later means
re-doing work, so they are committed here.

1. **Spritesheets, not articulation.** Each frame is a baked PNG. The
   character is anchored in place. Locomotion (walking, pointing,
   reaching) is out of scope and would require a different art pipeline
   entirely (Spine, Rive, or hand-rigged commissioned art). A future
   "ambient mascot" plan may revisit this; the engine plan should leave a
   pluggable renderer hook so that future plan can swap drivers without
   restructuring.
2. **All states are continuous loops.** Frame N must transition cleanly
   back to frame 1. There are no one-shot transition animations within a
   sheet — state changes are visible as engine-driven sheet swaps, not as
   in-state narrative arcs. Transitions like "ice melting" or
   "shirt-removal" are explicitly out of scope and can be added later as
   one-shot mini-sheets if the abrupt cuts feel jarring once running.
3. **FX is baked into the character frames** (ice crystals, sweat drops,
   fire-edge glow, breath puff) via Ideogram prompts. The engine just
   plays sheets. If a particular FX turns out to be impossible for AI to
   render consistently, the plan calls it out as an "engine overlay"
   candidate and ships frames without it.
4. **Ideogram Character is the consistency mechanism.** The free tier
   gives ~25 character-consistent generations per day, which is the real
   binding constraint — *not* the 12 slow credits. Slow credits stay
   reserved for non-Character experiments (FX overlay tests, prompt
   tuning, reference images).
5. **CSS may animate the sheet as a rigid whole; it may not animate any
   sub-region.** A state's spritesheet may carry an optional
   `css_animation` name in the manifest. The engine wraps the sheet in
   a container that runs that CSS keyframe animation, which can apply
   `transform` (rotate, translate, scale), `opacity`, and `filter` to
   the entire sheet uniformly. It must not target any portion of the
   image — no clip-paths, no masks, no per-pixel effects. The bright
   line: if the effect can be expressed as one CSS rule applied to the
   whole `<img>`, it qualifies; if it needs to know where the chef's
   shoulders or hands are, it doesn't. This buys two things: (a) some
   states (notably `frozen`) collapse to a single AI frame plus a CSS
   loop, saving Ideogram credits; (b) motion that's awkward to bake
   (smooth shiver, gentle sway) becomes smooth interpolation rather
   than discrete frames. The cost is one new manifest field and a small
   catalogue of named keyframe animations on the engine side.

## The sprite contract

This is what the engine plan will consume. It is the deliverable of this
plan.

- **Frame size:** 512×512 px PNG, per frame. Source Ideogram outputs are
  ~1024×1024; downscale.
- **Background:** transparent PNG. Source generations have a white studio
  background; the per-session pipeline includes a background-removal pass.
- **Anchor:** character's feet rest on the bottom edge of the frame;
  horizontal center is the character's spine. Same anchor across every
  frame in a state — no jitter when the engine cycles.
- **Per-state spritesheet:** one horizontal-strip PNG per state, named
  `chef_<state>.png`. Width = `frame_count × 512`, height = 512.
- **Manifest:** one `chef.manifest.json` describing all states:

  ```json
  {
    "frame_size": [512, 512],
    "states": {
      "frozen":   { "frames": 1, "fps": null, "css_animation": "shiver", "temp_c": [null, 121] },
      "thawing":  { "frames": 3, "fps": 6,    "temp_c": [121, 177] },
      "active":   { "frames": 5, "fps": 8,    "temp_c": [177, 232] },
      "hot":      { "frames": 6, "fps": 10,   "temp_c": [232, 288] },
      "very_hot": { "frames": 8, "fps": 12,   "temp_c": [288, null] }
    }
  }
  ```

  `css_animation` is optional. When present, it names a CSS keyframe
  animation the engine applies to the sheet container per Decision #5.
  When `frames === 1`, `fps` is ignored (no frame cycling); the engine
  shows the single frame and lets CSS drive any motion. The catalogue
  of valid `css_animation` names is owned by the engine plan, not this
  one — this plan only declares which states want one and what motion
  it should convey (e.g., `frozen` wants "shiver").

  The originally specified °F values (200/300/400/500) were band
  *centers* — "Frozen ~200°F", etc. The manifest values are the °C
  *edges between bands*, computed as midpoints between adjacent centers
  (250/350/450/550 °F → 121/177/232/288 °C). Precise hysteresis around
  these edges is the engine plan's decision, not this plan's.

- **v1 escape hatch:** until each state has its full frame count, the
  manifest declares a smaller `frames` value and the engine renders
  whatever exists. This is what makes "skeleton-first, deepen later"
  work end-to-end on day one.

### Wall-clock duration

Each sheet is a continuous loop, not a timeline. The wall-clock duration
of being in a state is set by the oven, not the animation. Loop
durations from the manifest:

| State | Frames | FPS | Loop duration |
|---|---|---|---|
| frozen | 1 | — | CSS-driven (shiver) |
| thawing | 3 | 6 | 0.5s |
| active | 5 | 8 | 0.6s |
| hot | 6 | 10 | 0.6s |
| very_hot | 8 | 12 | 0.7s |

A 20-minute thaw plays the thawing sheet's 0.5s loop ~2,400 times. The
chef is "in a thawing mood" the whole time. `frozen` is a single static
frame whose motion is supplied entirely by the CSS `shiver` keyframe.

## Per-state prompt recipes

Every prompt uses the same template; only bracketed fields change.

### Prompt template

```
Using registered character: [Pizza Chef Hero].
Full-body, front-facing, neutral camera, feet on the bottom edge of the
frame, square 1:1 composition, clean white studio background.
Style: retro arcade game aesthetic with modern high detail, polished but
not photoreal, crisp linework, cel-shaded.
Pose: [STATE_POSE]
Expression: [STATE_EXPRESSION]
Wardrobe: [STATE_WARDROBE]
FX: [STATE_FX]
```

### Per-state deltas (loop descriptions)

Every state's frames must form a clean loop where frame N → frame 1 is
visually continuous.

**frozen — 1 frame + CSS `shiver`.**

- Frame 1: neutral upright pose, jaw clenched, narrowed eyes,
  shoulders square to camera (no tilt — the lean comes from CSS).
- Wardrobe: chef whites locked, frosted.
- FX: encased in pale ice block; frost on hat brim; visible breath puff.
- Motion: the engine applies the `shiver` CSS keyframe, which rotates
  the entire sheet a few degrees side-to-side on a fast loop. Per
  Decision #5, the rotation must affect the whole `<img>` uniformly
  (ice block included — it shivers with him, which reads fine because
  the block is part of the baked frame).

**thawing — 3 frames. Shake-off-ice cycle.**

- Frame 1: shoulders shake left, eyes squinting.
- Frame 2: shoulders shake right, eyes opening.
- Frame 3: full-body shudder, eyes open.
- Wardrobe: chef whites locked.
- FX: water droplets running off; receding ice at feet; subtle steam.
  Constant across all frames.

**active — 5 frames. Pizza-toss cycle.**

- Frame 1: ready, dough at chest.
- Frame 2: crouch, dough lower (anticipation).
- Frame 3: spring up, dough at peak (apex).
- Frame 4: catch, dough returning.
- Frame 5: set, dough back at chest → loops to Frame 1.
- Expression: confident grin, focused.
- Wardrobe: chef whites locked; pizza-dough disc as prop.
- FX: small flour puff at apex frame only.

**hot — 6 frames. Fan-self cycle.**

- Frame 1: hand at far-right of face.
- Frames 2–3: hand sweeping left across face.
- Frame 4: hand at far-left of face.
- Frames 5–6: hand sweeping right back to start.
- Expression: flushed, brow furrowed, mouth slightly open.
- Wardrobe: chef whites locked, jacket collar slightly open.
- FX: sweat beads on brow and neck; subtle red-cheek wash. Constant
  across all frames.

**very_hot — 8 frames. Heavy-pant cycle.**

- Wardrobe note: shirt is *already* off when this state begins. The
  shirt-off itself is a one-shot transition we cannot sheet — it appears
  removed compared to `hot`. Mask is **released** for this state so the
  Characters feature does not re-impose the chef jacket.
- Frame 1: shoulders down, mouth closed.
- Frames 2–4: shoulders rising, mouth opening, tongue starting to loll.
- Frame 5: peak inhale, tongue out, eyes squinted.
- Frames 6–8: shoulders falling, mouth closing back to start.
- FX: flickering orange fire-edge glow around silhouette across all
  frames; heavy sweat.

### Known-hard properties

- **Frame-to-frame micro-variation is unreliable.** Asking Ideogram for
  two frames that differ by a small chest movement will likely return
  illustrations that differ by much more. Budget ~1.5× the kept-frame
  count in real generations to absorb re-rolls.
- **Very Hot is the highest-risk state.** Mask-released wardrobe + fire
  FX + panting pose all in one prompt is a lot to ask. The credit-spending
  playbook defers it to the last session so Ideogram intuition is built
  up first.

## Repo layout & asset naming

```
web/
  frontend/
    src/
      assets/
        chef/
          chef.manifest.json           ← the contract above
          chef_frozen.png              ← horizontal sheet, 2 frames
          chef_thawing.png             ← 3 frames
          chef_active.png              ← 5 frames
          chef_hot.png                 ← 6 frames
          chef_very_hot.png            ← 8 frames
          raw/                         ← gitignored
            <YYYY-MM-DD>/              ← one folder per Ideogram session
              <state>_<nn>.png         ← unmodified Ideogram output (keepers only)
              <state>_<nn>.prompt.txt  ← exact prompt that produced it
plans/
  web/
    2026-04-28-pizza-chef-spritesheets.md   ← this plan
    art/
      chef-character-prompt.md         ← registered character source-of-truth
```

Conventions:

- **Sheets are committed.** They are the deliverable.
- **Raw Ideogram outputs are gitignored.** Huge, numerous, only useful
  mid-session. Keep locally as long as useful, delete when satisfied.
- **One `<state>_<nn>.prompt.txt` per kept `<state>_<nn>.png`.** Same
  basename, paired one-to-one. Cheap insurance against losing the recipe
  — future-you (or a future model) can see exactly what produced any
  given frame. `nn` is attempt order within that state (`01`, `02`, …);
  it does not have to be contiguous if you re-roll and discard.
- **Sheet naming = state name from manifest.** No version suffixes; when
  a sheet improves, commit over the previous one. Git history is the
  version log.
- **`chef-character-prompt.md`** captures the source-of-truth prompt for
  the registered character plus the screenshot of the approved character.
  If the Ideogram Character ever needs to be re-registered, this is how
  to reproduce it.

## Credit-spending playbook

Each session uses the daily Character quota (free, ~25/day), not the 12
slow credits. Slow credits stay reserved for non-Character experiments.

- **Session 1 (~5 Character gens). Skeleton.** One frame per state. Every
  state has v1 art (a static character with state-styling). The engine
  plan can start. End-to-end temperature-driven swap is demoable.
- **Session 2 (~8 gens). Deepen `active` to 5 frames.** This is the most
  visible state during a real cook — biggest user-visible win.
- **Session 3 (~9 gens). Deepen `hot` to 6 frames.** Second most common.
- **Session 4 (~5 gens). Deepen `thawing` to 3 frames.** `frozen`'s
  target is 1 frame under Decision #5 (CSS `shiver` supplies the
  motion), so this session covers thawing only. If Session 1's frozen
  frame fails a quality gate, re-roll it here too.
- **Session 5 (~12 gens). Tackle `very_hot` 8 frames.** Highest risk
  (mask-released wardrobe + fire FX + panting). Last on purpose.

Generation budgets are ~1.5× the kept-frame count to absorb re-rolls.

### Per-session loop

1. Open Ideogram, select the registered Pizza Chef Hero character.
2. Paste the prompt template from above, fill in the state delta.
3. Generate. Inspect. Re-roll if drift is too large (face changed,
   anchor moved, wardrobe wrong).
4. Save kept output to
   `web/frontend/src/assets/chef/raw/<YYYY-MM-DD>/<state>_<nn>.png`
   and the exact prompt to `<state>_<nn>.prompt.txt` next to it.
   `nn` is attempt order within that state; only save keepers, not
   rejected re-rolls.
5. Background-remove. Tool decided at execution; `rembg` CLI is the
   leading candidate (free, scriptable, lives in a venv).
6. Resize to 512×512, anchor character feet to the bottom edge.
7. Pack frames into the horizontal sheet `chef_<state>.png`. For v1
   single frame, the "sheet" is just one image. Script choice deferred
   (Python+Pillow, Node+sharp, or shell+ImageMagick).
8. Update `chef.manifest.json` with the current frame count for that
   state.
9. Commit. One commit per state per session, e.g.
   `art(chef): frozen v1 — 1 frame + CSS shiver`.

### Quality gates

A frame ships only if all four pass:

- Character is recognizably the same person (face, beard color, hat
  shape, jacket cut).
- Pose lands within the anchor envelope: feet on bottom edge, character
  horizontally centered.
- State styling is unmistakable at a glance — `frozen` is distinguishable
  from `hot` with no labels.
- Frame loops cleanly: imagined transition from last frame back to first
  frame does not jump.

## Done criteria

- **Plan v1 done (after Session 1):** all 5 states have ≥1 frame,
  `chef.manifest.json` is committed and accurate, `chef-character-prompt.md`
  is committed. Engine plan can begin.
- **Plan v2..v5 done (after each subsequent session):** the deepened
  state's sheet hits its target frame count, all four quality gates
  pass, manifest is updated.
- **Plan fully done:** all five sheets at their target frame counts
  (1/3/5/6/8), all gates green. `frozen`'s target is 1 frame because
  motion is CSS-driven (Decision #5).

There is no in-progress plan state that breaks anything downstream.

## Out of scope

Owned by the future engine plan, not this one:

- Where on screen the screensaver appears (full-screen, corner panel,
  widget).
- Tap-to-dismiss UX and re-show timing.
- Hysteresis: how to avoid sheet-flapping when temp hovers near a band
  edge.
- Crossfade vs hard-cut between state changes.
- FPS interpretation (advisory or strict).
- Engine-rendered FX overlays on top of sheets (e.g., particle fire for
  `very_hot` if AI-baked fire looks weak).
- Pluggable renderer hook for the future "ambient mascot" plan.

Owned by no plan today; noted for future:

- "Transition shots" (one-shot mini-sheets played on band crossings,
  e.g., shirt-removal between `hot` and `very_hot`, ice-melt between
  `frozen` and `thawing`).
- Reactive behaviors (chef noticing a phone pairing, reacting to "Next
  pizza" tap). Belongs to a future "ambient mascot" plan that would
  also revisit articulation.

## Open questions deferred to execution

These are easy to swap; pre-bikeshedding them now wastes time. They will
be decided after Session 1, when the actual workflow has been touched.

- Background-removal tool: `rembg` CLI, remove.bg web, or Photoshop.
- Sheet-packing script: Python+Pillow, Node+sharp, or shell+ImageMagick.

# Chef Demo Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A mock-data browser page that drives `ChefWidget` through every
state so the chef's behavior can be seen and confirmed without a backend or
a live firing.

**Architecture:** A second Vite entry point (`chef-demo.html` →
`src/chef/demo.tsx`) renders `ChefWidget` inside a minimal `.hero` frame —
the same visual context it occupies in production. A fixed controls panel
feeds the widget synthetic `Sample` data: a temperature slider, per-band
quick-jump buttons, and a play/pause auto-sweep. Dev-only — the page is not
part of the production build.

**Tech Stack:** Preact, Vite (multi-page dev server), TypeScript. No new
dependencies.

## Context

The pizza chef engine (`plans/web/2026-05-17-pizza-chef-engine.md`) shipped
`ChefWidget`, the `selectState` state machine, and the typed `manifest`.
The engine plan deferred "how to drive temperature across band edges" for
verification to execution. This harness answers that: it feeds `ChefWidget`
mock samples directly, sidestepping the backend/SSE question entirely.

The state machine already has full unit coverage in
`src/chef/state-machine.test.ts`. This harness covers the *visual* layer —
sprite selection per state and the compact↔expanded mode toggle — which is
not meaningfully unit-testable. Verification here is manual and visual; the
automated gate is `tsc` (`bun run lint`).

## File structure

All under `web/frontend/`, no new dependencies:

- `chef-demo.html` — second Vite entry; served at `/chef-demo.html` under
  `bun run dev`. Mirrors `index.html` (font links, `#app` root).
- `src/chef/demo.tsx` — the harness app: minimal `.hero` frame, `ChefWidget`,
  and the controls panel.
- `src/chef/demo.css` — controls-panel styling.
- `package.json` — add a `demo` convenience script.

`chef-demo.html` is not added to the Vite build `rollupOptions.input`, so
`bun run build` ignores it (production stays unchanged). `demo.tsx` lives
under `src/` so `tsc` still type-checks it.

---

### Task 1: Controls-panel styles and the HTML entry

**Files:**
- Create: `web/frontend/src/chef/demo.css`
- Create: `web/frontend/chef-demo.html`

- [ ] **Step 1: Write `demo.css`**

Reuses the project CSS variables from `styles.css` (`--bg-2`, `--signal`,
etc.). The panel sits at `z-index: 100` — above the expanded chef overlay
(`z-index: 50`) — so controls stay usable while the chef is full-screen.

```css
.demo-panel {
  position: fixed;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  z-index: 100;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 20px;
  width: min(520px, 92vw);
  background: var(--bg-2);
  border: 1px solid var(--bg-3);
  border-radius: 12px;
  font-family: "Inter Tight", system-ui, sans-serif;
}

.demo-panel__readout {
  text-align: center;
  font-size: 15px;
  letter-spacing: 1px;
  color: var(--ink-soft);
}

.demo-panel__readout strong {
  color: var(--signal);
  text-transform: uppercase;
}

.demo-panel__clamp {
  color: var(--signal-soft);
}

.demo-panel input[type="range"] {
  width: 100%;
  accent-color: var(--signal);
}

.demo-panel__bands {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
}

.demo-panel button {
  background: var(--bg-3);
  color: var(--ink);
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 8px 14px;
  font-size: 13px;
  cursor: pointer;
}

.demo-panel button:hover {
  border-color: var(--signal);
}
```

- [ ] **Step 2: Write `chef-demo.html`**

Identical to `index.html` except the title and the script entry point. The
Google Fonts links are kept so the harness renders in the real typeface.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>udcpinepdx · chef demo harness</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
      rel="stylesheet"
    />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/chef/demo.tsx"></script>
  </body>
</html>
```

- [ ] **Step 3: Commit**

```bash
git add web/frontend/src/chef/demo.css web/frontend/chef-demo.html
git commit -m "build(web): chef demo harness — shell + controls styles"
```

---

### Task 2: The harness app

**Files:**
- Create: `web/frontend/src/chef/demo.tsx`

- [ ] **Step 1: Write `demo.tsx`**

The harness builds a synthetic `Sample` from the current temperature and
passes it to `ChefWidget` as `latest_sample` — the exact prop `HeroNumber`
passes in production. It keeps its own `prevState` ref and runs `selectState`
the same way `ChefWidget` does internally, so the readout label tracks the
widget (including hysteresis). Band quick-jumps target each manifest band's
midpoint; the extra `very_hot (clamp)` jump at 620 °F exercises the
missing-state clamp. Any control interaction pauses the auto-sweep.

```tsx
import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { Sample } from "@udcpine/shared";
import { ChefWidget } from "./ChefWidget";
import { manifest, type ChefState } from "./manifest";
import { selectState } from "./state-machine";
import "../styles.css";
import "./demo.css";

const MIN_F = 0;
const MAX_F = 700;
const SWEEP_STEP_F = 4;
const SWEEP_INTERVAL_MS = 120;

interface BandJump {
  label: string;
  tempF: number;
}

// One quick-jump per manifest band (its midpoint), plus an above-range jump
// that lands in the deferred very_hot band to exercise the missing-state clamp.
const bandJumps: BandJump[] = (() => {
  const jumps: BandJump[] = Object.entries(manifest.states).map(
    ([state, spec]) => {
      const lo = spec.temp_f[0] ?? MIN_F;
      const hi = spec.temp_f[1] ?? MAX_F;
      return { label: state, tempF: Math.round((lo + hi) / 2) };
    },
  );
  jumps.push({ label: "very_hot (clamp)", tempF: 620 });
  return jumps;
})();

function tempInSomeBand(tempF: number): boolean {
  return Object.values(manifest.states).some((spec) => {
    const lo = spec.temp_f[0] ?? -Infinity;
    const hi = spec.temp_f[1] ?? Infinity;
    return tempF >= lo && tempF < hi;
  });
}

function ChefDemo() {
  const [tempF, setTempF] = useState(150);
  const [playing, setPlaying] = useState(false);
  const sweepDir = useRef(1);
  const prevState = useRef<ChefState | null>(null);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setTempF((t) => {
        let next = t + sweepDir.current * SWEEP_STEP_F;
        if (next >= MAX_F) {
          next = MAX_F;
          sweepDir.current = -1;
        } else if (next <= MIN_F) {
          next = MIN_F;
          sweepDir.current = 1;
        }
        return next;
      });
    }, SWEEP_INTERVAL_MS);
    return () => clearInterval(id);
  }, [playing]);

  function drive(next: number) {
    setPlaying(false);
    setTempF(next);
  }

  const sample: Sample = { t: new Date().toISOString(), temp_f: tempF };
  const state = selectState(tempF, prevState.current, manifest);
  prevState.current = state;
  const clamped = !tempInSomeBand(tempF);

  return (
    <main class="hero">
      <div class="hero__ember" aria-hidden="true" />

      <section class="hero__readout">
        <div class="hero__num">{Math.round(tempF)}</div>
        <div class="hero__unit">DEGREES FAHRENHEIT</div>
      </section>

      <ChefWidget latest_sample={sample} />

      <div class="demo-panel">
        <div class="demo-panel__readout">
          {Math.round(tempF)}°F → <strong>{state}</strong>
          {clamped && <span class="demo-panel__clamp"> (clamped)</span>}
        </div>
        <input
          type="range"
          min={MIN_F}
          max={MAX_F}
          value={tempF}
          onInput={(e) => drive(Number(e.currentTarget.value))}
        />
        <div class="demo-panel__bands">
          {bandJumps.map((j) => (
            <button key={j.label} type="button" onClick={() => drive(j.tempF)}>
              {j.label}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setPlaying((p) => !p)}>
          {playing ? "⏸ pause sweep" : "▶ play sweep"}
        </button>
      </div>
    </main>
  );
}

const root = document.getElementById("app");
if (!root) throw new Error("missing #app");
render(<ChefDemo />, root);
```

- [ ] **Step 2: Verify it type-checks**

Run: `cd web/frontend && bun run lint`
Expected: `tsc --noEmit` exits 0, no output.

- [ ] **Step 3: Commit**

```bash
git add web/frontend/src/chef/demo.tsx
git commit -m "build(web): chef demo harness — mock-data app"
```

---

### Task 3: Convenience script and visual verification

**Files:**
- Modify: `web/frontend/package.json` (scripts block)

- [ ] **Step 1: Add a `demo` script**

In `web/frontend/package.json`, add to `scripts` after `dev`:

```json
    "demo": "vite --port 5173 --open /chef-demo.html",
```

- [ ] **Step 2: Confirm the production build is unaffected**

Run: `cd web/frontend && bun run build`
Expected: build succeeds; `dist/` contains `index.html` only (no
`chef-demo.html`).

- [ ] **Step 3: Visual verification**

Run: `cd web/frontend && bun run demo`

In the opened page, confirm:
1. The compact ~200×200 chef appears bottom-right in the `.hero` frame.
2. Dragging the slider through 0→700 °F changes the chef's sprite at the
   band edges (250 / 350 / 450 °F); the readout shows the matching state.
3. Each band quick-jump button selects the right state; `very_hot (clamp)`
   shows `hot` with a `(clamped)` marker.
4. Clicking the chef expands it full-screen with the temperature readout;
   clicking the chef again collapses it. The controls panel stays usable
   while expanded.
5. `▶ play sweep` ramps the temperature up and down on a loop and the chef
   transitions through every state hands-free; `⏸` stops it; touching any
   control also stops it.
6. The `frozen` shiver wobble is visible below 250 °F.

- [ ] **Step 4: Commit**

```bash
git add web/frontend/package.json
git commit -m "build(web): add chef demo harness dev script"
```

---

## Verification

- **Automated:** `cd web/frontend && bun run lint` — `tsc` type-checks
  `demo.tsx`. `bun run build` — confirms production output is unchanged.
- **Manual/visual:** `bun run demo` — the harness itself, walked per
  Task 3 Step 3. Sprite animation and mode toggling are visual and not
  meaningfully unit-testable; the state-machine logic they depend on is
  already covered by `src/chef/state-machine.test.ts`.

## Out of scope

- A Playwright screenshot spec — could snapshot each state for CI later;
  a separate small follow-up if wanted.
- Inclusion in the production build — the harness is a dev tool.
- Any backend test hook or mock SSE feed — the harness feeds `ChefWidget`
  mock samples directly, so none is needed.

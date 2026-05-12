# Dashboard — End-to-End with Mock Data (Hero Number)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Context

First vertical slice of the live dashboard. The shared Zod ↔ Pydantic bridge (PR
#16) is live but has only ever round-tripped JSON files in tests. This plan
proves the bridge in anger: a Flask backend serves a hardcoded `Firing` validated
by the generated Pydantic model; a Preact SPA fetches it, parses with the shared
Zod schema, and renders the **Hero Number** dashboard layout
(`design_mocks/dashboard/01_hero_number.svg`).

No DB, no SSE, no auth, no real sensor — just the wire path with hardcoded data
and one rendered view. Subsequent plans add SSE (B), then user actions (C),
then real sensord, DB, Drive, auth.

**Goal:** A Flask `/api/state` returns a Pydantic-validated `Firing`; a Preact
SPA fetches it, Zod-parses it, and renders the Hero Number layout. `make dev`
brings up both servers; opening `http://localhost:5173` shows the dashboard.

**Architecture:** Two new packages cohabit `web/`. `web/backend/` is a uv-managed
Flask app that depends on the workspace `udcpine-shared` Python package (so
`from generated.pydantic import Firing` works). `web/frontend/` is a Vite + Preact
+ TypeScript app that imports `@udcpine/shared` via the existing bun workspace.
Vite's dev server proxies `/api` to Flask. The dashboard is a single component
that maps a `Firing` onto the Hero Number layout.

**Tech Stack:**
- **Backend:** Python 3.11.9, Flask 3.x, pytest. Managed by `uv`.
- **Frontend:** TypeScript 5.x, Preact 10, Vite 5, Zod (transitively via `@udcpine/shared`).
- **Shared:** existing `@udcpine/shared` (TS) + `udcpine-shared` (Python).
- **Driver:** Makefile targets `web-backend-*`, `web-frontend-*`, plus a top-level `dev`.

## Conscious decisions

1. **Vite + Preact, not Next.js / Astro / etc.** Per `plans/web/2026-04-21-live-dashboard-design.md`. Static SPA is what the kiosk needs; SSR would be wasted complexity on a Pi.
2. **Bun for the frontend dev/build, not pnpm/npm.** Consistent with the existing root workspace. The Pi only ever sees the built bundle, not bun.
3. **Flask, not FastAPI.** Per the design doc. Simpler, sync model fits the single-Pi single-writer architecture better.
4. **`web/frontend/` and `web/backend/` cohabit `web/`.** Per the design doc's repo-layout sketch.
5. **Hardcoded Firing in app.py for now.** No "mock service" abstraction. YAGNI — we'll replace it with real state in plan B/C, not extend a fake.
6. **No frontend test runner yet.** Smoke-tested in a real browser at the end of this plan. Vitest comes when there's behavior worth unit-testing (state, reducers, parsers in their own files).
7. **No CSS framework.** Hand-rolled CSS, custom properties for the palette. Hero Number's aesthetic is specific enough that a framework would fight us.

## Future scope — view modes

After this lands, we'll iteratively add the other selected layouts as alternate
"view modes" on a rotation. Mocks for each are at `design_mocks/dashboard/`:

- **Newspaper** (`03_newspaper.svg`)
- **Sparkline-forward** (`04_sparkline.svg`) — needs a temp time-series, so probably lands after plan B (SSE)
- **Pizza-first** (`05_pizza_first.svg`) — needs a target cook time per pizza, so probably lands when pizzas become a real entity
- **Brutalist control sheet** (`06_brutalist.html`)
- **Tasting menu** (`07_luxury.html`)
- **CRT arcade** (`08_arcade.html`) — pairs with the chef-sprite work
- **Mission control telemetry** (`10_telemetry.html`) — depends on event-log + temp-trace, probably after plan B

Each view mode is a new component sharing the same `<Dashboard firing={…} />`
prop shape. The view-mode rotator (timed cycle, manual swipe) is its own small
plan after we have at least three views built.

## File structure

```
udcpinepdx/
├── design_mocks/                            (already-staged untracked, committed in Task 1)
│   ├── chef_*.svg                           (existing)
│   └── dashboard/                           (existing — reference for this plan)
│       ├── 01_hero_number.svg               (the layout we're building)
│       ├── 03..05_*.svg, 06..10_*.html      (future view modes)
│       └── preview.html
├── Makefile                                 (MODIFY — add web-* + dev targets)
├── package.json                             (MODIFY — add web/frontend to workspaces)
├── web/
│   ├── backend/
│   │   ├── pyproject.toml                   (NEW)
│   │   ├── Makefile.include                 (NEW)
│   │   ├── .python-version                  (NEW — copy of repo root)
│   │   ├── src/
│   │   │   └── udcpine_backend/
│   │   │       ├── __init__.py              (NEW)
│   │   │       ├── app.py                   (NEW — Flask app, /api/state)
│   │   │       └── mock_state.py            (NEW — hardcoded Firing factory)
│   │   └── tests/
│   │       ├── __init__.py
│   │       └── test_api.py                  (NEW — pytest for /api/state)
│   └── frontend/
│       ├── package.json                     (NEW)
│       ├── tsconfig.json                    (NEW)
│       ├── vite.config.ts                   (NEW — /api proxy to :5000)
│       ├── Makefile.include                 (NEW)
│       ├── index.html                       (NEW — HTML shell + Google Fonts)
│       └── src/
│           ├── main.tsx                     (NEW — entry)
│           ├── app.tsx                      (NEW — top-level component, fetch + render)
│           ├── api.ts                       (NEW — fetchState() + Zod parse)
│           ├── styles.css                   (NEW — palette, reset, Hero Number layout)
│           └── views/
│               └── hero-number.tsx          (NEW — the one view we ship in this plan)
```

---

## Task 1: Commit dashboard reference mocks

The 10 dashboard mocks at `design_mocks/dashboard/` are already on disk untracked.
They are reference for this build and for future view-mode plans, so they need to
be in the tree before any code references them.

**Files:**
- Add: `design_mocks/dashboard/*` (10 SVG/HTML files + `preview.html`)
- Add: `design_mocks/chef_*.svg` and `design_mocks/gen_*.py` (also untracked, related)

- [ ] **Step 1: Inspect what's untracked**

Run: `git status -uall design_mocks/`
Expected: lists chef sprite SVGs, generator scripts, and the `dashboard/` subtree.

- [ ] **Step 2: Stage and commit the mocks**

```bash
git add design_mocks/
git commit -m "design(web): dashboard layout mocks + chef sprite mocks"
```

---

## Task 2: Add `web/frontend/` to bun workspaces

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update workspaces array**

Edit `package.json`. Change:

```json
"workspaces": ["shared"],
```

to:

```json
"workspaces": ["shared", "web/frontend"],
```

- [ ] **Step 2: Verify (workspace dir doesn't exist yet, but root config should still parse)**

Run: `bun install`
Expected: completes without error. (Bun tolerates workspace globs that don't yet match.)

- [ ] **Step 3: Commit**

```bash
git add package.json bun.lock
git commit -m "chore(web): add web/frontend to bun workspaces"
```

---

## Task 3: Scaffold Flask backend package

**Files:**
- Create: `web/backend/pyproject.toml`
- Create: `web/backend/.python-version`
- Create: `web/backend/src/udcpine_backend/__init__.py`
- Create: `web/backend/tests/__init__.py`

- [ ] **Step 1: Write `web/backend/pyproject.toml`**

```toml
[project]
name = "udcpine-backend"
version = "0.0.0"
description = "Flask backend for the udcpinepdx live dashboard"
requires-python = ">=3.11"
dependencies = [
  "flask>=3.0,<4",
  "udcpine-shared",
]

[dependency-groups]
dev = [
  "pytest>=8.0",
  "ruff>=0.4",
]

[tool.uv.sources]
udcpine-shared = { path = "../../shared", editable = true }

[tool.uv]
package = true

[tool.hatch.build.targets.wheel]
packages = ["src/udcpine_backend"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.ruff]
target-version = "py311"
line-length = 100

[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["src"]
```

- [ ] **Step 2: Pin Python**

Write `web/backend/.python-version`:

```
3.11.9
```

- [ ] **Step 3: Create empty package and tests modules**

Write `web/backend/src/udcpine_backend/__init__.py`:

```python
"""udcpine backend — Flask app serving the live dashboard."""
```

Write `web/backend/tests/__init__.py`:

```
```

(empty file)

- [ ] **Step 4: Sync the venv**

Run: `cd web/backend && uv sync`
Expected: creates `web/backend/.venv/`, installs flask, pytest, ruff, and the local `udcpine-shared` package.

- [ ] **Step 5: Verify the shared Pydantic models import**

Run: `cd web/backend && uv run python -c "from generated.pydantic import Firing; print(Firing.model_fields.keys())"`
Expected: `dict_keys(['id', 'started_at', 'ended_at', 'status'])`.

If it fails with `ModuleNotFoundError`: the `udcpine-shared` editable install didn't pick up `generated/pydantic` because there's no `generated/__init__.py`. Add an empty `shared/generated/__init__.py` and re-sync. (Tests in `shared/` worked without it because pytest was invoked from `shared/` cwd; the editable install needs the namespace package marker.)

- [ ] **Step 6: Commit**

```bash
git add web/backend/pyproject.toml web/backend/.python-version web/backend/src/ web/backend/tests/__init__.py web/backend/uv.lock shared/generated/__init__.py 2>/dev/null || true
git commit -m "chore(web): scaffold Flask backend package with uv"
```

(The `shared/generated/__init__.py` is added only if Step 5 needed it.)

---

## Task 4: TDD `/api/state` — failing test first

**Files:**
- Create: `web/backend/tests/test_api.py`

- [ ] **Step 1: Write the failing test**

Write `web/backend/tests/test_api.py`:

```python
"""Contract tests for the Flask backend endpoints.

These tests assert that responses deserialize cleanly into the shared Pydantic
models — the same models the Pi will use, the same shapes the Zod schemas on
the frontend will accept.
"""
from __future__ import annotations

import json

import pytest
from generated.pydantic import Firing

from udcpine_backend.app import create_app


@pytest.fixture()
def client():
    app = create_app()
    app.config.update(TESTING=True)
    return app.test_client()


def test_get_state_returns_valid_firing(client) -> None:
    res = client.get("/api/state")
    assert res.status_code == 200
    payload = json.loads(res.data)
    # Round-trip through the shared Pydantic model — proves the wire shape
    # exactly matches the contract the Pi firmware will speak.
    firing = Firing.model_validate(payload)
    assert firing.status in ("active", "ended")
    assert firing.id >= 0


def test_get_state_response_is_application_json(client) -> None:
    res = client.get("/api/state")
    assert res.content_type.startswith("application/json")
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web/backend && uv run pytest -v`
Expected: FAIL with `ImportError` or `ModuleNotFoundError` (because `udcpine_backend.app` doesn't exist yet).

---

## Task 5: Minimal Flask app with hardcoded `/api/state`

**Files:**
- Create: `web/backend/src/udcpine_backend/mock_state.py`
- Create: `web/backend/src/udcpine_backend/app.py`

- [ ] **Step 1: Write `web/backend/src/udcpine_backend/mock_state.py`**

```python
"""Hardcoded firing state for the first vertical slice.

Replaced in plan B by an in-memory state populated from sensord; replaced in
plan C by SQLite-backed state. Kept deliberately dumb so it's obvious when
it's being used.
"""
from __future__ import annotations

from generated.pydantic import Firing


def current_firing() -> Firing:
    return Firing(
        id=42,
        started_at="2026-04-28T18:24:00-07:00",
        ended_at=None,
        status="active",
    )
```

- [ ] **Step 2: Write `web/backend/src/udcpine_backend/app.py`**

```python
"""Flask app factory and route definitions.

The app is intentionally tiny right now: one endpoint, hardcoded data,
no DB, no auth. Each subsequent plan replaces a chunk.
"""
from __future__ import annotations

from flask import Flask, Response

from .mock_state import current_firing


def create_app() -> Flask:
    app = Flask(__name__)

    @app.get("/api/state")
    def get_state() -> Response:
        firing = current_firing()
        # Pydantic's model_dump_json gives us a canonical wire representation
        # that the Zod schema on the frontend will accept verbatim.
        return Response(firing.model_dump_json(), mimetype="application/json")

    return app
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `cd web/backend && uv run pytest -v`
Expected: 2 PASS.

- [ ] **Step 4: Commit**

```bash
git add web/backend/src/udcpine_backend/ web/backend/tests/test_api.py
git commit -m "feat(web): GET /api/state returns hardcoded Firing"
```

---

## Task 6: Backend Makefile.include + run target

**Files:**
- Create: `web/backend/Makefile.include`
- Modify: `Makefile`

- [ ] **Step 1: Write `web/backend/Makefile.include`**

```make
WEB_BACKEND_DIR := web/backend

.PHONY: web-backend-install web-backend-test web-backend-lint web-backend-run

web-backend-install:
	cd $(WEB_BACKEND_DIR) && uv sync

web-backend-test:
	cd $(WEB_BACKEND_DIR) && uv run pytest

web-backend-lint:
	cd $(WEB_BACKEND_DIR) && uv run ruff check .

web-backend-run:
	cd $(WEB_BACKEND_DIR) && uv run flask --app udcpine_backend.app:create_app run --debug --port 5000
```

- [ ] **Step 2: Update top-level `Makefile`**

Add `include web/backend/Makefile.include` below the existing `include shared/Makefile.include`. Update the `build`, `test`, and `lint` targets so they fan out to web-backend as well:

Replace the existing `build`, `test`, `lint` blocks with:

```make
build:
	bun install
	cd shared && uv sync
	cd web/backend && uv sync

codegen: shared-codegen

test: shared-test web-backend-test

lint: shared-lint web-backend-lint
```

Add a new help line for `dev` (we'll wire `dev` itself in Task 11).

- [ ] **Step 3: Verify**

Run: `make web-backend-test`
Expected: 2 PASS.

Run from another terminal: `make web-backend-run`
In a third terminal: `curl -s http://localhost:5000/api/state | python3 -m json.tool`
Expected: pretty-printed JSON with id 42, status "active". Then `Ctrl-C` the running Flask.

- [ ] **Step 4: Commit**

```bash
git add web/backend/Makefile.include Makefile
git commit -m "build(web): backend Makefile + run target"
```

---

## Task 7: Scaffold Vite + Preact + TS frontend

**Files:**
- Create: `web/frontend/package.json`
- Create: `web/frontend/tsconfig.json`
- Create: `web/frontend/vite.config.ts`
- Create: `web/frontend/index.html`
- Create: `web/frontend/src/main.tsx`
- Create: `web/frontend/src/app.tsx`
- Create: `web/frontend/src/styles.css`

- [ ] **Step 1: Write `web/frontend/package.json`**

```json
{
  "name": "@udcpine/frontend",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --port 5173",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview --port 5173",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "@udcpine/shared": "workspace:*",
    "preact": "^10.22.0"
  },
  "devDependencies": {
    "@preact/preset-vite": "^2.9.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.0"
  }
}
```

(Note: TypeScript 5.6 is used here, not 6.x as in `shared/`. Reason: `@preact/preset-vite` and Vite 5 have not yet certified TS 6. Pin to 5.6 here; revisit when Preact's tooling catches up.)

- [ ] **Step 2: Write `web/frontend/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "jsxImportSource": "preact",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "isolatedModules": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "vite.config.ts"]
}
```

- [ ] **Step 3: Write `web/frontend/vite.config.ts`**

```typescript
import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

export default defineConfig({
  plugins: [preact()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:5000",
    },
  },
});
```

- [ ] **Step 4: Write `web/frontend/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1024, initial-scale=1" />
    <title>udcpinepdx · live</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
      rel="stylesheet"
    />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Write `web/frontend/src/main.tsx`**

```tsx
import { render } from "preact";
import { App } from "./app";
import "./styles.css";

const root = document.getElementById("app");
if (!root) throw new Error("missing #app");
render(<App />, root);
```

- [ ] **Step 6: Write a placeholder `web/frontend/src/app.tsx`**

```tsx
export function App() {
  return <main>loading…</main>;
}
```

- [ ] **Step 7: Write a placeholder `web/frontend/src/styles.css`**

```css
:root { color-scheme: dark; }
html, body { margin: 0; padding: 0; background: #0E0B08; color: #FFE9D6; font-family: "Inter Tight", system-ui, sans-serif; }
main { display: grid; place-items: center; min-height: 100dvh; }
```

- [ ] **Step 8: Install and smoke-build**

Run: `bun install`
Expected: pulls preact, vite, typescript, @preact/preset-vite. Resolves `@udcpine/shared` from the workspace.

Run: `cd web/frontend && bun run lint`
Expected: tsc passes (no errors).

- [ ] **Step 9: Commit**

```bash
git add web/frontend/ package.json bun.lock
git commit -m "chore(web): scaffold Vite + Preact + TS frontend"
```

---

## Task 8: Frontend `fetchState()` — Zod-validated client

**Files:**
- Create: `web/frontend/src/api.ts`

- [ ] **Step 1: Write `web/frontend/src/api.ts`**

```typescript
import { FiringSchema, type Firing } from "@udcpine/shared";

/**
 * Fetch the current firing state from the Flask backend and validate it
 * against the shared Zod schema. Throws on network errors or contract
 * violations — the dashboard treats both as "data unavailable."
 */
export async function fetchState(): Promise<Firing> {
  const res = await fetch("/api/state");
  if (!res.ok) throw new Error(`/api/state returned ${res.status}`);
  const json = (await res.json()) as unknown;
  const parsed = FiringSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`/api/state contract violation: ${parsed.error.message}`);
  }
  return parsed.data;
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `cd web/frontend && bun run lint`
Expected: PASS.

---

## Task 9: Hero Number view

**Files:**
- Create: `web/frontend/src/views/hero-number.tsx`
- Modify: `web/frontend/src/styles.css`

The reference is `design_mocks/dashboard/01_hero_number.svg`. Layout: dark
background with a subtle ember radial; tiny status row top; massive temp number
center; pizza card pinned bottom. For this slice we only have the `Firing` data
(id, started_at, status) — no temperature, no pizza yet. So we render:

- The status row from real data (firing id, elapsed since `started_at`).
- The big number is a placeholder `—°` until plan B ships a temp value.
- The pizza card shows "no pizza" until plan C ships pizza state.

This intentionally **does not** invent fields. We render what we have.

- [ ] **Step 1: Write `web/frontend/src/views/hero-number.tsx`**

```tsx
import type { Firing } from "@udcpine/shared";

interface HeroNumberProps {
  firing: Firing;
}

function formatElapsed(startedAtIso: string): string {
  const ms = Date.now() - Date.parse(startedAtIso);
  if (Number.isNaN(ms) || ms < 0) return "0:00:00";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export function HeroNumber({ firing }: HeroNumberProps) {
  const elapsed = formatElapsed(firing.started_at);
  return (
    <main class="hero">
      <div class="hero__ember" aria-hidden="true" />

      <header class="hero__status">
        <span class="hero__id">
          FIRING #{firing.id.toString().padStart(3, "0")} · {firing.status.toUpperCase()} {elapsed}
        </span>
        <span class="hero__live">
          <span class="hero__dot" aria-hidden="true" />
          LIVE
        </span>
      </header>

      <section class="hero__readout">
        <div class="hero__num" aria-label="hearth temperature unavailable">—</div>
        <div class="hero__unit">DEGREES FAHRENHEIT</div>
        <div class="hero__delta">awaiting sensor data</div>
      </section>

      <footer class="hero__pizza">
        <span class="hero__pizza-label">NOW BAKING</span>
        <span class="hero__pizza-name">no pizza</span>
        <div class="hero__pizza-timer">
          <span class="hero__pizza-elapsed-label">ELAPSED</span>
          <span class="hero__pizza-elapsed">—</span>
        </div>
      </footer>
    </main>
  );
}
```

- [ ] **Step 2: Replace `web/frontend/src/styles.css` with the Hero Number palette + layout**

```css
:root {
  color-scheme: dark;
  --bg: #0E0B08;
  --bg-2: #1A1410;
  --bg-3: #2A2018;
  --ink: #FFE9D6;
  --ink-soft: #9A8E83;
  --signal: #FF6A1A;
  --signal-soft: #FF8A3D;
  --ok: #3DDC84;
}

* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: var(--bg); color: var(--ink); font-family: "Inter Tight", system-ui, sans-serif; }
body { min-height: 100dvh; }

.hero {
  position: relative;
  min-height: 100dvh;
  width: min(1024px, 100vw);
  margin: 0 auto;
  display: grid;
  grid-template-rows: auto 1fr auto;
  padding: 0 40px;
}

.hero__ember {
  position: absolute; inset: 0; z-index: 0; pointer-events: none;
  background: radial-gradient(ellipse at 50% 38%, rgba(255,106,26,0.35) 0%, rgba(255,106,26,0.05) 60%, transparent 100%);
}

.hero__status {
  position: relative; z-index: 1;
  display: flex; justify-content: space-between; align-items: center;
  padding-top: 40px;
  font-size: 14px; letter-spacing: 2px; color: var(--ink-soft);
}
.hero__live { display: inline-flex; align-items: center; gap: 8px; color: var(--ok); }
.hero__dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ok); animation: pulse 1.6s ease-in-out infinite; }
@keyframes pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }

.hero__readout {
  position: relative; z-index: 1;
  text-align: center;
  align-self: center;
}
.hero__num {
  font-family: "Inter Tight", sans-serif;
  font-weight: 700;
  font-size: clamp(180px, 28vw, 280px);
  line-height: 0.85;
  letter-spacing: -8px;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}
.hero__unit { color: var(--signal-soft); font-size: 22px; letter-spacing: 6px; margin-top: 12px; }
.hero__delta { color: var(--ink-soft); font-size: 14px; margin-top: 16px; }

.hero__pizza {
  position: relative; z-index: 1;
  margin-bottom: 30px;
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 24px;
  background: var(--bg-2);
  border: 1px solid var(--bg-3);
  border-radius: 14px;
  padding: 24px 28px;
}
.hero__pizza-label { display: block; font-size: 12px; letter-spacing: 3px; color: var(--ink-soft); }
.hero__pizza-name { display: block; font-size: 34px; font-weight: 600; color: var(--ink); margin-top: 4px; }
.hero__pizza-timer { text-align: right; }
.hero__pizza-elapsed-label { display: block; font-size: 12px; letter-spacing: 3px; color: var(--ink-soft); }
.hero__pizza-elapsed { display: block; font-size: 40px; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--ink); }
```

- [ ] **Step 3: Verify it typechecks**

Run: `cd web/frontend && bun run lint`
Expected: PASS.

---

## Task 10: Wire the fetch into App + render Hero Number

**Files:**
- Modify: `web/frontend/src/app.tsx`

- [ ] **Step 1: Replace `web/frontend/src/app.tsx`**

```tsx
import { useEffect, useState } from "preact/hooks";
import type { Firing } from "@udcpine/shared";
import { fetchState } from "./api";
import { HeroNumber } from "./views/hero-number";

type LoadState =
  | { kind: "loading" }
  | { kind: "ok"; firing: Firing }
  | { kind: "error"; message: string };

export function App() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetchState()
      .then((firing) => {
        if (!cancelled) setState({ kind: "ok", firing });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === "loading") return <main class="hero"><div class="hero__delta">loading…</div></main>;
  if (state.kind === "error") return <main class="hero"><div class="hero__delta">error: {state.message}</div></main>;
  return <HeroNumber firing={state.firing} />;
}
```

- [ ] **Step 2: Verify**

Run: `cd web/frontend && bun run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add web/frontend/src/api.ts web/frontend/src/app.tsx web/frontend/src/views/ web/frontend/src/styles.css
git commit -m "feat(web): Hero Number view fetches /api/state via shared Zod"
```

---

## Task 11: Frontend Makefile + top-level `make dev`

**Files:**
- Create: `web/frontend/Makefile.include`
- Modify: `Makefile`

- [ ] **Step 1: Write `web/frontend/Makefile.include`**

```make
WEB_FRONTEND_DIR := web/frontend

.PHONY: web-frontend-install web-frontend-dev web-frontend-build web-frontend-lint

web-frontend-install:
	bun install --filter @udcpine/frontend

web-frontend-dev:
	cd $(WEB_FRONTEND_DIR) && bun run dev

web-frontend-build:
	cd $(WEB_FRONTEND_DIR) && bun run build

web-frontend-lint:
	cd $(WEB_FRONTEND_DIR) && bun run lint
```

- [ ] **Step 2: Update top-level `Makefile`**

Add `include web/frontend/Makefile.include` after the backend include. Update the `lint` and `help` targets, and add a new `dev` target that runs both servers in parallel:

```make
lint: shared-lint web-backend-lint web-frontend-lint

dev:
	@echo "Starting Flask (:5000) and Vite (:5173)…"
	@$(MAKE) -j2 web-backend-run web-frontend-dev
```

Update `help`:

```make
help:
	@echo "Available targets:"
	@echo "  build     install all workspace deps (bun + uv)"
	@echo "  codegen   regenerate shared/generated/ from Zod sources"
	@echo "  test      run all test suites"
	@echo "  lint      run all linters"
	@echo "  dev       run Flask + Vite together (Ctrl-C stops both)"
```

- [ ] **Step 3: Verify lint and build still work**

Run: `make lint`
Expected: all three (shared, web-backend, web-frontend) pass.

Run: `make web-frontend-build`
Expected: tsc + vite build succeed; produces `web/frontend/dist/`.

- [ ] **Step 4: Add `web/frontend/dist/` to `.gitignore`**

Append to `.gitignore`:

```
# Vite build output
web/frontend/dist/
```

- [ ] **Step 5: Commit**

```bash
git add web/frontend/Makefile.include Makefile .gitignore
git commit -m "build(web): frontend Makefile + top-level dev target"
```

---

## Task 12: End-to-end smoke test

**Files:** none.

- [ ] **Step 1: Start both servers**

Run: `make dev`
Expected: Flask logs `Running on http://127.0.0.1:5000`; Vite logs `Local: http://localhost:5173/`. Both stay running.

- [ ] **Step 2: Open the app**

Open `http://localhost:5173/` in a browser.
Expected:
- Top bar: `FIRING #042 · ACTIVE 0:00:00` (or whatever elapsed time has passed since 2026-04-28T18:24).
- A green LIVE indicator with a pulsing dot.
- Big `—` where the temp will go, captioned `DEGREES FAHRENHEIT`, with `awaiting sensor data` underneath.
- Pizza card at the bottom: `NOW BAKING / no pizza`, `ELAPSED / —`.
- No console errors.

- [ ] **Step 3: Verify the bridge actually fired**

Open DevTools → Network → click `state`. The response body must validate as a `Firing`:
- `id: 42`
- `started_at: "2026-04-28T18:24:00-07:00"`
- `ended_at: null`
- `status: "active"`

In Console: paste

```javascript
const r = await fetch("/api/state"); console.log(await r.json());
```

Expected: same payload.

- [ ] **Step 4: Drift sanity check (optional but informative)**

In `web/backend/src/udcpine_backend/mock_state.py`, change `status="active"` to `status="cooking"`. Reload the page. The Zod parse will fail and the app will render an error like `error: /api/state contract violation: …`. This is the bridge doing its job — the same wire-shape divergence that would corrupt data silently in a typical setup is caught at the boundary on both sides (Pydantic on serialize, Zod on receive). Revert the change.

- [ ] **Step 5: Stop the servers**

`Ctrl-C` `make dev`.

- [ ] **Step 6: No commit (smoke test only).**

---

## Self-review checklist

- [ ] Every file in the file structure has a creating task.
- [ ] No "TBD"/"TODO"/"implement later" anywhere in the task bodies.
- [ ] All identifiers used in later tasks (`fetchState`, `HeroNumber`, `current_firing`, `create_app`, CSS class names like `hero__num`) are defined exactly once in the task that creates them.
- [ ] Pydantic import path (`from generated.pydantic import Firing`) matches what `shared/` ships.
- [ ] Zod import path (`@udcpine/shared`) matches the workspace name in `shared/package.json`.
- [ ] `vite.config.ts` proxies `/api` to `:5000` so the same `fetch("/api/state")` works in dev and (later) in prod served by Flask.
- [ ] No new dependency outside the design doc's tech-stack commitments (Flask, Preact, Vite, TypeScript, Zod via shared, Pydantic via shared).
- [ ] Hero Number view does not invent fields the wire contract doesn't have. Temp and pizza placeholders are visible and labeled "awaiting".
- [ ] Drift sanity check (Task 12 Step 4) closes the loop on the whole point of this slice: bridge catches contract violations on both sides.

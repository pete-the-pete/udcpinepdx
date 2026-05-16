# Playwright E2E in CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Context

Every dashboard slice so far has merged on the strength of `tsc` + `vite build`
(compiles) and a Claude-side Playwright snapshot (lives only in the chat
transcript). Nothing in CI actually drives the rendered UI. A button could be
wired wrong, the SSE stream could silently break, and every gate would still
pass.

This plan closes that: one real end-to-end test that boots both servers, drives
a browser through the full firing flow (idle → START → live temp climbs → STOP
→ idle), and runs as a CI job on every PR.

**Goal:** A Playwright test exercises the idle → start → live-temperature → stop loop against real Flask + Vite servers, and gates every PR via a CI job.

**Architecture:** Playwright lives in `web/frontend/`. Its `webServer` config boots Flask (`:5001`) and Vite (`:5173`) before the suite and tears them down after. The single spec drives Chromium against `:5173`, asserting the idle CTA, the active view after START, a climbing temperature (proof the SSE stream delivers), and the return to idle after STOP. A new `e2e` CI job installs the Chromium binary and runs the suite parallel to the existing `shared` job. `make e2e` runs it locally. It is deliberately NOT part of `make test` — that stays fast and browser-free.

**Tech Stack:** `@playwright/test` (own runner + assertions), Chromium only. Bun runs it.

---

## Conscious decisions

1. **Separate `make e2e`, not folded into `make test`.** E2E needs browser binaries and boots real servers — slow and heavier. `make test` stays a fast unit gate; CI runs `e2e` as its own job so a frontend failure is legible separately from a unit failure.
2. **Chromium only.** The kiosk is Chromium; the phone is also Chromium/WebKit but we're not chasing cross-browser yet. One browser keeps CI fast. Firefox/WebKit can be added to the `projects` array later for ~free.
3. **Playwright's `webServer` boots the servers, not `make dev`.** `webServer` accepts an array; it handles readiness polling and teardown per-process. Wrapping `make dev` (which uses `make -j2`) inside Playwright's process management is flakier on signal propagation.
4. **The temp-climb assertion proves SSE, not just one sample.** Asserting the hero number climbs *past* 80°F (≈8s into the mock ramp from 70°F) only passes if multiple SSE `sample` events were delivered and reduced. A single static sample would stall at ~70.
5. **E2E test is not type-checked by `bun run lint`.** The frontend `tsconfig.json` `include` covers `src/**` only; Playwright compiles its own specs. We leave it that way — adding the spec to the app tsconfig would drag `@playwright/test` types into the app build.

## Future scope (deferred)

- Cross-browser (WebKit/Firefox projects).
- Visual regression snapshots.
- Pizza-flow assertions (no pizza UI yet).
- Trace/video artifact upload on CI failure (easy add later via `actions/upload-artifact`).

---

## File structure

```
udcpinepdx/
├── plans/web/2026-05-16-playwright-e2e.md      (this plan)
├── .github/workflows/ci.yml                    (MODIFY — add `e2e` job)
├── Makefile                                    (MODIFY — add `e2e` target)
├── web/frontend/
│   ├── package.json                            (MODIFY — add @playwright/test devDep + scripts)
│   ├── Makefile.include                        (MODIFY — add web-frontend-e2e)
│   ├── playwright.config.ts                    (NEW — config + dual webServer)
│   ├── .gitignore                              (NEW — ignore playwright-report/, test-results/)
│   └── tests/
│       └── e2e/
│           └── dashboard.spec.ts               (NEW — the firing-flow test)
```

---

## Task 1: Add Playwright dependency + config

**Files:**
- Modify: `web/frontend/package.json`
- Create: `web/frontend/playwright.config.ts`
- Create: `web/frontend/.gitignore`

- [ ] **Step 1: Add `@playwright/test` and e2e scripts to `web/frontend/package.json`**

Replace the `scripts` and `devDependencies` blocks so the file reads:

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
    "lint": "tsc --noEmit",
    "e2e": "playwright test"
  },
  "dependencies": {
    "@udcpine/shared": "workspace:*",
    "preact": "^10.22.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.48.0",
    "@preact/preset-vite": "^2.9.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.0"
  }
}
```

- [ ] **Step 2: Install**

Run from repo root: `bun install`
Expected: `@playwright/test` is added. (The browser binary is installed separately in Step 4 — the npm package alone is not enough to run.)

- [ ] **Step 3: Write `web/frontend/playwright.config.ts`**

```typescript
import { defineConfig, devices } from "@playwright/test";

/**
 * Boots Flask (:5001) and Vite (:5173) before the suite, tears them down
 * after. Tests drive Chromium against the Vite dev server, which proxies
 * /api to Flask exactly as in `make dev`.
 *
 * webServer commands run with this file's directory (web/frontend) as cwd.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  // One worker: the backend Store is a single in-memory session; parallel
  // tests would fight over it. The suite is tiny, so this is not a cost.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "list",
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "cd ../backend && uv run flask --app udcpine_backend.app:create_app run --port 5001",
      url: "http://127.0.0.1:5001/api/state",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: "bun run dev",
      url: "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
```

- [ ] **Step 4: Write `web/frontend/.gitignore`**

```
playwright-report/
test-results/
```

- [ ] **Step 5: Install the Chromium binary**

Run: `cd web/frontend && bunx playwright install chromium`
Expected: downloads the Chromium build Playwright pins. (On CI we add `--with-deps`; locally on macOS the deps are already present.)

- [ ] **Step 6: Commit**

```bash
git add web/frontend/package.json web/frontend/playwright.config.ts web/frontend/.gitignore bun.lock
git commit -m "chore(web): add Playwright + dual-webServer config"
```

---

## Task 2: Write the firing-flow E2E spec

**Files:**
- Create: `web/frontend/tests/e2e/dashboard.spec.ts`

- [ ] **Step 1: Write `web/frontend/tests/e2e/dashboard.spec.ts`**

```typescript
import { test, expect } from "@playwright/test";

/**
 * Full firing loop against real Flask + Vite servers:
 *   idle  →  START  →  live temperature climbs (SSE)  →  STOP  →  idle
 *
 * The climb assertion is the load-bearing one: it only passes if the SSE
 * stream delivered multiple `sample` events and the reducer folded them in.
 * A broken stream would leave the number stuck at "—" or a single ~70.
 */
test("idle → start → live temp climbs → stop → idle", async ({ page }) => {
  await page.goto("/");

  // --- idle ---------------------------------------------------------------
  const startButton = page.getByRole("button", { name: "START FIRING" });
  await expect(startButton).toBeVisible();

  // --- start --------------------------------------------------------------
  await startButton.click();

  // The active view shows the firing header and a STOP control.
  await expect(page.getByText(/FIRING #\d+ · ACTIVE/)).toBeVisible();
  const stopButton = page.getByRole("button", { name: "stop firing" });
  await expect(stopButton).toBeVisible();

  // --- live temperature climbs -------------------------------------------
  // Mock ramp starts at 70°F and climbs ~1.3°F/s. Reaching >80 proves the
  // SSE stream delivered several samples and the UI reduced them.
  await expect
    .poll(
      async () => {
        const text = (await page.locator(".hero__num").textContent()) ?? "";
        const n = Number(text.trim());
        return Number.isFinite(n) ? n : 0;
      },
      { timeout: 25_000, message: "hero temperature should climb past 80°F" },
    )
    .toBeGreaterThan(80);

  // --- stop ---------------------------------------------------------------
  await stopButton.click();
  await expect(page.getByRole("button", { name: "START FIRING" })).toBeVisible();
});
```

- [ ] **Step 2: Run the suite locally**

Run: `cd web/frontend && bun run e2e`
Expected: 1 test passes. Playwright boots both servers, runs Chromium headless, tears down. Total wall time ~15-30s (most of it the temp-climb poll).

If the climb assertion times out: confirm the backend mock sensor is publishing — `curl http://localhost:5001/api/state` a few seconds after a manual START should show `latest_sample` advancing. If the servers don't boot, check the `webServer` commands resolve from `web/frontend/` as cwd.

- [ ] **Step 3: Commit**

```bash
git add web/frontend/tests/e2e/dashboard.spec.ts
git commit -m "test(web): Playwright e2e for the firing flow"
```

---

## Task 3: Makefile target

**Files:**
- Modify: `web/frontend/Makefile.include`
- Modify: `Makefile`

- [ ] **Step 1: Add an e2e target to `web/frontend/Makefile.include`**

Append:

```make
web-frontend-e2e:
	cd $(WEB_FRONTEND_DIR) && bun run e2e
```

And add `web-frontend-e2e` to the `.PHONY` line in that file.

- [ ] **Step 2: Add a top-level `e2e` target to `Makefile`**

Add `e2e` to the `.PHONY` list, add a help line, and add the target:

```make
e2e: web-frontend-e2e
```

Help line (under the `dev` line):

```make
	@echo "  e2e       run Playwright end-to-end tests (boots both servers)"
```

- [ ] **Step 3: Verify**

Run: `make e2e`
Expected: same result as Task 2 Step 2 — 1 test passes.

- [ ] **Step 4: Commit**

```bash
git add Makefile web/frontend/Makefile.include
git commit -m "build(web): make e2e target"
```

---

## Task 4: CI job

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add an `e2e` job to `.github/workflows/ci.yml`**

Append this job under `jobs:` (sibling to `shared`):

```yaml
  e2e:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v6

      - name: Set up Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version-file: .bun-version

      - name: Set up Python
        uses: actions/setup-python@v6
        with:
          python-version-file: .python-version

      - name: Install uv
        uses: astral-sh/setup-uv@v7
        with:
          enable-cache: true

      - name: Install workspace deps
        run: make build

      - name: Install Playwright Chromium
        run: cd web/frontend && bunx playwright install --with-deps chromium

      - name: Run E2E
        run: make e2e

      - name: Upload Playwright report on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: web/frontend/playwright-report/
          retention-days: 7
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci(web): run Playwright e2e on every PR"
```

---

## Task 5: Verify end-to-end

**Files:** none — verification only.

- [ ] **Step 1: Cold-start the full gate**

```bash
make build && make codegen && make lint && make test && make e2e
```
Expected: all green; `git status` clean.

- [ ] **Step 2: Confirm `make test` did NOT run the browser**

`make test` output should show only the shared + backend pytest/bun suites — no Chromium boot, no `webServer` lines. (E2E is `make e2e`, separate by design.)

- [ ] **Step 3: Negative check — the test actually tests something**

Temporarily break the frontend: in `web/frontend/src/views/idle-screen.tsx`, change the button label `"START FIRING"` to `"START"`. Run `make e2e`. Expected: the test FAILS at the first `getByRole("button", { name: "START FIRING" })` assertion. Revert the change; re-run; expect PASS.

This proves the test is wired to real UI, not vacuously green.

- [ ] **Step 4: Done — no commit.**

After the PR is pushed, confirm the new `CI / e2e` job appears and passes on the PR.

---

## Self-review checklist

- [ ] Every file in File Structure has a creating or modifying task.
- [ ] No "TBD"/"TODO"/"implement later" in any task body.
- [ ] `make test` is unchanged — e2e is reachable only via `make e2e` / the CI `e2e` job.
- [ ] CI `e2e` job installs the Chromium binary (`bunx playwright install --with-deps chromium`) — the npm package alone cannot launch a browser.
- [ ] `playwright.config.ts` `webServer` commands resolve correctly from `web/frontend/` as cwd (`cd ../backend && …` for Flask, `bun run dev` for Vite).
- [ ] `playwright-report/` and `test-results/` are git-ignored.
- [ ] The climb assertion (`> 80°F`, 25s timeout) is justified by the mock ramp rate (~1.3°F/s from 70°F) with comfortable margin.
- [ ] Task 5 Step 3 negative-check confirms the test is not vacuously passing.
- [ ] `actions/upload-artifact` captures the Playwright report on CI failure for debugging.

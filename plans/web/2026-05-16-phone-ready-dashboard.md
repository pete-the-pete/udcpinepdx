# Phone-Ready Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **First execution step:** promote this file to
> `plans/web/2026-05-16-phone-ready-dashboard.md` and commit it.

## Context

The dashboard is reachable only at `localhost:5173` — the laptop's own
loopback — so a phone on the same wifi can't load it at all. And the layout is
a fixed 1024×600 kiosk design; even once reachable it would render as a
zoomed-out box on a phone.

This is **Plan A of two** for the design doc's Product 2 ("phone as second
screen"). Plan A makes the dashboard *reachable and shaped right* on a phone.
Plan B (separate, later) adds QR pairing + cookie auth so it's *secure*.

Deliberately **no auth in Plan A.** For the duration between A and B, anyone on
the home wifi could hit start/stop on the (mock) oven. Pete has accepted this
gap; the oven is simulated and the network is a home LAN.

**Goal:** Open the dashboard on a phone over the home wifi and have it render as a proper portrait layout — idle screen and active firing view both — with the live firing flow working exactly as on the kiosk.

**Architecture:** Two changes. (1) Vite's dev server binds all network interfaces (`server.host`), so the phone reaches it at `http://<laptop-LAN-IP>:5173`; the `/api` proxy and SSE still terminate on the laptop, so Flask stays loopback-only and unexposed. (2) The frontend gets a real responsive layout — the `index.html` viewport switches from a hardcoded `width=1024` to `width=device-width`, and `styles.css` gains a portrait breakpoint that reflows the idle screen and the Hero Number active view for narrow screens. No backend changes. No new runtime dependency.

**Tech Stack:** Vite dev-server config, plain CSS media queries, Playwright (existing) gains a mobile-viewport project.

---

## Conscious decisions

1. **No auth in Plan A** — see Context. Plan B owns it.
2. **One viewport, `width=device-width`, serves both kiosk and phone.** The kiosk's 1024×600 display reports 1024 CSS px, so the existing desktop layout still applies there; the phone gets the portrait breakpoint. No per-device viewport hacks.
3. **CSS media query, not a separate phone component tree.** The idle screen and Hero Number are simple enough that one set of components with a `@media (max-width: 640px)` block is cleaner than forking `<PhoneHeroNumber>` etc. Container queries would be more modern but media queries on viewport width are sufficient and universally supported.
4. **Vite `server.host: true`, not a hardcoded IP.** Vite then binds `0.0.0.0` and prints the LAN URL on startup. Pete reads the `Network:` line from the `make dev` output — no IP baked into config (it changes with networks).
5. **Playwright gets a mobile project running the existing spec.** The full firing flow must pass at phone size too — that's the real proof the portrait layout works, not just a screenshot. Roughly doubles the e2e job runtime (~1 → ~2 min); acceptable.
6. **`make dev` already exposes the LAN URL** once Vite binds `0.0.0.0` — Vite prints `Network: http://…`. No Makefile change needed for discovery.

## Out of scope (Plan B and beyond)

- QR pairing, tokens, cookie auth, `/pair` page — Plan B.
- mDNS / `pizza.local` — Pi-deployment concern (`plans/ops/`).
- Exposing Flask directly — never needed; Vite proxies.
- Production HTTPS — Pi-deployment concern.

---

## File structure

```
udcpinepdx/
├── plans/web/2026-05-16-phone-ready-dashboard.md   (NEW — promoted from the plan-mode scratch file)
├── web/frontend/
│   ├── vite.config.ts                              (MODIFY — server.host: true)
│   ├── index.html                                  (MODIFY — viewport width=device-width)
│   ├── playwright.config.ts                        (MODIFY — add mobile-chromium project)
│   ├── src/
│   │   └── styles.css                              (MODIFY — portrait @media breakpoint)
│   └── tests/e2e/
│       └── dashboard.spec.ts                       (unchanged — runs under both projects)
```

No `.tsx` changes expected — the reflow is pure CSS. If a structural change
turns out necessary (e.g. the status header genuinely cannot reflow with CSS
alone), that is flagged in Task 3 with the specific component and reason.

---

## Task 1: Promote the plan + LAN access

**Files:**
- Create: `plans/web/2026-05-16-phone-ready-dashboard.md`
- Modify: `web/frontend/vite.config.ts`
- Modify: `web/frontend/index.html`

- [ ] **Step 1: Promote this plan**

Copy this file's contents to `plans/web/2026-05-16-phone-ready-dashboard.md`.

- [ ] **Step 2: Bind Vite to all interfaces**

In `web/frontend/vite.config.ts`, change the `server` block so `host` is set:

```typescript
import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

export default defineConfig({
  plugins: [preact()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:5001",
    },
  },
});
```

`host: true` binds `0.0.0.0`; Vite then prints a `Network:` URL on startup.
The `/api` proxy target stays `127.0.0.1:5001` — the proxy runs on the laptop,
so Flask stays loopback-only and is never exposed to the LAN.

- [ ] **Step 3: Fix the viewport meta**

In `web/frontend/index.html`, change:

```html
<meta name="viewport" content="width=1024, initial-scale=1" />
```

to:

```html
<meta name="viewport" content="width=device-width, initial-scale=1" />
```

The hardcoded `width=1024` forced phones to render the kiosk layout zoomed
out. `width=device-width` lets the phone report its true CSS width (~390px)
so the portrait breakpoint in Task 2 can take effect. The kiosk's 1024-wide
display still reports 1024, so its layout is unaffected.

- [ ] **Step 4: Verify LAN reachability**

Run: `make dev`. In the Vite output, note the `Network:` line, e.g.
`Network: http://192.168.1.42:5173/`.

From a phone on the same wifi, open that URL. Expected: the dashboard loads
(it will still look like a shrunk kiosk — the portrait layout lands in the
next tasks). Confirm START/STOP work and the temperature streams. Then stop
`make dev`.

If the phone can't connect: confirm the laptop firewall allows inbound on
5173, and that the phone and laptop are on the same network (not a guest
VLAN).

- [ ] **Step 5: Commit**

```bash
git add plans/web/2026-05-16-phone-ready-dashboard.md web/frontend/vite.config.ts web/frontend/index.html
git commit -m "feat(web): bind Vite to LAN + device-width viewport"
```

---

## Task 2: Portrait breakpoint — shared shell + idle screen

**Files:**
- Modify: `web/frontend/src/styles.css`

The current `styles.css` targets the 1024×600 kiosk. We add a single
`@media (max-width: 640px)` block at the end of the file that overrides only
what needs to change for portrait phones. The desktop rules are the default;
the media block is the phone.

- [ ] **Step 1: Append the portrait breakpoint — shell + idle**

Add to the end of `web/frontend/src/styles.css`:

```css
/* ---- Portrait phones ------------------------------------------------- */
@media (max-width: 640px) {
  .hero {
    width: 100vw;
    padding: 0 20px;
    grid-template-rows: auto 1fr auto;
  }

  /* Status header: let the firing-id text and the live/stop cluster
     stack instead of colliding on a narrow row. */
  .hero__status {
    padding-top: 24px;
    font-size: 12px;
    flex-wrap: wrap;
    gap: 8px;
  }

  /* Idle screen: the kiosk button is 42px text + 56px padding — far too
     wide for ~390px. Scale it down to a comfortable phone tap target. */
  .idle__start {
    padding: 22px 36px;
    font-size: 28px;
    letter-spacing: 4px;
  }
  .idle__caption {
    font-size: 12px;
    letter-spacing: 3px;
  }
}
```

- [ ] **Step 2: Visual check — idle at phone size**

Run `make dev`. In a desktop browser, open DevTools device-emulation at
390×844 (iPhone-ish) and load `http://localhost:5173/`.

Expected: "OVEN · IDLE" header fits without overflow; the START FIRING button
fits within the screen width with comfortable margins; nothing is clipped or
horizontally scrolling.

- [ ] **Step 3: Commit**

```bash
git add web/frontend/src/styles.css
git commit -m "feat(web): portrait breakpoint for shell + idle screen"
```

---

## Task 3: Portrait breakpoint — Hero Number active view

**Files:**
- Modify: `web/frontend/src/styles.css`

- [ ] **Step 1: Extend the portrait breakpoint with the active-view rules**

Inside the same `@media (max-width: 640px)` block (append before its closing
brace):

```css
  /* Active view: the hearth number is clamp(180px,28vw,280px) — on a
     ~390px screen 28vw≈109px so it pins to the 180px floor, which is
     fine, but the unit/label spacing needs tightening. */
  .hero__num {
    font-size: clamp(140px, 40vw, 200px);
    letter-spacing: -4px;
  }
  .hero__unit {
    font-size: 16px;
    letter-spacing: 4px;
  }

  /* The right-side cluster (LIVE + STOP) sits below the firing id when
     the header wraps; keep it tidy. */
  .hero__right {
    gap: 12px;
  }
  .hero__stop {
    padding: 8px 16px;
  }
}
```

- [ ] **Step 2: Visual check — active firing at phone size**

With `make dev` running and DevTools at 390×844: load `localhost:5173/`,
click START FIRING.

Expected: the firing-id line and the LIVE/STOP cluster both fit (wrapping to
two rows is fine); the big temperature number is large but fully on-screen
with no horizontal scroll; "DEGREES FAHRENHEIT" sits centered beneath it.
Watch the number climb. Click STOP — returns to a correct idle layout.

If the header still collides at 390px, the CSS reflow was insufficient — in
that case (and only then) split `hero__status` in `hero-number.tsx` so the
id and the live/stop cluster are separate flex rows, and note it in the
commit message.

- [ ] **Step 3: Commit**

```bash
git add web/frontend/src/styles.css
git commit -m "feat(web): portrait breakpoint for Hero Number active view"
```

---

## Task 4: Playwright mobile-viewport coverage

**Files:**
- Modify: `web/frontend/playwright.config.ts`

- [ ] **Step 1: Add a mobile project**

In `web/frontend/playwright.config.ts`, change the `projects` array from:

```typescript
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
```

to:

```typescript
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
```

`devices["Pixel 7"]` is a portrait phone viewport (~412×915) with a mobile
user-agent. The existing `dashboard.spec.ts` (idle → start → temp climbs →
stop) now runs under both projects — proving the full firing flow works at
phone size, not just that a screenshot looked right.

- [ ] **Step 2: Run the suite**

Run: `make e2e`
Expected: 2 passed — the same spec under `chromium` and `mobile-chromium`.

If the mobile run fails on an element not being visible/clickable, the
portrait CSS from Tasks 2–3 left something off-screen; fix the CSS, not the
test.

- [ ] **Step 3: Commit**

```bash
git add web/frontend/playwright.config.ts
git commit -m "test(web): run the e2e firing flow at phone viewport"
```

---

## Task 5: End-to-end verification

**Files:** none — verification only.

- [ ] **Step 1: Full local gate**

```bash
make build && make codegen && make lint && make test && make e2e
```
Expected: all green; `git status` clean. `make e2e` shows 2 passing
(desktop + mobile).

- [ ] **Step 2: Capture phone-size screenshots for review**

With `make dev` running, use Playwright (or DevTools device mode) to capture
the idle screen and an active firing at 390×844, and review them — the
portrait layout should look intentional, not a squeezed kiosk.

- [ ] **Step 3: Real-device check**

From an actual phone on the home wifi, open the `Network:` URL from the Vite
output. Walk the flow: idle screen renders correctly → tap START FIRING →
temperature climbs live → tap STOP → back to idle. Confirm no horizontal
scrolling and tap targets are comfortable.

- [ ] **Step 4: Done — no commit.**

After the PR is pushed, confirm CI's `e2e` job runs both projects and passes.

---

## Self-review checklist

- [ ] Every file in File Structure has a creating or modifying task.
- [ ] No "TBD"/"TODO"/"implement later" in any task body.
- [ ] No auth work crept in — that is explicitly Plan B.
- [ ] `vite.config.ts` keeps the `/api` proxy target as `127.0.0.1:5001`; Flask is never bound to the LAN.
- [ ] The viewport change is `width=device-width` (not a second hardcoded width); the kiosk layout is verified unaffected.
- [ ] The portrait rules live in one `@media (max-width: 640px)` block; desktop/kiosk rules remain the default.
- [ ] Playwright runs the existing spec under both desktop and mobile projects.
- [ ] Verification includes a real phone, not just emulation.
- [ ] CLAUDE.md workflow respected: completion is push + PR; no destructive GitHub writes.

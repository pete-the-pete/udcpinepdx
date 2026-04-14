# Project Bootstrap — UDC Pine PDX (Chiminea Pizza Oven Door)

## Context

This is the very first session for a brand-new project: a custom insulated door
for a wood-fired chiminea pizza oven, instrumented with a Raspberry Pi for
temperature logging, a stopwatch display, session upload to a web backend, and
(stretch) an inward camera. This repository is focused on the software side
(firmware, backend, web, shared schemas, ops); the physical door build lives in
`plans/hardware/` as documentation rather than code.

The user wants this project to also be a vehicle for learning:
1. Autonomous Claude workflows
2. Raspberry Pi + home electronics (display, Wi-Fi, multi-device comms)
3. Security and access
4. End-to-end type safety (DB → API → frontend)
5. Customizing Claude Code (skills, hooks, token/efficiency measurement)
6. GitHub to its full potential (Actions, branch protection, issues, releases)

**Scope of THIS plan:** Just bootstrap the repo. No application code yet.
Downstream subsystems (hardware, firmware, backend, web, shared types, ops) each
get their own focused plan written later into `plans/<subsystem>/`. Deciding
*that* structure now is the main job of this first session.

**User decisions already captured (2026-04-13):**
- **Plans convention:** Only promoted, user-approved plans live in the project,
  at `./plans/<subsystem>/YYYY-MM-DD-<slug>.md` (or `./plans/YYYY-MM-DD-<slug>.md`
  for cross-cutting plans like this one). Plan mode's in-progress scratch
  buffer continues to live at `~/.claude/plans/<slug>.md` — that's Claude
  Code's hardcoded behavior and it is not reasonably reconfigurable (verified:
  no setting, no dedicated hook event). We explicitly rejected hook-based
  mirroring and symlink workarounds as more trouble than they're worth. The
  scratch buffer is treated as session-ephemeral and never committed anywhere;
  `./plans/` is the sole source of truth for approved plans. Nothing plan-
  related lives under `.claude/` **in the project tree**.
- **Repo shape:** Monorepo with workspaces.
- **GitHub:** Create a public remote at the end of bootstrap.
- **Tech direction:** TypeScript end-to-end for backend + web via tRPC, Python
  on the Pi for firmware. No TypeScript runs on the Pi itself — the Pi is
  pure Python, driving hardware locally and pushing JSON to the backend over
  HTTPS or MQTT (MQTT vs HTTPS decided in `plans/firmware/`). The Pi has NO
  local webserver; the OLED/LCD is the local UI.
- **Type-safety bridge (the interesting part):** A single JSON Schema source
  of truth lives in `plans/shared/` (filename + location TBD in that plan).
  Codegen produces Zod schemas for the TypeScript side (consumed by both
  backend tRPC routes and web clients) and Pydantic models for the Python
  side (consumed by the Pi firmware for both outgoing-payload construction
  and incoming-command validation). Both sides runtime-validate every message
  against the same contract. This is how "end-to-end type safety" (learning
  goal 4) extends across the Python/TS boundary without running Node on the
  Pi. The `plans/shared/` plan owns picking the specific codegen tools
  (options to weigh: `json-schema-to-zod` / `zod-to-json-schema`,
  `datamodel-code-generator` for Pydantic, or a single-source-of-truth tool
  like `quicktype`).
- Stack details (package manager, web framework, backend framework, exact
  codegen toolchain) are finalized in the `plans/shared/` plan. Bootstrap
  does not install any dependencies or commit any source code.

---

## What Gets Created

All paths are relative to `/Users/pete/workspace/personal/udcpinepdx`.

| Path | Purpose |
|---|---|
| `.git/` | `git init` result |
| `.gitignore` | Node + Python + OS + env + Pi artifacts |
| `README.md` | Project elevator pitch, learning goals, deadline, status |
| `CLAUDE.md` | Project conventions Claude should follow in every future session |
| `plans/README.md` | Explains the sub-dir convention and how to pick one |
| `plans/2026-04-13-bootstrap.md` | This plan, promoted from `~/.claude/plans/fluttering-sprouting-bear.md` as the first committed plan |
| `plans/hardware/.gitkeep` | Door construction, materials, fitment |
| `plans/firmware/.gitkeep` | Pi OS image, display driver, sensor sampling, local UI |
| `plans/backend/.gitkeep` | API, DB schema, auth, session ingestion |
| `plans/web/.gitkeep` | Dashboard, session viewer, live session stream |
| `plans/shared/.gitkeep` | Zod schemas, tRPC contract, versioning |
| `plans/ops/.gitkeep` | GitHub Actions, branch protection, secrets, deploys |

**Important:** There is NO `.claude/plans/` inside this repo. The only
`.claude/`-related file that may eventually land in the repo is
`.claude/settings.json` (project-level Claude Code config, added in a later
plan). All plan documents live at `./plans/...`.

**Not in this plan:** `package.json`, workspace config, any source code, any
dependency install, any Pi imaging. Those belong in the subsystem plans.

---

## File Content Specs

### `.gitignore`
Cover: `node_modules/`, `dist/`, `build/`, `.next/`, `coverage/`, `.turbo/`,
`.pnpm-store/`, `__pycache__/`, `*.pyc`, `.venv/`, `venv/`, `.pytest_cache/`,
`*.egg-info/`, `.env`, `.env.*`, `!.env.example`, `.DS_Store`, `Thumbs.db`,
`*.log`, `.idea/`, `.vscode/` (keep `.vscode/extensions.json` if added later),
`*.img`, `*.iso` (Pi images), `secrets/`, `.claude/settings.local.json`.

### `README.md`
Sections:
- One-paragraph project pitch (chiminea door + instrumentation).
- Status: "bootstrap" (update as subsystems come online).
- Learning goals (the 6 numbered above).
- Repo map — points at `plans/` and notes that code directories don't exist yet.
- Pointer to `CLAUDE.md` for contributors / future Claude sessions.

### `CLAUDE.md` (project-level)
This is the single highest-leverage file in the bootstrap. It must tell future
Claude sessions:

1. **Project summary** — 2 sentences on the chiminea door + instrumentation.
2. **Plans convention** — when entering plan mode or writing a plan, save to
   `plans/<subsystem>/YYYY-MM-DD-<slug>.md` where subsystem is one of
   `hardware | firmware | backend | web | shared | ops`. If a task spans
   multiple subsystems, write a top-level `plans/YYYY-MM-DD-<slug>.md` that
   indexes per-subsystem child plans.
3. **Tech stack commitments** — TS end-to-end monorepo for backend + web
   (package manager TBD in `plans/shared/`), tRPC + Zod for the type-safety
   spine between backend and web, Python on the Pi (no Node on the Pi), and a
   JSON-Schema-based codegen pipeline in `plans/shared/` that emits both Zod
   (for TS) and Pydantic (for Python) from a single source of truth. Pi
   pushes JSON to the backend over HTTPS or MQTT (decided in `plans/firmware/`)
   and has no local webserver. DB choice (SQLite vs Postgres) TBD in
   `plans/backend/`.
4. **Learning posture** — explicitly list the 6 learning goals so Claude
   tailors explanations (e.g., explain *why* a security decision matters,
   surface token-cost tradeoffs, prefer teaching over hand-waving).
5. **Safety rail** — no code, no dependency installs, no GitHub writes
   without an approved plan from `plans/`.
6. **What NOT to put here** — per `ce:configuring-claude` guidance, keep it
   concise; push long-form context into per-subsystem CLAUDE.md files as
   those directories get created.

### `plans/README.md`
- **Headline rule:** All approved plan documents for this project live in
  `./plans/` at the repo root. Never in `.claude/plans/`.
- Table mapping subsystem → responsibility (same columns as above).
- Filename format: `YYYY-MM-DD-<kebab-slug>.md` inside the matching sub-dir,
  or at `plans/` top level if the plan is cross-cutting (bootstrap, migrations
  that touch every workspace, etc.).
- **Lifecycle note:** Claude Code's plan mode writes an in-progress scratch
  buffer at `~/.claude/plans/<random-slug>.md` while a plan is being drafted.
  That path is hardcoded by Claude Code and cannot be redirected into the
  project. Treat the scratch buffer as session-ephemeral. Once the user
  approves a plan in plan mode, copy its contents into
  `./plans/<sub>/YYYY-MM-DD-<slug>.md` (or `./plans/YYYY-MM-DD-<slug>.md` for
  cross-cutting plans) as the very first post-approval step and commit it.
  The scratch file is never referenced again, never committed, and never
  symlinked into the project.

### `.gitkeep` files
Empty files so the empty directories get tracked.

---

## Execution Steps (for when plan mode exits)

1. `cd /Users/pete/workspace/personal/udcpinepdx && git init -b main`
2. Create `.gitignore`, `README.md`, `CLAUDE.md`, `plans/README.md` (Write tool).
3. Create the six `plans/{hardware,firmware,backend,web,shared,ops}/.gitkeep`
   files in parallel.
4. **Promote this plan file** — Read
   `/Users/pete/.claude/plans/fluttering-sprouting-bear.md` and Write it to
   `plans/2026-04-13-bootstrap.md`. Use Read + Write (not shell `cp`) so the
   copy appears in the normal edit audit trail. Leave the scratch file where
   it is — it's ephemeral by design and not our concern after this point.
5. `git add -A && git status` — confirm the staged tree contains ONLY:
   `.gitignore`, `README.md`, `CLAUDE.md`, `plans/README.md`,
   `plans/2026-04-13-bootstrap.md`, and the six `.gitkeep` files. Nothing
   under `.claude/`. If anything else appears, stop and investigate.
6. Initial commit: `chore: bootstrap repo scaffold and plans convention`
   (Co-Authored-By footer per the user's standard commit policy — do NOT skip
   hooks; there are no hooks yet).
7. `gh repo create udcpinepdx --public --source=. --remote=origin --push` —
   **pause and confirm with user before running**, since this is an external,
   visible side effect (per "Executing actions with care" guidance).
8. Verify remote: `gh repo view --web` (or print the URL).

---

## Follow-up Plans to Write Next (not part of this plan)

In rough dependency order — each one is its own plan mode session once this
bootstrap is merged:

1. **`plans/shared/`** — Pick package manager (pnpm vs bun), workspace layout,
   Zod schema package skeleton, tRPC contract location, AND the JSON-Schema →
   Zod + Pydantic codegen pipeline (pick tools, wire into CI, define
   "single source of truth" storage layout). This is now the keystone plan —
   everything downstream depends on it because it defines the type boundary
   between the Pi and the TS services.
2. **`plans/hardware/`** — Materials (ceramic fiber board vs alternatives),
   templating the half-moon shape, cutting/assembly, mounting strategy, sensor
   + display pass-throughs.
3. **`plans/firmware/`** — Pi model + OS image, Python version + virtualenv
   strategy, thermocouple choice + wiring, OLED/LCD driver, local stopwatch
   UI (on the physical display, not a webserver), Wi-Fi provisioning,
   HTTPS-vs-MQTT decision for uplink, session upload loop, offline buffering,
   how the Pydantic models generated by `plans/shared/` get consumed.
4. **`plans/backend/`** — DB (SQLite for v1, Postgres later?), session ingest
   endpoint, auth (per learning goal 3 — probably passkeys or OAuth, decided
   in that plan), tRPC router layout.
5. **`plans/web/`** — Framework (Next.js app router likely), live session view,
   history, auth UI, mobile-friendly layout.
6. **`plans/ops/`** — GitHub Actions CI matrix, branch protection, Dependabot,
   CodeQL, release tagging, secrets management, deploy target.

`plans/hardware/` is documentation of the physical build rather than code, so
it can be written whenever is convenient — it does not block software work.

---

## Verification

End-to-end check that bootstrap succeeded:

- [ ] `git -C /Users/pete/workspace/personal/udcpinepdx log --oneline` shows
      exactly one commit with the bootstrap message.
- [ ] `git -C … ls-files` lists only: `.gitignore`, `README.md`, `CLAUDE.md`,
      `plans/README.md`, `plans/2026-04-13-bootstrap.md`, and the six
      `.gitkeep` files. Nothing under `.claude/`.
- [ ] `gh repo view udcpinepdx` returns a live URL and confirms `main`
      contains the bootstrap commit.
- [ ] Open a fresh Claude Code session in this directory; confirm the project
      `CLAUDE.md` is loaded (the plans convention should appear in context).
- [ ] Start plan mode on a throwaway task like "plan the hardware door
      materials selection" — confirm Claude announces that upon approval the
      plan will be promoted to `plans/hardware/YYYY-MM-DD-<slug>.md`. (The
      in-progress scratch buffer will still be at `~/.claude/plans/<slug>.md`
      — that's expected, not a regression.)

The last two checks are the real proof that the CLAUDE.md convention works;
the first three are mechanical.

---

## Open Questions Deferred to Later Plans

- pnpm vs bun vs npm workspaces → `plans/shared/`
- Auth strategy → `plans/backend/`
- DB choice → `plans/backend/`
- Pi model (Zero 2 W? Pi 4? Pi 5?) → `plans/firmware/`
- Display model (which 8x8-ish LCD/OLED) → `plans/firmware/`
- License for the repo → `plans/ops/` (default MIT unless user says otherwise)
- Public vs private GitHub — user chose public; reconfirm at step 6 before push.

# CLAUDE.md — udcpinepdx project instructions

This file is loaded into every Claude Code session run inside this repository.
It is the contract for how work happens here. Keep it terse — push long-form
context into per-subsystem `CLAUDE.md` files as those directories get created.

## Project summary

Software for a custom, instrumented, insulated door on a wood-fired chiminea
pizza oven. A Raspberry Pi drives a local display + thermocouple + (stretch)
camera, uploads session data to a TypeScript backend, and a web dashboard
shows live and historical sessions.

## Plans convention

Every non-trivial change starts with an approved plan in `./plans/`.

- **Committed plans live here:** `./plans/<subsystem>/YYYY-MM-DD-<slug>.md`
  where `<subsystem>` is one of `hardware | firmware | backend | web | shared | ops`.
- **Cross-cutting plans** (touch multiple subsystems, or bootstrap-style work)
  go at `./plans/YYYY-MM-DD-<slug>.md` at the top of the plans directory.
- **Filename format:** `YYYY-MM-DD-<kebab-slug>.md`. Date is when the plan
  was first drafted, not when it was executed.
- **Never** write plan documents under `.claude/` inside this repo. Nothing
  plan-related lives in `.claude/` in the project tree.

### Plan mode lifecycle

Claude Code's plan mode writes an in-progress scratch buffer at
`~/.claude/plans/<random-slug>.md` while a plan is being drafted. That path
is hardcoded by Claude Code and is **not** reconfigurable. Treat it as
session-ephemeral — never commit it, never symlink it, never reference it
again once the plan is approved.

When a plan is approved in plan mode, the **first** post-approval execution
step is always: Read the scratch file, Write its contents to
`./plans/<sub>/YYYY-MM-DD-<slug>.md` (or `./plans/YYYY-MM-DD-<slug>.md` if
cross-cutting), and include that promoted file in the same commit as
whatever other changes the plan produced (or in its own commit if the plan
has no code deliverable).

## Tech stack commitments

These are locked in as of the bootstrap plan. Changes require a plan in
`plans/shared/` or `plans/ops/`.

- **Monorepo**, TypeScript workspaces. Package manager (pnpm vs bun vs npm)
  chosen in the `plans/shared/` plan.
- **Backend and web:** TypeScript, **tRPC + Zod** as the type-safety spine.
- **Pi firmware:** **Python only.** No Node.js on the Pi. No local webserver
  on the Pi — the physical OLED/LCD is the local UI, and the Pi talks to the
  backend over HTTPS or MQTT (decision deferred to `plans/firmware/`).
- **Cross-language type safety:** A single JSON Schema source of truth in
  `shared/` generates **Zod** schemas for TypeScript and **Pydantic** models
  for Python. Both sides runtime-validate every wire message against the same
  contract. The exact codegen toolchain (`json-schema-to-zod`,
  `datamodel-code-generator`, `quicktype`, etc.) is chosen in `plans/shared/`.
- **Database:** TBD in `plans/backend/` (default lean: SQLite for v1).
- **Auth:** TBD in `plans/backend/`.

## Learning posture

This project is explicitly a learning vehicle. When a decision is close to
a wash, favor the option that teaches more. The six goals are:

1. Autonomous Claude workflows.
2. Raspberry Pi and home electronics.
3. Security and access.
4. End-to-end type safety across database → API → frontend → firmware.
5. Customizing Claude Code — skills, hooks, measuring and minimizing tokens.
6. GitHub to its full potential.

**Practical implication for Claude:** explain the *why* behind non-obvious
choices (especially around security, type safety, and token economy). When
surfacing tradeoffs, say which one teaches Pete more. Prefer teaching
explanations over hand-waving.

## Safety rails

- **No code without an approved plan.** If a request would add or change
  source code, firmware, dependencies, DB schemas, or GitHub settings, and
  there is no matching approved plan in `./plans/`, enter plan mode first.
- **No dependency installs without a plan.** `npm install`, `pnpm add`,
  `pip install`, `uv add`, `apt install`, `brew install` — all gated.
- **No GitHub writes without explicit user confirmation in-session.**
  That includes `gh repo create`, force pushes, branch protection edits,
  secrets edits, comment/issue creation.
- **Never skip hooks** (`--no-verify`, `--no-gpg-sign`). Fix the underlying
  issue.

## What NOT to put in this file

Per `ce:configuring-claude`, keep CLAUDE.md concise. Do not inline:

- Code patterns, file paths, or architecture details derivable from reading
  the code.
- Per-subsystem conventions — those go in `firmware/CLAUDE.md`,
  `backend/CLAUDE.md`, etc. as each subsystem is created.
- Task state or in-progress context — that belongs in plans or session tasks.

# CLAUDE.md — udcpinepdx project instructions

## Project summary

Software for a custom, instrumented, insulated door on a wood-fired chiminea
pizza oven. A Raspberry Pi drives a local display + thermocouple +
camera, uploads session data and displays a web dashboard
that shows live and historical sessions.

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

## Workflow completion

When all tasks in a plan are complete and tests + lint pass, the **default
completion is push + PR** on the feature branch. Don't offer the
finishing-a-development-branch 4-option menu — just push and open the PR
with `gh pr create`, include a brief summary + test plan in the body, and
report the URL.

Skip the default and stop to ask when:

- Tests or lint are still failing. Report; don't push.
- The user has explicitly indicated a different end-state this session
  ("keep the branch, I'll handle it later", etc.).
- The branch contains anything destructive or out-of-scope that the user
  hasn't seen.

## GitHub Projects

Every issue and PR in this repo belongs on project board
`pete-the-pete/projects/4`. The `.github/workflows/add-to-project.yml`
workflow auto-adds new issues and PRs and sets initial Status (issues
→ Todo, PRs → In Progress). Do not add items manually with
`gh project item-add` — let the workflow do it, and confirm the item
appeared on the board after opening the issue/PR.

If the workflow fails (e.g. expired PAT), fix the underlying issue.
Don't paper over it with manual `gh project item-add` calls.

**PRs that execute a tracked issue must include `Closes #N` (or
`Fixes #N` / `Resolves #N`) in the PR body.** That's what populates
the board's "Linked pull requests" column, auto-closes the issue on
merge, and gives board → issue → PR → commit traceability. If a PR
isn't executing a specific tracked issue (e.g. drive-by fix), no
linkage is needed — but the moment work is ticket-scoped, the linkage
is mandatory.

## Safety rails

- **No code without an approved plan.** If a request would add or change
  source code, firmware, dependencies, DB schemas, or GitHub settings, and
  there is no matching approved plan in `./plans/`, enter plan mode first.
- **No dependency installs without a plan.** `npm install`, `pnpm add`,
  `pip install`, `uv add`, `apt install`, `brew install` — all gated.
- **GitHub writes require fresh confirmation only for destructive or
  administrative changes:** force-push, force-push to `main`, secrets
  edits, branch protection changes, `gh repo create`, deleting remote
  branches, closing/deleting issues or PRs not authored in this session.
  Routine `git push` and `gh pr create` on a feature branch follow the
  workflow above.
- **Never skip hooks** (`--no-verify`, `--no-gpg-sign`). Fix the underlying
  issue.

## What NOT to put in this file

Per `ce:configuring-claude`, keep CLAUDE.md concise. Do not inline:

- Code patterns, file paths, or architecture details derivable from reading
  the code.
- Per-subsystem conventions — those go in `firmware/CLAUDE.md`,
  `backend/CLAUDE.md`, etc. as each subsystem is created.
- Task state or in-progress context — that belongs in plans or session tasks.

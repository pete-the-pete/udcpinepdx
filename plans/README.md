# Plans

**Headline rule:** All approved plan documents for this project live in
`./plans/` at the repo root. **Never** in `.claude/plans/`. Nothing
plan-related lives under `.claude/` in the project tree.

## Layout

```
plans/
├── README.md              ← you are here
├── YYYY-MM-DD-<slug>.md   ← cross-cutting plans (bootstrap, multi-subsystem)
├── hardware/              ← physical door: materials, cutting, fitment
├── firmware/              ← Raspberry Pi Python code
├── backend/               ← TypeScript API, DB, auth, session ingestion
├── web/                   ← TypeScript frontend dashboard
├── shared/                ← JSON Schema + Zod/Pydantic codegen, workspace root
└── ops/                   ← GitHub Actions, branch protection, secrets, deploys
```

## Subsystem responsibilities

| Subsystem | Owns |
|---|---|
| `hardware/` | Door materials, half-moon templating, cut/assembly, mounting, sensor/display pass-throughs. Documentation, not code. |
| `firmware/` | Pi OS image, Python runtime, thermocouple wiring and driver, display driver, camera (if added), stopwatch local UI, Wi-Fi provisioning, session upload loop, offline buffering, Pydantic model consumption. |
| `backend/` | Database schema, session ingest endpoint, tRPC router, auth, API authorization. |
| `web/` | Dashboard framework choice, live session view, history, auth UI, mobile layout. |
| `shared/` | Monorepo workspace root, package manager choice, JSON Schema source of truth, codegen pipeline producing Zod (TS) and Pydantic (Python), tRPC contract location, versioning. |
| `ops/` | GitHub Actions CI, branch protection, Dependabot, CodeQL, release tagging, secrets management, deploy target. |

## Filename format

`YYYY-MM-DD-<kebab-slug>.md`

- The date is the day the plan was **first drafted**, not when it was
  executed. A plan can sit in `plans/` for a while before it gets built.
- Slugs are short and descriptive: `2026-04-20-thermocouple-driver.md`,
  not `2026-04-20-firmware-stuff.md`.
- Put the file in the subsystem directory that owns the work. If a plan
  truly spans multiple subsystems (a big refactor, a bootstrap, a
  cross-cutting security pass), put it at the top of `plans/` instead of
  picking one subsystem arbitrarily.

## Lifecycle: plan mode → committed plan

Claude Code's plan mode writes a scratch buffer at
`~/.claude/plans/<random-slug>.md` while a plan is being drafted. That path
is hardcoded by Claude Code and is **not** redirectable into the project.

Treat the scratch buffer as session-ephemeral:

1. Plan mode creates `~/.claude/plans/<random-slug>.md` — *do not touch
   this file outside of plan mode*.
2. User approves the plan (via `ExitPlanMode`).
3. **First post-approval step** is always to promote the plan: Read
   `~/.claude/plans/<slug>.md`, Write its contents to
   `./plans/<sub>/YYYY-MM-DD-<slug>.md` (pick a real slug, not the random
   one Claude Code generated), and commit it.
4. The scratch file is never referenced again, never committed, and never
   symlinked into the project.

See `CLAUDE.md` at the repo root for the full conventions.

## Status of each subsystem

| Subsystem | First plan | Status |
|---|---|---|
| bootstrap | `2026-04-13-bootstrap.md` | ✅ approved, executing |
| `shared/` | TBD | ⏳ next — keystone plan, unblocks everything else |
| `hardware/` | TBD | ⏳ documentation, can be written anytime |
| `firmware/` | TBD | ⏳ blocked on `shared/` |
| `backend/` | TBD | ⏳ blocked on `shared/` |
| `web/` | TBD | ⏳ blocked on `backend/` |
| `ops/` | TBD | ⏳ can run in parallel with any of the above once the repo has code |

# Agent-ready workflow

This repo follows **Pattern B with guardrails** for breaking plans into
tickets that an autonomous agent can claim and execute. The shape was
agreed in the 2026-05-25 workflow brainstorm; this document is the
operational reference.

## Roles

- **Plan** (`plans/<sub>/<date>-<slug>.md`) — narrative design doc. Always
  canonical. Contains the *why*, the file structure, the bite-sized steps.
- **Issue** — a projection of one phase of a plan into a unit of executable
  work. Lives on project 4. Closed by exactly one PR.
- **PR** — the implementation. Includes `Closes #N` for the issue it
  resolves.

A plan typically spawns one to four issues. If decomposition produces a
dependency chain, push back on the decomposition — that is a smell.

## Issue labels

| Label | Meaning |
|---|---|
| `agent-ready` | Spec is complete and the ticket is unblocked. An agent may claim. |
| `parallel-safe` | Safe to run concurrently with sibling `parallel-safe` tickets. |
| `needs-decision` | Blocked on Pete for a design or scope call. Agent must not claim. |
| `blocked` | Blocked on another ticket. Body declares the dependency. |
| `sub:<name>` | Subsystem the work belongs to (`firmware`, `backend`, `web`, `ops`, `shared`, `hardware`). |
| `type:<kind>` | Nature of the change (`feature`, `bug`, `chore`, `docs`, `plan`, `security`). |

## Claim rule

An agent (or you) may claim an issue if **all** are true:

1. It has the `agent-ready` label.
2. It has no assignee.
3. It has no `needs-decision` or `blocked` label.

On claim: assign yourself, move Status to "In Progress" (the
`add-to-project` workflow handles this when the PR opens), execute the
plan section it references, open a PR with `Closes #N`.

## Status lanes on project 4

| Status | Meaning |
|---|---|
| Todo | Issue exists but not yet `agent-ready` (still being spec'd, or deliberately deprioritized). |
| Ready | Issue is `agent-ready` and unclaimed. The pool an agent picks from. |
| In Progress | A PR is open against this issue. |
| Done | The PR merged. |

The `Ready` status is populated automatically by
`.github/workflows/add-to-project.yml` when the opening issue carries
the `agent-ready` label.

## Launching an agent (v1: manual)

For v1, agent launches are manual: open a fresh Claude Code session
(local or cloud), paste the issue URL, instruct it to read the plan
section the issue references and execute. The session reads the plan +
issue, claims the ticket per the rule above, opens the PR, and exits.

Future: a separate ops plan will add a GitHub Actions workflow that
spawns an agent when an issue receives the `agent-ready` label, so the
flow runs unattended. That plan is deliberately deferred until the
manual flow has been exercised against several real tickets.

## Merging

- **Squash only.** The repo has merge-commit and rebase-merge disabled.
- **Merge queue on `main`.** PRs join the queue rather than fast-forwarding;
  this serializes integration so two parallel-safe PRs can't desync `main`.
- **Closes #N is mandatory** for ticket-scoped PRs (already required by
  CLAUDE.md). The board's "Linked pull requests" column relies on it.

## When this workflow does not apply

Drive-by fixes, typo PRs, and plan documents themselves do not need to
follow the agent-ready ticket flow. Open a PR directly. The `Closes #N`
rule only kicks in when a tracked issue exists.

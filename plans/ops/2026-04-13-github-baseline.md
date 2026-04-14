# GitHub baseline: protections + project management

## Context

The bootstrap commit created `pete-the-pete/udcpinepdx` as a **private** repo
on GitHub Free, which blocks branch protection and rulesets entirely. The
bootstrap plan explicitly deferred all GitHub ops hardening to a
`plans/ops/` plan — this is that plan.

Pete's decisions (answered in plan mode):

- **Flip the repo to public.** Unlocks free branch protection, rulesets,
  CodeQL default setup, and secret scanning. Acceptable because the project
  is a pizza-oven controller with no proprietary IP.
- **Project management surface:** Issues + labels + milestones, plus a
  GitHub Projects (v2) board. No PR/issue templates, no CODEOWNERS for now.

Supports learning goals #3 (security/access), #5 (autonomous Claude
workflows via structured issues/labels), and #6 (GitHub to its full
potential).

---

## Why rulesets over classic branch protection

Rulesets are GitHub's newer, composable replacement for classic branch
protection. They can target multiple refs with glob patterns, stack on top
of each other, be enabled/disabled as a unit, and are fully manageable via
`gh api`. Classic branch protection is in maintenance mode. Using rulesets
here costs nothing extra and teaches the API Pete will actually see going
forward.

---

## Phase A — Pre-flip hygiene (repo is still private)

**Goal:** make sure nothing embarrassing or sensitive ships the moment the
repo goes public. This phase only modifies files in the working tree and
runs read-only `gh` audits.

1. **Secret scan of git history.** Run `gh secret list` (should be empty)
   and a local scan of every commit's diff for obvious patterns
   (`API_KEY`, `SECRET`, `TOKEN`, `PASSWORD`, `BEGIN .* PRIVATE KEY`,
   `.env`). The repo has only two commits today, so this is cheap.
   If anything turns up, stop and surface it before proceeding.

2. **Add `LICENSE`.** MIT, copyright Pete. A public repo with no LICENSE
   is implicitly "all rights reserved," which blocks the learning-project
   intent. MIT is the least surprising choice; confirm at execution time.

3. **Add `SECURITY.md`.** Short file at the repo root pointing would-be
   reporters at GitHub's private vulnerability reporting (enabled in
   Phase D). Three or four sentences. No SLA promises.

4. **Add `README.md` disclaimer block.** One paragraph at the top: this is
   a personal learning project for a custom pizza oven controller, no
   support, no warranty, expect breakage. (If a README already exists,
   edit in place; otherwise create a minimal one.)

5. **Add `.github/dependabot.yml`.** Three ecosystems:
   - `github-actions` weekly (covers any workflow we add later)
   - `pip` weekly, directory `/firmware` (Pi firmware is Python-only per
     CLAUDE.md — directory may not exist yet, that's fine, Dependabot will
     no-op until it does)
   - Placeholder commented-out entry for the TS package manager
     (`npm`/`pnpm`), to be uncommented by whichever `plans/shared/` plan
     picks the PM. Do not guess the PM here.

6. **Verify `.gitignore`** covers `.env`, `.env.*`, `*.pem`, `*.key`,
   `secrets/`, `__pycache__/`, `node_modules/`, `dist/`, `.DS_Store`.
   Add any missing entries.

7. **Commit Phase A as a single commit** on `main` with message
   `chore(ops): pre-public hygiene (license, security, dependabot)`.
   Do NOT push yet — Phase B does the push-and-flip atomically so there's
   no window where the repo is public without a license.

## Phase B — Flip to public

1. `gh repo edit pete-the-pete/udcpinepdx --visibility public --accept-visibility-change-consequences`
2. Push the Phase A commit: `git push origin main`
3. `gh repo view pete-the-pete/udcpinepdx --json visibility,licenseInfo` to
   confirm.

**Risky action.** This is irreversible for any commit already on the
remote at flip time — once public, those commits are archived by
third-party crawlers within minutes. Phase A's audit exists specifically
to make this safe. Require explicit user confirmation in-session before
running these two commands (per CLAUDE.md safety rails on GitHub writes).

## Phase C — Protect `main` with a ruleset

Create a ruleset named `main-branch-protection` via
`gh api -X POST /repos/pete-the-pete/udcpinepdx/rulesets` with:

- **Target:** `refs/heads/main` (exact include pattern)
- **Enforcement:** `active` (not `evaluate`)
- **Bypass actors:** empty — no bypass, even for Pete. Forces the PR flow
  as the only way to land code on `main`, which is the whole point.
- **Rules:**
  - `deletion` — block deleting the branch
  - `non_fast_forward` — block force pushes
  - `required_linear_history` — no merge commits (rebase/squash only)
  - `pull_request` with `required_approving_review_count: 0`,
    `dismiss_stale_reviews_on_push: true`,
    `require_code_owner_review: false`,
    `required_review_thread_resolution: true`.
    Zero reviewers is deliberate: Pete is solo, so requiring one review
    would make the ruleset unusable. The rule still forces work through a
    PR, which is what we want. If/when collaborators or autonomous agents
    enter the flow, bump this to 1.
  - ~~`required_signatures`~~ **dropped during execution.** The per-machine
    friction (every device that pushes to `main` needs its own SSH/GPG
    signing key registered under the GitHub account, forever) is real,
    the threat model on a solo personal repo is thin, and Pete's GitHub
    account is shared across personal + professional contexts where
    global `commit.gpgsign=true` would clash with work-repo policies.
    The rule's main benefit is attribution-forgery protection, which
    doesn't matter here. Revisit only if there's a concrete reason —
    published library, collaborators, supply-chain concern, or
    deliberate learning exercise.
  - **No `required_status_checks` yet** — there are no workflows to check.
    Leave a comment in the plan execution log noting that future CI plans
    must add their check names here.

The ruleset JSON body will be written inline in a heredoc during execution
and verified with `gh api /repos/.../rulesets/<id>` immediately after
creation.

## Phase D — Security features

All via `gh api` PUT/PATCH calls:

1. `PUT /repos/pete-the-pete/udcpinepdx/vulnerability-alerts` — enable
   Dependabot alerts.
2. `PUT /repos/pete-the-pete/udcpinepdx/automated-security-fixes` — enable
   Dependabot security updates (auto-PR on alerts).
3. `PUT /repos/pete-the-pete/udcpinepdx/code-scanning/default-setup` with
   `{"state": "configured"}` — enable CodeQL default setup. Languages
   auto-detected; revisit if it picks up something surprising.
4. `PATCH /repos/pete-the-pete/udcpinepdx` with
   `{"security_and_analysis": {"secret_scanning": {"status": "enabled"}, "secret_scanning_push_protection": {"status": "enabled"}}}`
   — enable secret scanning **and push protection** (blocks commits
   containing known secret formats at push time, which is the whole
   reason push protection exists).
5. `PUT /repos/pete-the-pete/udcpinepdx/private-vulnerability-reporting`
   — enable the private vuln reporting inbox referenced by `SECURITY.md`.
6. `PUT /repos/pete-the-pete/udcpinepdx/actions/permissions/workflow` with
   `{"default_workflow_permissions": "read", "can_approve_pull_request_reviews": false}`
   — downgrade the default `GITHUB_TOKEN` from read/write to read-only.
   Any workflow that needs write access must opt in explicitly via its
   `permissions:` block. This is the single highest-leverage supply-chain
   hardening for Actions and costs almost nothing.
7. `PUT /repos/pete-the-pete/udcpinepdx/actions/permissions` with
   `{"enabled": true, "allowed_actions": "selected"}` then
   `PUT .../actions/permissions/selected-actions` with
   `{"github_owned_allowed": true, "verified_allowed": true, "patterns_allowed": []}`
   — restrict third-party actions to GitHub-owned + verified creators.
   Future plans can add specific allowlist patterns.

## Phase E — Project management

1. **Labels.** Delete the GitHub default labels we won't use
   (`question`, `wontfix`, `duplicate`, `invalid`, `help wanted`,
   `good first issue`) and create:
   - **Subsystem** (one per file tree): `sub:hardware`, `sub:firmware`,
     `sub:backend`, `sub:web`, `sub:shared`, `sub:ops`
   - **Type:** `type:bug`, `type:feature`, `type:chore`, `type:plan`,
     `type:security`, `type:docs`
   - **Status extras kept from defaults:** `enhancement`, `bug`,
     `documentation` — actually, delete these too to avoid overlap with
     `type:*`. Single taxonomy is better than two.
   All via `gh label create` / `gh label delete` in a small shell loop.
   Colors: pick distinct hues per prefix so the board reads at a glance.

2. **Milestones.** Skip for now. The project has no release cadence yet.
   Adding empty milestones just creates UI noise. A later plan can add
   `v0.1 local prototype`, `v0.2 backend up`, etc. once scope is real.

3. **Seed issues.** Create one `type:plan` issue per subsystem directory
   (`plans/shared`, `plans/firmware`, etc.) that still needs its bootstrap
   plan written, mirroring the deferred items from the bootstrap plan.
   Each issue body is a single sentence pointing at the relevant CLAUDE.md
   section. This gives the Projects v2 board something to show on day one.

4. **Projects v2 board.** Create a user-scoped project
   `udcpinepdx roadmap` via `gh project create --owner pete-the-pete`.
   Add custom fields: `Subsystem` (single-select, values match `sub:*`
   labels), `Priority` (single-select: P0/P1/P2/P3), and keep the default
   `Status` (Todo/In Progress/Done). Link the repo so new issues auto-add.
   Add the seeded issues.

## Phase F — Verification

End-to-end, run in order and confirm each step:

1. `gh repo view pete-the-pete/udcpinepdx --json visibility,licenseInfo,securityAndAnalysis`
   — visibility public, license MIT, secret scanning + push protection
   enabled.
2. `gh api /repos/pete-the-pete/udcpinepdx/rulesets` — one active ruleset
   targeting `refs/heads/main`.
3. **Negative test:** attempt `git push --force-with-lease origin main`
   from a throwaway commit on a detached branch — must be rejected by the
   ruleset. Reset state after.
4. **Negative test:** attempt a direct push of a new commit to `main`
   without a PR — must be rejected.
5. **Positive test:** open a short-lived throwaway branch, push it, open
   a PR via `gh pr create`, confirm the ruleset allows merge after the
   (zero) required reviews, merge with `--squash`, delete branch.
6. `gh api /repos/pete-the-pete/udcpinepdx/actions/permissions/workflow`
   — `default_workflow_permissions: read`.
7. `gh label list` — subsystem + type labels present, unused defaults
   gone.
8. `gh project list --owner pete-the-pete` — `udcpinepdx roadmap` exists
   with seeded issues.

## Phase G — Plan promotion

Per project `CLAUDE.md`, on first post-approval step: copy this plan from
`~/.claude/plans/curried-leaping-owl.md` to
`plans/ops/2026-04-13-github-baseline.md` and include it in the **same
commit** as Phase A's hygiene files. That way the plan lands with the work
it describes, and the scratch file can be forgotten.

---

## Critical files to be created or modified

- `LICENSE` *(new)*
- `SECURITY.md` *(new)*
- `README.md` *(new or edited)*
- `.github/dependabot.yml` *(new)*
- `.gitignore` *(edit if missing entries)*
- `plans/ops/2026-04-13-github-baseline.md` *(new — this plan, promoted)*

No source code changes. No dependency installs. No firmware or backend
touch.

## Follow-ups this plan intentionally defers

- **Required status checks** on the ruleset — blocked on the first CI
  workflow existing. Whichever plan introduces CI must update the ruleset.
- **CODEOWNERS** — not needed until there's more than one reviewer or
  subagents that should auto-request review.
- **Milestones + release cadence** — wait until v0.1 scope is real.
- **Signed commits** — explicitly dropped, see Phase C note above.
  Not a "deferred for later" item; a "revisit only with cause" item.
- **Actions allowlist tuning** — start at GitHub-owned + verified; real
  allowlist patterns land as workflows are added.

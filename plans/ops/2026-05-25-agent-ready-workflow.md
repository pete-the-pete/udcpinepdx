# Agent-Ready Workflow Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Operationalize Pattern B (from the 2026-05-25 workflow-shape brainstorm) by installing the GitHub-side scaffolding — workflow labels, an `agent-ready` issue template, squash-only merges, a merge queue, and a "Ready" status on project 4 — so future plans can decompose into tickets that an unattended agent can safely claim and execute.

**Architecture:** All changes are repo configuration and one new bash script under `ops/github/`. The plan ships as four mostly-independent issues; #4 depends on #1 (label name has to exist before the workflow can route on it), the rest are parallel-safe. Agent-launch mechanism for v1 is **manual handoff** (Pete pastes the issue URL into a fresh Claude Code session); automated launch via GitHub Actions is deferred to its own ops plan once the manual flow has been exercised against real tickets.

**Tech Stack:** `gh` CLI, GitHub REST + GraphQL API, GitHub Projects v2, GitHub Rulesets (for merge queue), YAML issue forms, Markdown.

**Pattern B reconciliation note:** the `project_workflow-shape` memory record specified `subsystem:firmware|backend|...` for the subsystem labels, but the repo has used `sub:firmware` etc. since the GitHub baseline plan landed. This plan keeps the shorter existing convention and updates the memory + docs to match — renaming labels would churn every existing issue and PR for no gain.

---

## File Structure

| Path | Status | Responsibility |
|---|---|---|
| `ops/github/labels.sh` | Create | Idempotent declarative label set. Single source of truth for which labels exist and their colors/descriptions. Re-run any time to reconcile. |
| `.github/ISSUE_TEMPLATE/agent-ready.yml` | Create | YAML issue form enforcing the `Plan:` body header, acceptance criteria, files-to-touch, and dependency declaration. Used when opening a ticket meant to be claimed by an agent. |
| `.github/ISSUE_TEMPLATE/config.yml` | Create | Disables the blank-issue option so every issue uses a template. |
| `docs/agent-workflow.md` | Create | Human-readable explanation of Pattern B: claim rule, label semantics, what "Ready" means, how to launch an agent manually. Referenced from CLAUDE.md. |
| `CLAUDE.md` | Modify | Add a short "Agent-ready tickets" section pointing at `docs/agent-workflow.md`. |
| `.github/workflows/add-to-project.yml` | Modify | Add a branch that sets Status = "Ready" when the new issue has the `agent-ready` label. |
| memory: `project_workflow-shape.md` | Update | Replace `subsystem:*` with `sub:*`; record the agent-launch decision (manual for v1). |

---

## Bootstrapping (do this before claiming any issue below)

After this plan file lands in `main` (its own small PR — no code change, just the plan), open the four issues using the commands in this section. The first issue can't use the template (the template is created by issue 2), so for issues 1 + 2 the body is given inline. Issues 3 + 4 can use the template once issue 2 has merged.

- [ ] **B1: Commit and merge this plan file**

```bash
git checkout -b plans/agent-ready-workflow
git add plans/ops/2026-05-25-agent-ready-workflow.md
git commit -m "plan(ops): agent-ready workflow infrastructure"
git push -u origin plans/agent-ready-workflow
gh pr create --title "plan(ops): agent-ready workflow infrastructure" \
  --body "Adds the implementation plan for Pattern B GitHub scaffolding. Plan file only; no code or config changes."
```

Expected: PR opens, merges after review.

- [ ] **B2: Open issue 1 (labels)**

```bash
gh issue create \
  --title "ops: declarative workflow labels + reconcile orphans" \
  --label "sub:ops,type:chore,agent-ready,parallel-safe" \
  --body "$(cat <<'EOF'
Plan: plans/ops/2026-05-25-agent-ready-workflow.md#issue-1-workflow-labels--reconcile-existing-labels

## Acceptance criteria

- [ ] `ops/github/labels.sh` exists and is executable.
- [ ] Running `ops/github/labels.sh` is idempotent (a second run reports no changes).
- [ ] After running: labels `agent-ready`, `parallel-safe`, `needs-decision`, `blocked` exist with the colors/descriptions specified in the plan.
- [ ] The orphan label `subsystem:shared` has been deleted.
- [ ] All existing `sub:*` and `type:*` labels are still present (untouched).

## Files to touch

- Create: `ops/github/labels.sh`

## Dependencies

None.
EOF
)"
```

- [ ] **B3: Open issue 2 (issue template + docs)**

```bash
gh issue create \
  --title "ops: agent-ready issue template + docs/agent-workflow.md" \
  --label "sub:ops,type:docs,agent-ready,parallel-safe" \
  --body "$(cat <<'EOF'
Plan: plans/ops/2026-05-25-agent-ready-workflow.md#issue-2-agent-ready-issue-template--workflow-docs

## Acceptance criteria

- [ ] `.github/ISSUE_TEMPLATE/agent-ready.yml` exists with the schema defined in the plan.
- [ ] `.github/ISSUE_TEMPLATE/config.yml` exists and disables blank issues.
- [ ] `docs/agent-workflow.md` exists with the content defined in the plan.
- [ ] `CLAUDE.md` gains a short "Agent-ready tickets" section linking to `docs/agent-workflow.md`.
- [ ] Opening a new issue in the GitHub UI shows the agent-ready template and offers no blank-issue option.

## Files to touch

- Create: `.github/ISSUE_TEMPLATE/agent-ready.yml`
- Create: `.github/ISSUE_TEMPLATE/config.yml`
- Create: `docs/agent-workflow.md`
- Modify: `CLAUDE.md`

## Dependencies

None.
EOF
)"
```

- [ ] **B4: Open issue 3 (squash-only + merge queue)**

```bash
gh issue create \
  --title "ops: squash-only merges + merge queue on main" \
  --label "sub:ops,type:chore,agent-ready,parallel-safe" \
  --body "$(cat <<'EOF'
Plan: plans/ops/2026-05-25-agent-ready-workflow.md#issue-3-squash-only-merges--merge-queue--ruleset

## Acceptance criteria

- [ ] Repo settings: \`allow_merge_commit=false\`, \`allow_rebase_merge=false\`, \`allow_squash_merge=true\`.
- [ ] Merge queue enabled on \`main\` via a ruleset (or branch protection rule, whichever the existing baseline uses).
- [ ] The verify command in the plan shows the merge queue is active.
- [ ] No existing ruleset entries are clobbered — additive change only.

## Files to touch

No repo files (settings-only). Document the final state by committing a no-op marker file or by updating \`docs/agent-workflow.md\` (created by issue 2) with the resulting configuration.

## Dependencies

None for the settings change. Documentation update depends on issue 2 being merged.
EOF
)"
```

- [ ] **B5: Open issue 4 (Ready column + workflow routing)**

```bash
gh issue create \
  --title "ops: project 4 \"Ready\" status + add-to-project routing on agent-ready label" \
  --label "sub:ops,type:feature,agent-ready" \
  --body "$(cat <<'EOF'
Plan: plans/ops/2026-05-25-agent-ready-workflow.md#issue-4-project-board-ready-status--workflow-routing

## Acceptance criteria

- [ ] Project 4's Status field has a new single-select option "Ready".
- [ ] `.github/workflows/add-to-project.yml` sets Status="Ready" when the opening issue carries the `agent-ready` label.
- [ ] Issues without `agent-ready` still land in "Todo"; PRs still land in "In Progress".
- [ ] Smoke test: opening a test issue with `agent-ready` lands it in Ready; opening one without lands it in Todo. Close both after verification.

## Files to touch

- Modify: `.github/workflows/add-to-project.yml`

## Dependencies

Depends on issue 1 being merged (the `agent-ready` label must exist before the workflow routes on it).
EOF
)"
```

- [ ] **B6: Verify all four issues landed on the project board**

```bash
gh issue list --label agent-ready --state open --json number,title,labels --jq '.[] | "\(.number) \(.title)"'
```

Expected: four lines, one per new issue.

---

## Issue 1: Workflow labels + reconcile existing labels

**Files:**
- Create: `ops/github/labels.sh`

- [ ] **Step 1: Create the labels script**

Create `ops/github/labels.sh`:

```bash
#!/usr/bin/env bash
# Declarative GitHub label set for udcpinepdx.
#
# Idempotent: re-run any time to reconcile labels with the source of truth below.
# Existing labels are updated in place; missing ones are created; nothing is deleted
# unless its name appears in REMOVE.
#
# Usage:   ops/github/labels.sh
# Requires: gh CLI authenticated against the repo.

set -euo pipefail

REPO="pete-the-pete/udcpinepdx"

# name|color (no #)|description
LABELS=(
  # Subsystem (sub:*) — already present; re-asserted here so this script is the source of truth.
  "sub:hardware|d97706|Door build: materials, cutting, fitment, mounting"
  "sub:firmware|dc2626|Raspberry Pi Python firmware"
  "sub:backend|2563eb|TypeScript API, DB, auth, session ingest"
  "sub:web|0284c7|TypeScript web dashboard"
  "sub:shared|7c3aed|Monorepo root, schemas, codegen"
  "sub:ops|475569|GitHub Actions, protection, Dependabot, deploys"

  # Type
  "type:feature|059669|New capability"
  "type:bug|b91c1c|Something broken"
  "type:chore|6b7280|Maintenance, cleanup, non-feature work"
  "type:docs|0d9488|Documentation only"
  "type:plan|4f46e5|Write or revise a plan document"
  "type:security|e11d48|Security-relevant change or advisory"

  # Workflow (new — Pattern B claim rule)
  "agent-ready|fef08a|Spec is complete and unblocked; an agent may claim this ticket"
  "parallel-safe|c7f9cc|Safe to execute concurrently with other parallel-safe tickets"
  "needs-decision|fbca04|Blocked on Pete for a design or scope decision"
  "blocked|d93f0b|Blocked on another ticket; see body for the dependency"
)

# Labels to delete (orphans / superseded names).
REMOVE=(
  "subsystem:shared"
)

for entry in "${LABELS[@]}"; do
  IFS='|' read -r name color desc <<<"$entry"
  if gh label list --repo "$REPO" --json name --jq '.[].name' | grep -Fxq "$name"; then
    gh label edit "$name" --repo "$REPO" --color "$color" --description "$desc" >/dev/null
    echo "= $name"
  else
    gh label create "$name" --repo "$REPO" --color "$color" --description "$desc" >/dev/null
    echo "+ $name"
  fi
done

for name in "${REMOVE[@]}"; do
  if gh label list --repo "$REPO" --json name --jq '.[].name' | grep -Fxq "$name"; then
    gh label delete "$name" --repo "$REPO" --yes >/dev/null
    echo "- $name"
  fi
done

echo "done."
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x ops/github/labels.sh
```

- [ ] **Step 3: Run it (first time — creates the new labels, deletes the orphan)**

```bash
ops/github/labels.sh
```

Expected output includes (order may vary):
```
= sub:hardware
= sub:firmware
...
+ agent-ready
+ parallel-safe
+ needs-decision
+ blocked
- subsystem:shared
done.
```

- [ ] **Step 4: Run it again to confirm idempotency**

```bash
ops/github/labels.sh
```

Expected: every line starts with `=` (no `+` or `-` lines), then `done.`

- [ ] **Step 5: Verify the new labels exist**

```bash
gh label list --search agent-ready
gh label list --search parallel-safe
gh label list --search needs-decision
gh label list --search blocked
```

Expected: each command prints exactly one row matching the name.

- [ ] **Step 6: Verify the orphan is gone**

```bash
gh label list --search "subsystem:shared" --json name --jq '. | length'
```

Expected output: `0`

- [ ] **Step 7: Commit**

```bash
git checkout -b ops/workflow-labels
git add ops/github/labels.sh
git commit -m "ops(github): declarative workflow labels (agent-ready, parallel-safe, needs-decision, blocked)

Adds ops/github/labels.sh as the idempotent source of truth for the
repo's label set. Introduces the four Pattern-B workflow labels and
removes the orphan subsystem:shared.

Closes #<issue-1-number>"
git push -u origin ops/workflow-labels
gh pr create --fill
```

Expected: PR opens, CI green, merges to main.

---

## Issue 2: agent-ready issue template + workflow docs

**Files:**
- Create: `.github/ISSUE_TEMPLATE/agent-ready.yml`
- Create: `.github/ISSUE_TEMPLATE/config.yml`
- Create: `docs/agent-workflow.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Create the agent-ready issue form**

Create `.github/ISSUE_TEMPLATE/agent-ready.yml`:

```yaml
name: Agent-ready ticket
description: A ticket that an autonomous agent (or you) can claim and execute end-to-end.
title: "<subsystem>: <short verb-phrase>"
labels: []
body:
  - type: markdown
    attributes:
      value: |
        Use this template when the work is fully scoped and the file paths,
        acceptance criteria, and dependencies are known. Add the `agent-ready`
        label *after* opening so a runner doesn't pick it up half-spec'd.
  - type: input
    id: plan
    attributes:
      label: Plan reference
      description: Repo-relative path to the plan + optional `#anchor` section.
      placeholder: plans/<sub>/YYYY-MM-DD-<slug>.md#issue-N-title
    validations:
      required: true
  - type: textarea
    id: acceptance
    attributes:
      label: Acceptance criteria
      description: Concrete checks the agent runs to know it is done.
      value: |
        - [ ]
        - [ ]
    validations:
      required: true
  - type: textarea
    id: files
    attributes:
      label: Files to touch
      description: Create / Modify / Delete with exact paths.
      placeholder: |
        - Create: path/to/new.ts
        - Modify: path/to/existing.ts (function X)
    validations:
      required: true
  - type: textarea
    id: dependencies
    attributes:
      label: Dependencies
      description: Other issues that must merge first, or "None".
      placeholder: "Depends on #N (label `blocked` and reference here)."
    validations:
      required: true
```

- [ ] **Step 2: Disable blank issues**

Create `.github/ISSUE_TEMPLATE/config.yml`:

```yaml
blank_issues_enabled: false
contact_links: []
```

- [ ] **Step 3: Write the agent-workflow docs**

Create `docs/agent-workflow.md`:

````markdown
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
````

- [ ] **Step 4: Reference the docs from CLAUDE.md**

Edit `CLAUDE.md`. Find the "GitHub Projects" section. After its last paragraph (about `Closes #N`), insert:

```markdown

### Agent-ready tickets

This repo uses Pattern B for breaking plans into agent-claimable tickets.
The conventions (label semantics, claim rule, status lanes, manual agent
launch for v1) live in `docs/agent-workflow.md`. New tickets meant for
an agent must use the `agent-ready` issue template.
```

- [ ] **Step 5: Verify the template renders in the UI**

```bash
gh issue create --web
```

Expected: the browser opens to a "Choose a template" page showing exactly one option, "Agent-ready ticket". The blank-issue option is absent.

Close the browser tab without submitting.

- [ ] **Step 6: Commit**

```bash
git checkout -b ops/agent-ready-template
git add .github/ISSUE_TEMPLATE/agent-ready.yml .github/ISSUE_TEMPLATE/config.yml docs/agent-workflow.md CLAUDE.md
git commit -m "ops(github): agent-ready issue template + workflow docs

Adds the issue form, disables blank issues, and documents Pattern B
(label semantics, claim rule, status lanes, manual agent launch for v1).
CLAUDE.md gains a short pointer at the new docs.

Closes #<issue-2-number>"
git push -u origin ops/agent-ready-template
gh pr create --fill
```

---

## Issue 3: Squash-only merges + merge queue + ruleset

**Files:** No repo files. Pure GitHub configuration. The settled state is documented in `docs/agent-workflow.md` (which already exists once issue 2 merges; this issue's PR description is the audit trail).

- [ ] **Step 1: Snapshot the current merge-method state**

```bash
gh repo view --json mergeCommitAllowed,squashMergeAllowed,rebaseMergeAllowed
```

Expected (today's state): `{"mergeCommitAllowed":true,"squashMergeAllowed":true,"rebaseMergeAllowed":true}`

- [ ] **Step 2: Disable merge-commit and rebase-merge**

```bash
gh api -X PATCH "repos/pete-the-pete/udcpinepdx" \
  -F allow_merge_commit=false \
  -F allow_rebase_merge=false \
  -F allow_squash_merge=true \
  --jq '{mergeCommitAllowed: .allow_merge_commit, squashMergeAllowed: .allow_squash_merge, rebaseMergeAllowed: .allow_rebase_merge}'
```

Expected output: `{"mergeCommitAllowed":false,"squashMergeAllowed":true,"rebaseMergeAllowed":false}`

- [ ] **Step 3: Snapshot the existing rulesets**

```bash
gh api "repos/pete-the-pete/udcpinepdx/rulesets" --jq '.[] | {id, name, target, enforcement}'
```

Expected: one or more rulesets (the GitHub baseline plan installed at least one). Note the `id` of the ruleset whose `target` is `branch` and that targets `main` — call this `$RULESET_ID` below.

- [ ] **Step 4: Read that ruleset's current rules**

```bash
RULESET_ID=<id-from-step-3>
gh api "repos/pete-the-pete/udcpinepdx/rulesets/$RULESET_ID" --jq '.rules[] | .type'
```

Expected: a list of rule types (e.g. `pull_request`, `required_status_checks`, ...). Confirm `merge_queue` is NOT already present.

- [ ] **Step 5: Add a merge-queue rule to the ruleset**

Save the existing ruleset to a file, append the merge-queue rule, and PATCH it back:

```bash
RULESET_ID=<id-from-step-3>
gh api "repos/pete-the-pete/udcpinepdx/rulesets/$RULESET_ID" > /tmp/ruleset.json

jq '.rules += [{
  "type": "merge_queue",
  "parameters": {
    "merge_method": "SQUASH",
    "grouping_strategy": "ALLGREEN",
    "max_entries_to_build": 5,
    "max_entries_to_merge": 5,
    "min_entries_to_merge": 1,
    "min_entries_to_merge_wait_minutes": 5,
    "check_response_timeout_minutes": 60
  }
}]' /tmp/ruleset.json > /tmp/ruleset.new.json

gh api -X PUT "repos/pete-the-pete/udcpinepdx/rulesets/$RULESET_ID" \
  --input /tmp/ruleset.new.json \
  --jq '.rules[] | .type'
```

Expected output now includes `merge_queue` among the rule types.

- [ ] **Step 6: Verify the merge queue is live**

```bash
gh api "repos/pete-the-pete/udcpinepdx/rulesets/$RULESET_ID" --jq '.rules[] | select(.type=="merge_queue")'
```

Expected: prints the merge-queue rule with the parameters from step 5.

- [ ] **Step 7: Smoke test with a trivial PR**

Create a no-op PR (e.g. adding a blank line to `docs/agent-workflow.md`) and confirm the GitHub UI offers "Merge when ready" (the merge-queue affordance) instead of (or in addition to) "Squash and merge". Cancel the PR after confirming.

```bash
git checkout -b ops/merge-queue-smoke
printf '\n' >> docs/agent-workflow.md
git add docs/agent-workflow.md
git commit -m "ops: smoke-test merge queue (will be closed)"
git push -u origin ops/merge-queue-smoke
gh pr create --fill --web
```

Expected: PR page shows merge queue option. Close the PR (do not merge) and delete the branch:

```bash
gh pr close ops/merge-queue-smoke --delete-branch
```

- [ ] **Step 8: Commit (no code, but the PR documents the change)**

This issue has no repo deliverable. Close it with a comment that includes the before/after snapshots from steps 1 and 2 and a link to the ruleset:

```bash
gh issue comment <issue-3-number> --body "$(cat <<'EOF'
Settled.

**Merge methods**
- before: merge=true, squash=true, rebase=true
- after:  merge=false, squash=true, rebase=false

**Merge queue:** added to ruleset $RULESET_ID with `merge_method=SQUASH`, `grouping_strategy=ALLGREEN`.

Smoke test PR opened and closed without merging.
EOF
)"
gh issue close <issue-3-number> --reason completed
```

---

## Issue 4: Project board "Ready" status + workflow routing

**Files:**
- Modify: `.github/workflows/add-to-project.yml`

- [ ] **Step 1: Discover the Status field's current option IDs**

```bash
gh api graphql -f query='
  query($login: String!, $number: Int!) {
    user(login: $login) {
      projectV2(number: $number) {
        field(name: "Status") {
          ... on ProjectV2SingleSelectField {
            id
            options { id name }
          }
        }
      }
    }
  }' -F login=pete-the-pete -F number=4 --jq '.data.user.projectV2.field'
```

Expected output: a JSON object with `id` (the field ID — should match the hardcoded `PVTSSF_lAHOAAVHgc4BUmcOzhBtgJA` in the workflow) and an `options` array including at least `Todo`, `In Progress`, and `Done`. Note that there is no `Ready` yet.

- [ ] **Step 2: Add the "Ready" option to the Status field**

This is done via the GitHub UI — the GraphQL `updateProjectV2Field` mutation does not yet support adding options to single-select fields without replacing the full set, and the safer path is the UI.

In the browser:
1. Open `https://github.com/users/pete-the-pete/projects/4/settings/fields`.
2. Click the **Status** field.
3. Add a new option named exactly **`Ready`** with a yellow/amber swatch.
4. Drag it to sit between `Todo` and `In Progress`.
5. Save.

- [ ] **Step 3: Re-fetch options and capture the Ready option ID**

```bash
gh api graphql -f query='
  query($login: String!, $number: Int!) {
    user(login: $login) {
      projectV2(number: $number) {
        field(name: "Status") {
          ... on ProjectV2SingleSelectField {
            options { id name }
          }
        }
      }
    }
  }' -F login=pete-the-pete -F number=4 \
  --jq '.data.user.projectV2.field.options[] | select(.name=="Ready") | .id'
```

Expected: a single 8-character option ID (e.g. `a1b2c3d4`). Note it as `READY_OPTION_ID` — needed in step 4.

- [ ] **Step 4: Update the add-to-project workflow**

Edit `.github/workflows/add-to-project.yml`. Replace the entire `Set Status field` step's `run` block (lines 28–55 of the current file) with:

```yaml
      - name: Set Status field
        env:
          GH_TOKEN: ${{ secrets.ADD_TO_PROJECT_PAT }}
          ITEM_ID: ${{ steps.add.outputs.itemId }}
          IS_PR: ${{ github.event_name == 'pull_request_target' }}
          HAS_AGENT_READY: ${{ github.event_name == 'issues' && contains(github.event.issue.labels.*.name, 'agent-ready') }}
        run: |
          set -euo pipefail
          PROJECT_ID="$(gh api graphql -f query='
            query($login: String!, $number: Int!) {
              user(login: $login) { projectV2(number: $number) { id } }
            }' -F login=pete-the-pete -F number=4 \
            --jq '.data.user.projectV2.id')"

          STATUS_FIELD_ID="PVTSSF_lAHOAAVHgc4BUmcOzhBtgJA"
          if [ "$IS_PR" = "true" ]; then
            OPTION_ID="47fc9ee4"          # In Progress
          elif [ "$HAS_AGENT_READY" = "true" ]; then
            OPTION_ID="<READY_OPTION_ID>" # Ready
          else
            OPTION_ID="f75ad846"          # Todo
          fi

          gh api graphql -f query='
            mutation($project: ID!, $item: ID!, $field: ID!, $option: String!) {
              updateProjectV2ItemFieldValue(input: {
                projectId: $project
                itemId: $item
                fieldId: $field
                value: { singleSelectOptionId: $option }
              }) { projectV2Item { id } }
            }' \
            -F project="$PROJECT_ID" \
            -F item="$ITEM_ID" \
            -F field="$STATUS_FIELD_ID" \
            -F option="$OPTION_ID"
```

Replace `<READY_OPTION_ID>` with the value captured in step 3.

- [ ] **Step 5: Commit and open a PR**

```bash
git checkout -b ops/ready-status-routing
git add .github/workflows/add-to-project.yml
git commit -m "ops(github): route agent-ready issues to project Status=Ready

Adds a Status=Ready branch to the add-to-project workflow so that
newly-opened issues carrying the agent-ready label land directly in
the Ready lane on project 4 instead of Todo. PRs continue to route
to In Progress; issues without the label continue to route to Todo.

Closes #<issue-4-number>"
git push -u origin ops/ready-status-routing
gh pr create --fill
```

- [ ] **Step 6: Smoke test — issue WITH agent-ready**

After the PR merges, open a throwaway issue:

```bash
gh issue create \
  --title "smoke: route agent-ready to Ready" \
  --label "sub:ops,type:chore,agent-ready" \
  --body "Smoke test for the new routing. Closing immediately."
```

Wait for the `Add to project` workflow to complete (≤2 minutes):

```bash
gh run list --workflow=add-to-project.yml --limit 1
```

Then check the project status of the new issue:

```bash
ISSUE_NUM=<number-from-gh-issue-create>
gh api graphql -f query='
  query($login: String!, $number: Int!, $issue: Int!) {
    user(login: $login) {
      projectV2(number: $number) {
        items(first: 100) {
          nodes {
            content { ... on Issue { number } }
            fieldValues(first: 10) {
              nodes {
                ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2SingleSelectField { name } } }
              }
            }
          }
        }
      }
    }
  }' -F login=pete-the-pete -F number=4 -F issue=$ISSUE_NUM \
  --jq ".data.user.projectV2.items.nodes[] | select(.content.number==$ISSUE_NUM) | .fieldValues.nodes[] | select(.field.name==\"Status\") | .name"
```

Expected output: `Ready`

Close the smoke issue:

```bash
gh issue close $ISSUE_NUM --reason "not planned" --comment "smoke test — routing confirmed"
```

- [ ] **Step 7: Smoke test — issue WITHOUT agent-ready**

```bash
gh issue create \
  --title "smoke: route plain issue to Todo" \
  --label "sub:ops,type:chore" \
  --body "Smoke test for the fallback routing."
```

Wait for the workflow, then verify Status="Todo" using the same query as step 6. Close the issue.

---

## Post-execution updates

After all four issues land:

- [ ] **Update memory record** `project_workflow-shape.md`:
  - Replace any `subsystem:firmware|backend|web|...` references with `sub:firmware|sub:backend|sub:web|...`.
  - Append a "Realized" section noting: labels installed, issue template installed, merge queue live, Ready lane routing live, agent-launch mechanism for v1 = manual handoff.

- [ ] **Spawn the follow-up plan stub** `plans/ops/<future-date>-agent-runner-actions.md` once you've felt out the manual flow against 2–3 real tickets. Until then, do not write it — let the manual experience inform the requirements.

---

## Self-review

**Spec coverage** (against the workflow-shape memory + the two open questions raised in this session):

- Pattern B realized: ✓ (labels, template, claim rule documented)
- Decompose-toward-independence rule: ✓ (in `docs/agent-workflow.md`)
- Merge queue + squash defaults: ✓ (Issue 3)
- Issue body convention (`Plan:` header): ✓ (enforced by template)
- Labels (`agent-ready`, `parallel-safe`, `needs-decision`, plus subsystem labels): ✓ (Issue 1) — `blocked-by:#N` from memory generalized to a single `blocked` label with the dependency declared in the body, since per-PR `blocked-by:#N` labels don't scale.
- Agent claim rule: ✓ (documented in `docs/agent-workflow.md`).
- Agent launch mechanism: ✓ — settled on manual handoff for v1; automation deferred to its own future plan with a clear trigger (after 2–3 manual runs).
- `sub:*` vs `subsystem:*` name reconciliation: ✓ (kept existing `sub:*`).

**Placeholder scan:** No `TBD`, `TODO`, or "implement later" markers in the plan. The `<issue-N-number>` and `<READY_OPTION_ID>` slots in commit messages and the workflow file are filled in at execution time from values produced earlier in the same execution.

**Type / name consistency:** Label names match across the script (`agent-ready`, `parallel-safe`, etc.), the issue template, the workflow routing, and the docs. The Status option name `Ready` matches across the UI step, the GraphQL query, and the workflow comment.

**Decomposition audit:** Four issues, three of them parallel-safe; #4 depends on #1 (label must exist for the routing to be meaningful). This is at the edge of the ≥80% independence rule but acceptable — the dependency is one-hop and the unblocked sibling work is the majority.

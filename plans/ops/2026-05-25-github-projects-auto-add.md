# Auto-add issues and PRs to the udcpinepdx Project board

## Context

Project board `pete-the-pete/projects/4` exists (created in the GitHub
baseline plan) but nothing populates it automatically. Issues and PRs
opened in `pete-the-pete/udcpinepdx` — including those Claude opens via
`gh issue create` / `gh pr create` — never land on the board unless
someone runs `gh project item-add` manually. Result: the board is
stale and doesn't reflect actual work-in-flight.

Example of the gap: PR
[#28](https://github.com/pete-the-pete/udcpinepdx/pull/28) is open but
has no project item on board 4.

Fix is two-layered (per Pete's choice of Option C from this session):

1. **Workflow** auto-adds every new issue and PR to project 4, and sets
   the initial Status field.
2. **CLAUDE.md rule** makes the expectation explicit so Claude is
   proactive — not reactive to the workflow — and so Pete (or any
   future contributor) knows the contract.

Supports learning goals **#3 (security/access — fine-grained PATs,
secret minimum-privilege)** and **#6 (GitHub to its full potential —
Projects v2 GraphQL API, Actions secrets, workflow auth)**.

---

## Decisions (locked in this session)

- **Auth:** Fine-grained PAT, stored as a repo secret
  `ADD_TO_PROJECT_PAT`. Scope: read+write on Pete's user-owned project
  4 only; no repo scopes. Token expiry: 90 days, rotation tracked as a
  GitHub issue at creation time.
- **Initial Status field:**
  - New **issues** → `Todo`
  - New **PRs** → `In Progress` (reusing the existing column rather
    than introducing a new `In Review` option; revisit later if PR/work
    semantics blur too much)
- **CLAUDE.md scope:** short rule + pointer to the workflow file. No
  inline `gh` command reference doc.
- **Project number / owner:** hardcoded in the workflow as `4` /
  `pete-the-pete`. If the board is ever recreated, update the workflow.

---

## Phase A — PAT and secret (manual, Pete-driven)

Claude cannot create PATs or write to `gh secret set` for a user-scoped
PAT without the token in hand. Pete does this once; the plan documents
the exact steps so it's reproducible.

> **Why classic, not fine-grained.** We tried fine-grained first. They
> don't expose a Projects permission for **user-owned** Projects v2
> boards — Projects only appears under *Organization* permissions, and
> our board is owned by `pete-the-pete` (a user), not an org. Result:
> the `actions/add-to-project` action fails with "Resource not
> accessible by personal access token" no matter how the fine-grained
> repo permissions are configured. The narrowest token that actually
> works is a classic PAT with **only** the `project` scope checked.
> Blast radius if leaked: read/write to all of Pete's project boards,
> nothing else (no repo, no workflow, no admin, no delete). Acceptable.

### A1. Create the classic PAT

1. Go to <https://github.com/settings/tokens/new>.
2. **Note:** `udcpinepdx — add-to-project (classic)`.
3. **Expiration:** 90 days from today (2026-08-23).
4. **Scopes:** check **only `project`** (auto-expands to `read:project`
   + `write:project`). Do NOT check `repo`, `workflow`, `gist`, or any
   other scope. The action does not need repo access — it identifies
   issues/PRs from the event payload alone.
5. Generate, copy the token, **do not paste it into chat**.

> **If we ever move project 4 under a GitHub org** (e.g. for multi-user
> access later), re-do this phase as a fine-grained PAT scoped to that
> org's Projects: read+write, plus repo Issues/PRs read. Fine-grained
> is then strictly better. Update this plan + the workflow comment if
> that migration happens.

### A2. Store as repo secret

```bash
gh secret set ADD_TO_PROJECT_PAT \
  --repo pete-the-pete/udcpinepdx \
  --app actions
# (paste token at the prompt)
```

Verify:

```bash
gh secret list --repo pete-the-pete/udcpinepdx --app actions
# expect: ADD_TO_PROJECT_PAT <date>
```

### A3. Schedule rotation

Open an issue (Claude does this in execution, post-merge — see Phase D):

```
Title:  Rotate ADD_TO_PROJECT_PAT (expires 2026-08-23)
Labels: sub:ops, type:security, type:chore
Body:   Rotation reminder. Regenerate the classic PAT (scope: project)
        per plans/ops/2026-05-25-github-projects-auto-add.md and update
        the ADD_TO_PROJECT_PAT repo secret. Close after rotation.
```

The workflow itself adds this issue to project 4 in Todo — making the
rotation issue the first end-to-end verification.

---

## Phase B — The workflow

Create `.github/workflows/add-to-project.yml`:

```yaml
name: Add to project

on:
  issues:
    types: [opened, reopened]
  pull_request_target:
    types: [opened, reopened, ready_for_review]

permissions: {}

jobs:
  add-to-project:
    name: Add and set status
    runs-on: ubuntu-latest
    steps:
      - name: Add issue or PR to project 4
        id: add
        uses: actions/add-to-project@5afcf98fcd03f1c2f92c3c83f58ae24323cc57fd  # v2.0.0
        with:
          project-url: https://github.com/users/pete-the-pete/projects/4
          github-token: ${{ secrets.ADD_TO_PROJECT_PAT }}

      - name: Set Status field
        env:
          GH_TOKEN: ${{ secrets.ADD_TO_PROJECT_PAT }}
          ITEM_ID: ${{ steps.add.outputs.itemId }}
          IS_PR: ${{ github.event_name == 'pull_request_target' }}
        run: |
          set -euo pipefail
          PROJECT_ID="$(gh api graphql -f query='
            query($login: String!, $number: Int!) {
              user(login: $login) { projectV2(number: $number) { id } }
            }' -F login=pete-the-pete -F number=4 \
            --jq '.data.user.projectV2.id')"

          STATUS_FIELD_ID="PVTSSF_lAHOAAVHgc4BUmcOzhBtgJA"
          if [ "$IS_PR" = "true" ]; then
            OPTION_ID="47fc9ee4"   # In Progress
          else
            OPTION_ID="f75ad846"   # Todo
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

### Why these choices

- **`pull_request_target` instead of `pull_request`:** lets the
  workflow see the secret even for PRs from forks. We're not checking
  out PR code, only adding the PR to the board, so the well-known
  `pull_request_target` security risk (running untrusted code with
  elevated permissions) does not apply here.
- **`permissions: {}`** at the workflow level: the default `GITHUB_TOKEN`
  isn't used at all — everything goes through `ADD_TO_PROJECT_PAT`.
  Belt-and-suspenders: no accidental privilege.
- **Hardcoded field/option IDs:** they're stable and never change for a
  given project field. Avoids a second GraphQL lookup per run.
  Documented in this plan so future-Pete can find them if the schema
  changes. (Captured 2026-05-25 via
  `gh project field-list 4 --owner pete-the-pete` + a GraphQL query on
  the Status field node.)
- **`actions/add-to-project` pinned by full commit SHA** (`5afcf98…` =
  v2.0.0), not by tag. Tags in git are mutable references — anyone with
  write access to `actions/add-to-project` can move `v2.0.0` to point at
  a different commit, and our next workflow run would pick up the new
  code. SHAs are immutable: pinning by SHA means our workflow runs
  *exactly* the bytes we vetted, full stop. The trailing `# v2.0.0`
  comment is just a human-readable hint; the SHA is what GitHub
  actually resolves. Dependabot (when configured later) understands
  this pin format and will open PRs that update both the SHA and the
  comment together.

---

## Phase C — CLAUDE.md addition

Add this section to `CLAUDE.md`, slotted just above **"Safety rails"**:

```markdown
## GitHub Projects

Every issue and PR in this repo belongs on project board
`pete-the-pete/projects/4`. The `.github/workflows/add-to-project.yml`
workflow auto-adds new issues and PRs and sets initial Status (issues
→ Todo, PRs → In Progress). Do not add items manually with
`gh project item-add` — let the workflow do it, and confirm the item
appeared on the board after opening the issue/PR.

If the workflow fails (e.g. expired PAT), fix the underlying issue.
Don't paper over it with manual `gh project item-add` calls.
```

Rationale for putting it above Safety rails: it's a workflow contract,
not a safety rail itself.

---

## Phase D — Execution order and verification

1. Pete completes Phase A (PAT + secret).
2. Claude writes `.github/workflows/add-to-project.yml` (Phase B).
3. Claude updates `CLAUDE.md` (Phase C).
4. Claude commits + opens a PR on a feature branch. **This PR is the
   first end-to-end test:** when opened, the workflow should run on
   the PR itself and add it to project 4 with Status = "In Progress".
5. Verify:
   - `gh run list --workflow=add-to-project.yml --limit 1` shows a
     successful run.
   - `gh project item-list 4 --owner pete-the-pete --format json
     --jq '.items[] | select(.content.url | endswith("/pull/<N>"))'`
     returns the new PR.
   - Board UI shows the PR in the **In Progress** column.
6. Open the rotation-reminder issue (Phase A3); verify it lands in
   **Todo**.
7. Backfill: existing open issues and PR #28 are added to the board
   manually as a one-time cleanup, with a brief note in the PR
   description that the workflow handles it going forward.

---

## Out of scope

- Setting `Subsystem` or `Priority` fields automatically. Those are
  editorial; Claude or Pete sets them per item when creating, not via
  workflow. A follow-up plan could parse labels → Subsystem if the
  manual step becomes annoying.
- Moving items between statuses on PR merge, issue close, etc. The
  built-in project workflows on the board already handle "auto-close
  → Done"; no need to duplicate.
- CODEOWNERS, issue templates, PR templates. Deferred per the
  baseline plan.

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| PAT expires silently → workflow starts failing | Rotation issue scheduled in A3; expiry is 2026-08-23 |
| PR from a fork can't see the secret | Using `pull_request_target`, which provides secrets for forks. No checkout of PR code, so no code-injection risk. |
| Field/option IDs change | Plan documents the discovery command. Workflow fails loudly (mutation error) rather than silently mis-categorizing. |
| Workflow accidentally given repo write | `permissions: {}` at workflow level + PAT scoped only to Projects |

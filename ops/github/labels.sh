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
  if gh label list --repo "$REPO" --json name --jq '.[].name' | grep -Fx "$name" >/dev/null; then
    gh label edit "$name" --repo "$REPO" --color "$color" --description "$desc" >/dev/null
    echo "= $name"
  else
    gh label create "$name" --repo "$REPO" --color "$color" --description "$desc" >/dev/null
    echo "+ $name"
  fi
done

for name in "${REMOVE[@]}"; do
  if gh label list --repo "$REPO" --json name --jq '.[].name' | grep -Fx "$name" >/dev/null; then
    gh label delete "$name" --repo "$REPO" --yes >/dev/null
    echo "- $name"
  fi
done

echo "done."

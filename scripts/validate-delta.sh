#!/usr/bin/env bash
# Validate only the files changed since a base ref against an org. Nothing is deployed.
# Prints the job id so a later "sf project deploy quick" can ship the same validated payload.
# Usage: scripts/validate-delta.sh <org-alias> [base-ref]
set -euo pipefail
ORG="${1:?org alias required}"
BASE="${2:-origin/main}"

DELETED=()
while IFS= read -r f; do [ -n "$f" ] && DELETED+=("$f"); done < <(git diff --name-only --diff-filter=D "$BASE"...HEAD -- core ui)
if [ "${#DELETED[@]}" -gt 0 ]; then
  echo "Deleted files need a destructiveChanges manifest, not a source deploy:" >&2
  printf '  %s\n' "${DELETED[@]}" >&2
  exit 2
fi

CHANGED=()
while IFS= read -r f; do [ -n "$f" ] && CHANGED+=("$f"); done < <(git diff --name-only --diff-filter=ACMR "$BASE"...HEAD -- core ui)
if [ "${#CHANGED[@]}" -eq 0 ]; then
  echo "No changes under core/ or ui/."
  exit 0
fi

ARGS=()
for f in "${CHANGED[@]}"; do ARGS+=(--source-dir "$f"); done
sf project deploy validate "${ARGS[@]}" --target-org "$ORG" --test-level RunLocalTests --wait 30

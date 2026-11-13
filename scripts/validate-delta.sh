#!/usr/bin/env bash
# Validate only the files changed since a base ref against an org. Nothing is deployed.
# Prints the job id so a later "sf project deploy quick" can ship the same validated payload.
# Deleted and renamed components go through a generated destructiveChanges.xml.
# Usage: scripts/validate-delta.sh <org-alias> [base-ref] [--select-tests] [--dry-run]
set -euo pipefail
exec node "$(dirname "$0")/delta.js" "$@"

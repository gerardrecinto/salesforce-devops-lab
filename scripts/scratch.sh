#!/usr/bin/env bash
# Create a scratch org, deploy both package directories, assign the permission set, load seed data.
# Usage: scripts/scratch.sh <dev-hub-alias> [scratch-alias] [days]
set -euo pipefail
HUB="${1:?dev hub alias required}"
ALIAS="${2:-lab}"
DAYS="${3:-7}"

sf org create scratch --definition-file config/project-scratch-def.json \
  --target-dev-hub "$HUB" --alias "$ALIAS" --duration-days "$DAYS" --set-default --wait 10
sf project deploy start --target-org "$ALIAS" --test-level NoTestRun
sf org assign permset --name AccountHealth_User --target-org "$ALIAS"
sf data import tree --plan data/Account-plan.json --target-org "$ALIAS"
sf org open --target-org "$ALIAS" --path lightning/page/home

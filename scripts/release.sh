#!/usr/bin/env bash
# Build package versions (core first, ui depends on it), check coverage, optionally promote.
# Usage: scripts/release.sh <dev-hub-alias> [--promote]
set -euo pipefail
HUB="${1:?dev hub alias required}"
PROMOTE="${2:-}"

for pkg in account-health-core account-health-ui; do
  sf package version create --package "$pkg" --installation-key-bypass \
    --code-coverage --wait 30 --target-dev-hub "$HUB"
done

if [ "$PROMOTE" = "--promote" ]; then
  for pkg in account-health-core account-health-ui; do
    VERSION_ID=$(sf package version list --packages "$pkg" --target-dev-hub "$HUB" \
      --released false --order-by CreatedDate --json | node -e \
      'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s).result;console.log(r[r.length-1].SubscriberPackageVersionId)})')
    sf package version promote --package "$VERSION_ID" --no-prompt --target-dev-hub "$HUB"
  done
fi

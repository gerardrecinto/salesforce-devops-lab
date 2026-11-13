#!/usr/bin/env bash
# One time: register the two unlocked packages in the Dev Hub. Writes aliases to sfdx-project.json.
# Usage: scripts/bootstrap-packages.sh <dev-hub-alias>
set -euo pipefail
HUB="${1:?dev hub alias required}"
sf package create --name account-health-core --package-type Unlocked --path core --no-namespace --target-dev-hub "$HUB"
sf package create --name account-health-ui --package-type Unlocked --path ui --no-namespace --target-dev-hub "$HUB"

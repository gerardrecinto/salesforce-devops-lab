# salesforce-devops-lab

[![ci](https://github.com/gerardrecinto/salesforce-devops-lab/actions/workflows/ci.yml/badge.svg)](https://github.com/gerardrecinto/salesforce-devops-lab/actions/workflows/ci.yml) [![site](https://img.shields.io/badge/site-try%20it%20in%20the%20browser-0369a1)](https://gerardrecinto.github.io/salesforce-devops-lab/) ![license](https://img.shields.io/badge/license-MIT-blue)

**Site with a browser demo: https://gerardrecinto.github.io/salesforce-devops-lab/**

A small Salesforce DX project that shows the release path end to end: Apex with SOQL, a Lightning Web Component, two unlocked packages, a delta validation script and GitHub Actions. It is a lab, not something I run in a customer org.

The feature is a stale accounts list: accounts with no activity for N days, read with `WITH USER_MODE`, shown in an LWC.

## Layout

| Path | What |
|---|---|
| `core/` | Apex: `AccountSelector` (SOQL), `AccountHealthService`, `AccountHealthController`, tests, `AccountHealth_User` permission set. Unlocked package `account-health-core`. |
| `ui/` | LWC `staleAccounts` with Jest tests. Unlocked package `account-health-ui`, depends on core. |
| `manifest/package.xml` | Metadata API manifest, used for the `source` to `mdapi` conversion. |
| `config/project-scratch-def.json` | Scratch org shape. |
| `data/` | Seed records for `sf data import tree`. |
| `site/` | The GitHub Pages site: delta planner and Apex check that run in the browser. `qa/` tests them, including a check that the planner and `validate-delta.sh` agree. |
| `scripts/` | `scratch.sh`, `validate-delta.sh`, `bootstrap-packages.sh`, `release.sh`. |

## Run it

```bash
npm install --global @salesforce/cli@2.158.7   # Node 20+ and Java 17+ needed
npm ci
npm run format:check && npm run lint && npm run test:lwc && npm run scan && npm run convert && npm run test:site
```

With a Dev Hub already authorized as `devhub`:

```bash
scripts/scratch.sh devhub            # scratch org, deploy, permset, seed data
sf apex run test --target-org lab --test-level RunLocalTests --code-coverage --wait 10
scripts/bootstrap-packages.sh devhub # once
scripts/release.sh devhub            # create versions, add --promote to release
```

## Deployment strategies and when I would use each

| Strategy | Use it when | Cost |
|---|---|---|
| Change sets | One-off move between connected orgs, no CLI access | Manual, no history, no diff, cannot be re-run from source control. Not used here. |
| Source deploy (`sf project deploy`) | Day to day deploys and PR validation | Whole-org drift is not detected, deletions need a destructive manifest |
| Unlocked packages | Own code that ships to several orgs and needs versions and rollback | Package dependency order, coverage rule of 75% for promotion, slower than a source deploy |
| Managed packages | Distributing to customers you do not control (AppExchange) | Needs a namespace and a security review, harder to change once shipped. Not built here. |

Metadata API path: `npm run convert` turns the source format into the Metadata API format under `build/mdapi`, which is what older tooling and `sf project deploy start --metadata-dir` expect.

## Delta validation

`scripts/validate-delta.sh <org> [base]` takes the files changed against the base branch and runs `sf project deploy validate` with `RunLocalTests`. It prints a job id, and `sf project deploy quick --job-id <id>` ships that exact validated payload later without rerunning tests. Deleted files stop the script, because a source deploy cannot delete: use a `destructiveChanges.xml` manifest for those.

## CI

`ci.yml` job `offline` runs on every push and PR with no Salesforce credentials: Prettier (Apex through the Java parser), ESLint, Jest, PMD through Code Analyzer, source conversion, the site logic tests, shell syntax check.

Job `validate` runs only when the repo variable `SF_VALIDATE` is `true` and these secrets exist: `SF_JWT_KEY`, `SF_CLIENT_ID`, `SF_USERNAME` (sandbox). `release.yml` is manual and also needs `SF_DEVHUB_USERNAME`. JWT login needs a connected app with the matching certificate.

## What is checked and what is not

Checked locally and in CI: LWC Jest (3 tests), ESLint, Prettier, PMD (no violations at Moderate or above), source to Metadata API conversion, the site tests, `bash -n` on the scripts, and the `validate-delta.sh` file selection and delete guard against a stubbed `sf`.

Not run, because no Dev Hub or sandbox was connected: the Apex tests, scratch org creation, package version creation, `validate-delta.sh` against an org, and the `validate` and `release` workflow jobs. The Apex test that uses the `Minimum Access - Salesforce` profile assumes that profile exists in the org.

## License

MIT

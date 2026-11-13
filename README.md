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
| `scripts/` | `scratch.sh`, `validate-delta.sh` (runs `delta.js`), `lint-project.js`, `bootstrap-packages.sh`, `release.sh`. |

## Run it

```bash
npm install --global @salesforce/cli@2.158.7   # Node 20+ and Java 17+ needed
npm ci
npm run format:check && npm run lint && npm run test:lwc && npm run scan && npm run lint:project && npm run convert && npm run test:site
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

`scripts/validate-delta.sh <org> [base] [--select-tests] [--dry-run]` diffs against the base branch and runs `sf project deploy validate`. Nothing is deployed. The planning code is `site/lab.js`, the same file the website runs.

| Change | What it does |
|---|---|
| Added, modified | One `--source-dir` per file |
| Deleted class, trigger, permission set, or a whole LWC bundle | Written to `build/delta/destructiveChanges.xml` and sent with `--post-destructive-changes`, so the delete runs after the new code is in |
| Renamed | New name deployed, old name deleted. Without this the old component stays in the org |
| One file removed from an LWC bundle | Bundle redeployed, not deleted |
| Any other deleted or changed file type, once a delete is involved | Stops with exit 2. Only classes, triggers, LWC bundles and permission sets are mapped |
| `--select-tests` | `RunSpecifiedTests` with each changed class's `<Name>Test`. Falls back to `RunLocalTests` if any changed class has no matching test class |

On success the job id can go to `sf project deploy quick --job-id <id>` so tests do not run twice. Exit codes: 0 ok or nothing to do, 2 cannot build a manifest, 64 usage, 65 base ref not found.

Trade-off for `--select-tests`: it is faster, but a production deploy needs 75% coverage on each changed class from the tests you named, so a class covered only through another class's tests can fail there. The default stays `RunLocalTests`.

## Project lint

`npm run lint:project` checks what otherwise fails late: a class without its `-meta.xml`, an `apiVersion` that differs from `sourceApiVersion`, a package listed before the one it depends on, a bad `versionNumber`, a permission set naming a class that does not exist, an LWC importing Apex from a package it does not depend on, and an LWC calling a method that is not `@AuraEnabled`.

## CI

`ci.yml` job `offline` runs on every push and PR with no Salesforce credentials: Prettier (Apex through the Java parser), ESLint, Jest, PMD through Code Analyzer, the project lint, source conversion, tests for the planner and the script on a real git repo, shell syntax check.

Job `validate` runs only when the repo variable `SF_VALIDATE` is `true` and these secrets exist: `SF_JWT_KEY`, `SF_CLIENT_ID`, `SF_USERNAME` (sandbox). `release.yml` is manual and also needs `SF_DEVHUB_USERNAME`. JWT login needs a connected app with the matching certificate.

## What is checked and what is not

Checked locally and in CI: LWC Jest (3 tests), ESLint, Prettier, PMD (no violations at Moderate or above), the project lint, source to Metadata API conversion, `bash -n` on the scripts, and `validate-delta.sh` against a real git repo with a stubbed `sf` (modify, delete, rename, partial LWC delete, test selection).

Not run, because no Dev Hub or sandbox was connected: the Apex tests, scratch org creation, package version creation, `validate-delta.sh` against an org, and the `validate` and `release` workflow jobs. The Apex test that uses the `Minimum Access - Salesforce` profile assumes that profile exists in the org.

## License

MIT

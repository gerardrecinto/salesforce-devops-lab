#!/usr/bin/env node
/* Validate only the files changed since a base ref. Nothing is deployed.
   Usage: node scripts/delta.js <org> [base-ref] [--select-tests] [--dry-run]
   The planning logic lives in site/lab.js so the website runs the same code. */
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { planDelta } = require('../site/lab.js');

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const [org, base = 'origin/main'] = argv.filter((a) => !a.startsWith('--'));
if (!org) {
    console.error(
        'Usage: scripts/validate-delta.sh <org-alias> [base-ref] [--select-tests] [--dry-run]'
    );
    process.exit(64);
}

const root = path.join(__dirname, '..');
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' });

let diff;
try {
    diff = git(
        'diff',
        '--name-status',
        '-M',
        base + '...HEAD',
        '--',
        'core',
        'ui'
    );
} catch (e) {
    console.error(
        'git could not diff against "' +
            base +
            '". Fetch it first, for example: git fetch origin main'
    );
    process.exit(65);
}

function testClasses() {
    const out = [];
    const walk = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) walk(p);
            else if (
                /Test\.cls$/.test(e.name) &&
                p.includes(path.sep + 'classes' + path.sep)
            )
                out.push(e.name.replace(/\.cls$/, ''));
        }
    };
    for (const d of ['core', 'ui'])
        if (fs.existsSync(path.join(root, d))) walk(path.join(root, d));
    return out;
}

const project = JSON.parse(
    fs.readFileSync(path.join(root, 'sfdx-project.json'), 'utf8')
);
const plan = planDelta(diff, {
    base,
    org,
    apiVersion: project.sourceApiVersion,
    selectTests: flags.has('--select-tests'),
    testClasses: testClasses()
});

console.log(plan.message);
if (plan.outcome === 'nothing') process.exit(0);
if (plan.outcome === 'blocked') {
    for (const f of plan.unmappable || []) console.error('  ' + f);
    process.exit(plan.exitCode);
}
for (const [rel, body] of Object.entries(plan.files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
    console.log('wrote ' + rel);
}
for (const n of plan.notes) console.log('note: ' + n);
console.log(plan.command);
if (flags.has('--dry-run')) process.exit(0);
const r = spawnSync('sf', plan.args, { cwd: root, stdio: 'inherit' });
process.exit(r.status === null ? 1 : r.status);

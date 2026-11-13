const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { lintProject } = require('../scripts/lint-project.js');

const root = path.join(__dirname, '..');

function copyRepo() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-'));
    fs.cpSync(root, tmp, {
        recursive: true,
        filter: (s) => !/node_modules|\.git(\/|$)|build/.test(s)
    });
    return tmp;
}
const messages = (tmp) => lintProject(tmp).map((f) => f.message);

test('this project passes its own lint', () => {
    assert.deepEqual(lintProject(root), []);
});

test('a class without a -meta.xml is reported', () => {
    const tmp = copyRepo();
    fs.rmSync(
        path.join(tmp, 'core/main/default/classes/AccountSelector.cls-meta.xml')
    );
    assert.ok(messages(tmp).some((m) => /missing its -meta\.xml/.test(m)));
});

test('an apiVersion that differs from sourceApiVersion is reported', () => {
    const tmp = copyRepo();
    const f = path.join(
        tmp,
        'core/main/default/classes/AccountSelector.cls-meta.xml'
    );
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('62.0', '58.0'));
    assert.ok(
        messages(tmp).some((m) => /apiVersion 58\.0 does not match/.test(m))
    );
});

test('a package that depends on one listed after it is reported', () => {
    const tmp = copyRepo();
    const f = path.join(tmp, 'sfdx-project.json');
    const p = JSON.parse(fs.readFileSync(f, 'utf8'));
    p.packageDirectories.reverse();
    fs.writeFileSync(f, JSON.stringify(p));
    assert.ok(messages(tmp).some((m) => /must be listed before it/.test(m)));
});

test('an LWC that imports Apex from a package it does not depend on is reported', () => {
    const tmp = copyRepo();
    const f = path.join(tmp, 'sfdx-project.json');
    const p = JSON.parse(fs.readFileSync(f, 'utf8'));
    delete p.packageDirectories[1].dependencies;
    fs.writeFileSync(f, JSON.stringify(p));
    assert.ok(
        messages(tmp).some((m) => /does not depend on that package/.test(m))
    );
});

test('an LWC that calls a method that is not @AuraEnabled is reported', () => {
    const tmp = copyRepo();
    const f = path.join(
        tmp,
        'core/main/default/classes/AccountHealthController.cls'
    );
    fs.writeFileSync(
        f,
        fs.readFileSync(f, 'utf8').replace('@AuraEnabled(cacheable=true)', '')
    );
    assert.ok(messages(tmp).some((m) => /is not @AuraEnabled/.test(m)));
});

test('a permission set that names a missing class is reported', () => {
    const tmp = copyRepo();
    const f = path.join(
        tmp,
        'core/main/default/permissionsets/AccountHealth_User.permissionset-meta.xml'
    );
    fs.writeFileSync(
        f,
        fs.readFileSync(f, 'utf8').replace('AccountSelector', 'Ghost')
    );
    assert.ok(messages(tmp).some((m) => /Ghost, which does not exist/.test(m)));
});

test('a bad versionNumber is reported', () => {
    const tmp = copyRepo();
    const f = path.join(tmp, 'sfdx-project.json');
    fs.writeFileSync(
        f,
        fs.readFileSync(f, 'utf8').replace('"0.1.0.NEXT"', '"0.1.NEXT"')
    );
    assert.ok(messages(tmp).some((m) => /versionNumber "0\.1\.NEXT"/.test(m)));
});

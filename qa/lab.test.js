const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const os = require('node:os');
const { planDelta, checkApex } = require('../site/lab.js');

const root = path.join(__dirname, '..');

test('planDelta builds one source-dir per changed file', () => {
    const r = planDelta(
        'M\tcore/main/default/classes/AccountSelector.cls\nA\tui/main/default/lwc/x/x.js'
    );
    assert.equal(r.outcome, 'validate');
    assert.equal(r.changed.length, 2);
    assert.match(
        r.command,
        /--source-dir core\/main\/default\/classes\/AccountSelector\.cls --source-dir ui\/main\/default\/lwc\/x\/x\.js /
    );
    assert.deepEqual(r.touched, ['core', 'ui']);
    assert.ok(r.notes.some((n) => /ui depends on core/.test(n)));
});

test('planDelta blocks on a delete with exit code 2', () => {
    const r = planDelta('M\tcore/a.cls\nD\tcore/b.cls');
    assert.equal(r.outcome, 'blocked');
    assert.equal(r.exitCode, 2);
    assert.deepEqual(r.deleted, ['core/b.cls']);
    assert.equal(r.command, null);
});

test('planDelta ignores files outside core and ui and reports nothing to do', () => {
    const r = planDelta('M\tREADME.md\nM\tscripts/release.sh');
    assert.equal(r.outcome, 'nothing');
    assert.equal(r.ignored.length, 2);
});

test('planDelta uses the new path for a rename', () => {
    const r = planDelta('R100\tcore/old.cls\tcore/new.cls');
    assert.deepEqual(r.changed, ['core/new.cls']);
});

test('planDelta matches scripts/validate-delta.sh on a real repo', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-'));
    const git = (...a) =>
        execFileSync('git', a, { cwd: tmp, encoding: 'utf8' });
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 't');
    fs.mkdirSync(path.join(tmp, 'core'));
    fs.mkdirSync(path.join(tmp, 'ui'));
    fs.writeFileSync(path.join(tmp, 'core/a.cls'), 'a');
    fs.writeFileSync(path.join(tmp, 'ui/b.js'), 'b');
    fs.writeFileSync(path.join(tmp, 'notes.md'), 'n');
    git('add', '-A');
    git('commit', '-qm', 'base');
    git('checkout', '-qb', 'feature');
    fs.writeFileSync(path.join(tmp, 'core/a.cls'), 'a2');
    fs.writeFileSync(path.join(tmp, 'core/c.cls'), 'c');
    fs.writeFileSync(path.join(tmp, 'notes.md'), 'n2');
    git('add', '-A');
    git('commit', '-qm', 'change');
    const bin = path.join(tmp, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'sf'), '#!/bin/sh\necho "sf $@"\n', {
        mode: 0o755
    });
    const script = path.join(root, 'scripts/validate-delta.sh');
    const env = {
        ...process.env,
        PATH: bin + path.delimiter + process.env.PATH
    };
    const shell = execFileSync('bash', [script, 'org', 'main'], {
        cwd: tmp,
        env,
        encoding: 'utf8'
    }).trim();
    const ns = git('diff', '--name-status', 'main...HEAD');
    assert.equal(
        planDelta(ns, 'main').command.replace('<org>', 'org'),
        shell.replace(/^sf /, 'sf ')
    );
});

test('checkApex flags SOQL and DML in loops but not a query-for loop header', () => {
    const bad = `public with sharing class X {
  void f(List<Account> as) {
    for (Account a : as) {
      Contact c = [SELECT Id FROM Contact WITH USER_MODE LIMIT 1];
      update a;
    }
    for (Account a : [SELECT Id FROM Account WITH USER_MODE]) { a.Name = 'x'; }
  }
}`;
    const f = checkApex(bad);
    assert.deepEqual(
        f.map((x) => x.rule + ':' + x.line),
        ['APX001:4', 'APX002:5']
    );
});

test('checkApex flags missing security mode, injection, hard-coded Id, sharing and bare assert', () => {
    const src = `public class Y {
  void f(String n) {
    List<Account> a = [SELECT Id FROM Account];
    Database.query('SELECT Id FROM Account WHERE Name = \\'' + n + '\\'');
    Id rt = '012A0000000ABCDxyz';
    System.assertEquals(1, 1);
  }
}`;
    const rules = checkApex(src)
        .map((x) => x.rule)
        .sort();
    assert.deepEqual(rules, ['APX003', 'APX004', 'APX005', 'APX006', 'APX007']);
});

test('checkApex ignores strings and comments', () => {
    const src = `public with sharing class Z {
  // for (Integer i = 0; i < 1; i++) { [SELECT Id FROM Account]; }
  String s = 'for (;;) { insert a; }';
}`;
    assert.deepEqual(checkApex(src), []);
});

test("this repo's own Apex has no findings", () => {
    const dir = path.join(root, 'core/main/default/classes');
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.cls'))) {
        const found = checkApex(fs.readFileSync(path.join(dir, f), 'utf8'));
        assert.deepEqual(found, [], f + ' ' + JSON.stringify(found));
    }
});

test('index.html has the metadata a link preview needs', () => {
    const h = fs.readFileSync(path.join(root, 'site/index.html'), 'utf8');
    for (const needle of [
        '<title>',
        'rel="canonical"',
        'og:image',
        'twitter:card',
        'name="description"',
        'lang="en"'
    ])
        assert.ok(h.includes(needle), needle);
    assert.ok(fs.existsSync(path.join(root, 'site/og.png')));
    assert.ok(!/—/.test(h), 'no em dashes');
});

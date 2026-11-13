const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
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

test('planDelta turns a deleted class into a post-destructive manifest', () => {
    const r = planDelta(
        'M\tcore/main/default/classes/A.cls\nD\tcore/main/default/classes/B.cls\nD\tcore/main/default/classes/B.cls-meta.xml',
        { org: 'o' }
    );
    assert.equal(r.outcome, 'validate');
    assert.equal(r.mode, 'manifest');
    assert.deepEqual(r.destructive, [{ type: 'ApexClass', member: 'B' }]);
    assert.match(
        r.files['build/delta/destructiveChanges.xml'],
        /<members>B<\/members>/
    );
    assert.match(r.files['build/delta/package.xml'], /<members>A<\/members>/);
    assert.doesNotMatch(r.files['build/delta/package.xml'], /<members>B</);
    assert.match(
        r.command,
        /--manifest build\/delta\/package\.xml --post-destructive-changes build\/delta\/destructiveChanges\.xml/
    );
});

test('planDelta treats a rename as add new plus delete old', () => {
    const r = planDelta(
        'R100\tcore/main/default/classes/Old.cls\tcore/main/default/classes/New.cls',
        { org: 'o' }
    );
    assert.deepEqual(r.destructive, [{ type: 'ApexClass', member: 'Old' }]);
    assert.match(r.files['build/delta/package.xml'], /<members>New<\/members>/);
});

test('planDelta does not delete an LWC bundle when only one of its files is removed', () => {
    const r = planDelta('D\tui/main/default/lwc/x/x.css', { org: 'o' });
    assert.deepEqual(r.destructive, []);
    assert.match(
        r.files['build/delta/package.xml'],
        /LightningComponentBundle/
    );
    const all = planDelta(
        'D\tui/main/default/lwc/x/x.js\nD\tui/main/default/lwc/x/x.js-meta.xml\nD\tui/main/default/lwc/x/x.html',
        { org: 'o' }
    );
    assert.deepEqual(all.destructive, [
        { type: 'LightningComponentBundle', member: 'x' }
    ]);
});

test('planDelta does not delete a component that is re-added under the same name', () => {
    const r = planDelta(
        'D\tcore/main/default/classes/A.cls\nA\tcore/main/default/classes/A.cls',
        { org: 'o' }
    );
    assert.deepEqual(r.destructive, []);
});

test('planDelta stops with exit 2 when a deleted file has no manifest mapping', () => {
    const r = planDelta(
        'D\tcore/main/default/objects/Thing__c/Thing__c.object-meta.xml',
        { org: 'o' }
    );
    assert.equal(r.outcome, 'blocked');
    assert.equal(r.exitCode, 2);
    assert.equal(r.command, null);
});

test('planDelta picks matching test classes only when every changed class has one', () => {
    const ok = planDelta('M\tcore/main/default/classes/AccountSelector.cls', {
        org: 'o',
        selectTests: true,
        testClasses: ['AccountSelectorTest']
    });
    assert.match(
        ok.command,
        /--test-level RunSpecifiedTests --tests AccountSelectorTest/
    );
    const miss = planDelta('M\tcore/main/default/classes/Lonely.cls', {
        org: 'o',
        selectTests: true,
        testClasses: ['AccountSelectorTest']
    });
    assert.match(miss.command, /--test-level RunLocalTests/);
    assert.ok(miss.notes.some((n) => /Lonely has no LonelyTest/.test(n)));
    const lwc = planDelta('M\tui/main/default/lwc/x/x.js', {
        org: 'o',
        selectTests: true,
        testClasses: []
    });
    assert.match(lwc.command, /RunLocalTests/);
});

test('planDelta keeps a path with a space as one argument and quotes it in the printed command', () => {
    const r = planDelta('M\tcore/main/default/staticresources/My File.txt', {
        org: 'o'
    });
    assert.ok(r.args.includes('core/main/default/staticresources/My File.txt'));
    assert.ok(
        r.command.includes(
            "--source-dir 'core/main/default/staticresources/My File.txt'"
        )
    );
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

function fixtureRepo() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-'));
    const git = (...a) =>
        execFileSync('git', a, { cwd: tmp, encoding: 'utf8' });
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 't');
    fs.mkdirSync(path.join(tmp, 'scripts'));
    fs.mkdirSync(path.join(tmp, 'site'));
    fs.copyFileSync(
        path.join(root, 'scripts/delta.js'),
        path.join(tmp, 'scripts/delta.js')
    );
    fs.copyFileSync(
        path.join(root, 'site/lab.js'),
        path.join(tmp, 'site/lab.js')
    );
    fs.copyFileSync(
        path.join(root, 'sfdx-project.json'),
        path.join(tmp, 'sfdx-project.json')
    );
    const cls = path.join(tmp, 'core/main/default/classes');
    fs.mkdirSync(cls, { recursive: true });
    for (const n of ['A', 'ATest', 'Gone', 'Old']) {
        fs.writeFileSync(path.join(cls, n + '.cls'), n);
        fs.writeFileSync(path.join(cls, n + '.cls-meta.xml'), '<m/>');
    }
    fs.writeFileSync(path.join(tmp, 'notes.md'), 'n');
    git('add', '-A');
    git('commit', '-qm', 'base');
    git('checkout', '-qb', 'feature');
    fs.writeFileSync(path.join(cls, 'A.cls'), 'A2');
    fs.rmSync(path.join(cls, 'Gone.cls'));
    fs.rmSync(path.join(cls, 'Gone.cls-meta.xml'));
    fs.renameSync(path.join(cls, 'Old.cls'), path.join(cls, 'New.cls'));
    fs.renameSync(
        path.join(cls, 'Old.cls-meta.xml'),
        path.join(cls, 'New.cls-meta.xml')
    );
    fs.writeFileSync(path.join(tmp, 'notes.md'), 'n2');
    git('add', '-A');
    git('commit', '-qm', 'change');
    const bin = path.join(tmp, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(
        path.join(bin, 'sf'),
        '#!/bin/sh\nfor a in "$@"; do echo "ARG:$a"; done\nexit 7\n',
        { mode: 0o755 }
    );
    const env = {
        ...process.env,
        PATH: bin + path.delimiter + process.env.PATH
    };
    return { tmp, env };
}

test('scripts/delta.js plans and runs the same command the site shows, with real git renames and deletes', () => {
    const { tmp, env } = fixtureRepo();
    const run = (...a) =>
        spawnSync('node', ['scripts/delta.js', ...a], {
            cwd: tmp,
            env,
            encoding: 'utf8'
        });
    const dry = run('myorg', 'main', '--dry-run');
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(
        dry.stdout,
        /--manifest build\/delta\/package\.xml --post-destructive-changes/
    );
    const del = fs.readFileSync(
        path.join(tmp, 'build/delta/destructiveChanges.xml'),
        'utf8'
    );
    assert.match(del, /<members>Gone<\/members>/);
    assert.match(del, /<members>Old<\/members>/);
    const pkg = fs.readFileSync(
        path.join(tmp, 'build/delta/package.xml'),
        'utf8'
    );
    assert.match(pkg, /<members>A<\/members>/);
    assert.match(pkg, /<members>New<\/members>/);
    assert.doesNotMatch(pkg, /Gone|Old/);
    const real = run('myorg', 'main', '--select-tests');
    assert.equal(real.status, 7, 'exit code of sf is passed through');
    assert.equal(
        real.stdout.match(/New has no NewTest/g).length,
        1,
        'fallback note appears once'
    );
    assert.match(real.stdout, /ARG:RunLocalTests/);
    assert.match(real.stdout, /ARG:--target-org\nARG:myorg/);
});

test('scripts/delta.js explains a missing base ref instead of a stack trace', () => {
    const { tmp, env } = fixtureRepo();
    const r = spawnSync('node', ['scripts/delta.js', 'myorg', 'origin/nope'], {
        cwd: tmp,
        env,
        encoding: 'utf8'
    });
    assert.equal(r.status, 65);
    assert.match(r.stderr, /git fetch origin main/);
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

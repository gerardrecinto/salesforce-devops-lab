/* Browser versions of two repo behaviors. No dependencies, works in Node and the browser.
   planDelta mirrors scripts/validate-delta.sh. checkApex is a small subset of what PMD checks in CI. */
(function (root, factory) {
    if (typeof module === 'object' && module.exports)
        module.exports = factory();
    else root.Lab = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    const PACKAGES = ['core', 'ui'];

    const TYPES = [
        'ApexClass',
        'ApexTrigger',
        'LightningComponentBundle',
        'PermissionSet'
    ];

    /* Map a source path to the metadata component it belongs to, or null if unsupported. */
    function componentOf(path) {
        let m;
        if ((m = path.match(/\/classes\/([^/]+)\.cls(-meta\.xml)?$/)))
            return {
                type: 'ApexClass',
                member: m[1],
                main: !m[2] || undefined
            };
        if ((m = path.match(/\/triggers\/([^/]+)\.trigger(-meta\.xml)?$/)))
            return {
                type: 'ApexTrigger',
                member: m[1],
                main: !m[2] || undefined
            };
        if ((m = path.match(/\/lwc\/([^/]+)\/(.+)$/))) {
            if (m[2].startsWith('__tests__/')) return null;
            return {
                type: 'LightningComponentBundle',
                member: m[1],
                main: m[2] === m[1] + '.js-meta.xml'
            };
        }
        if (
            (m = path.match(
                /\/permissionsets\/([^/]+)\.permissionset-meta\.xml$/
            ))
        )
            return { type: 'PermissionSet', member: m[1], main: true };
        return null;
    }

    function quote(a) {
        return /^[\w@%+=:,./<>-]+$/.test(a)
            ? a
            : "'" + a.replace(/'/g, "'\\''") + "'";
    }

    function manifestXml(components, apiVersion) {
        const byType = {};
        for (const c of components)
            (byType[c.type] = byType[c.type] || new Set()).add(c.member);
        let x =
            '<?xml version="1.0" encoding="UTF-8"?>\n<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n';
        for (const t of TYPES) {
            if (!byType[t]) continue;
            x += '    <types>\n';
            for (const mem of [...byType[t]].sort())
                x += '        <members>' + mem + '</members>\n';
            x += '        <name>' + t + '</name>\n    </types>\n';
        }
        return x + '    <version>' + apiVersion + '</version>\n</Package>\n';
    }

    /* opts: { base, org, apiVersion, selectTests, testClasses } */
    function planDelta(text, optsOrBase) {
        const opts =
            typeof optsOrBase === 'string'
                ? { base: optsOrBase }
                : optsOrBase || {};
        const ref = opts.base || 'origin/main';
        const org = opts.org || '<org>';
        const apiVersion = opts.apiVersion || '62.0';
        const changed = [];
        const removed = [];
        const ignored = [];
        for (const raw of String(text).split('\n')) {
            const line = raw.trim();
            if (!line) continue;
            const parts = raw.includes('\t')
                ? raw.trim().split('\t')
                : line.split(/\s+/);
            const status = parts[0][0];
            const path = parts[parts.length - 1];
            if (!/^[ACDMRTUXB]$/.test(status) || parts.length < 2) {
                ignored.push({ line, why: 'not a git name-status line' });
                continue;
            }
            const inScope = (p) => PACKAGES.includes(p.split('/')[0]);
            if (status === 'R' && parts.length >= 3 && inScope(parts[1]))
                removed.push(parts[1]);
            if (!inScope(path)) {
                ignored.push({ line, why: 'outside core/ and ui/' });
                continue;
            }
            if (status === 'D') removed.push(path);
            else if ('ACMR'.includes(status)) changed.push(path);
            else
                ignored.push({
                    line,
                    why: 'status ' + status + ' is not validated'
                });
        }
        const touched = PACKAGES.filter((p) =>
            changed.some((f) => f.split('/')[0] === p)
        );
        const base = {
            changed,
            ignored,
            touched,
            base: ref,
            files: {},
            destructive: [],
            notes: []
        };

        if (!changed.length && !removed.length)
            return {
                ...base,
                outcome: 'nothing',
                exitCode: 0,
                command: null,
                args: null,
                message: 'No changes under core/ or ui/. Nothing to validate.'
            };

        /* A deleted file removes a component only when its main file goes. */
        const newMembers = new Set(
            changed
                .map(componentOf)
                .filter(Boolean)
                .map((c) => c.type + ':' + c.member)
        );
        const destructive = [];
        const partial = [];
        const unmappable = [];
        for (const p of removed) {
            const c = componentOf(p);
            if (!c) {
                unmappable.push(p);
                continue;
            }
            const key = c.type + ':' + c.member;
            if (c.main) {
                if (
                    !newMembers.has(key) &&
                    !destructive.some(
                        (d) => d.type === c.type && d.member === c.member
                    )
                )
                    destructive.push({ type: c.type, member: c.member });
            } else if (
                c.type === 'LightningComponentBundle' &&
                !removed.some((q) => {
                    const o = componentOf(q);
                    return (
                        o &&
                        o.main &&
                        o.type === c.type &&
                        o.member === c.member
                    );
                })
            ) {
                partial.push({ type: c.type, member: c.member });
            }
        }

        let testArgs = ['--test-level', 'RunLocalTests'];
        const notes = [];
        if (opts.selectTests) {
            const avail = new Set(opts.testClasses || []);
            const wanted = new Set();
            let ok = true;
            const classes = new Set(
                changed
                    .map(componentOf)
                    .filter((x) => x && x.type === 'ApexClass')
                    .map((x) => x.member)
            );
            for (const name of [...classes].sort()) {
                if (/Test$/.test(name)) wanted.add(name);
                else if (avail.has(name + 'Test')) wanted.add(name + 'Test');
                else {
                    ok = false;
                    notes.push(
                        name +
                            ' has no ' +
                            name +
                            'Test class, so all local tests run.'
                    );
                }
            }
            if (ok && wanted.size) {
                testArgs = ['--test-level', 'RunSpecifiedTests'];
                for (const t of [...wanted].sort()) testArgs.push('--tests', t);
                notes.push(
                    'Only the matching test classes run. A production deploy still needs 75% coverage on each changed class from those tests.'
                );
            } else if (ok)
                notes.push('No Apex class changed, so all local tests run.');
        }

        const files = {};
        let args;
        let mode;
        if (destructive.length || partial.length || unmappable.length) {
            mode = 'manifest';
            const bad = unmappable.concat(
                changed.filter((f) => !componentOf(f) && !/__tests__\//.test(f))
            );
            if (bad.length)
                return {
                    ...base,
                    deleted: removed,
                    outcome: 'blocked',
                    exitCode: 2,
                    command: null,
                    args: null,
                    message:
                        'Cannot build a manifest for ' +
                        bad.length +
                        ' file' +
                        (bad.length === 1 ? '' : 's') +
                        ': only classes, triggers, LWC bundles and permission sets are mapped. Split the change or extend the mapping.',
                    unmappable: bad
                };
            const members = changed
                .map(componentOf)
                .filter(Boolean)
                .concat(partial);
            files['build/delta/package.xml'] = manifestXml(members, apiVersion);
            files['build/delta/destructiveChanges.xml'] = manifestXml(
                destructive,
                apiVersion
            );
            args = [
                'project',
                'deploy',
                'validate',
                '--manifest',
                'build/delta/package.xml',
                '--post-destructive-changes',
                'build/delta/destructiveChanges.xml',
                '--target-org',
                org,
                ...testArgs,
                '--wait',
                '30'
            ];
            notes.unshift(
                'Deletes run after the deploy (post-destructive), so code that referenced the removed component is already updated.'
            );
        } else {
            mode = 'source';
            args = ['project', 'deploy', 'validate'];
            for (const f of changed) args.push('--source-dir', f);
            args.push('--target-org', org, ...testArgs, '--wait', '30');
        }

        if (touched.includes('ui'))
            notes.push(
                'ui depends on core. The validation org needs core deployed first, or include core in the change.'
            );
        if (changed.some((f) => /permissionsets\//.test(f)))
            notes.push(
                'A permission set changed. Re-test as a user without it, not only as an admin.'
            );
        notes.push(
            'On success the job id can be passed to "sf project deploy quick --job-id <id>" so tests are not run twice.'
        );
        const total = changed.length;
        return {
            ...base,
            outcome: 'validate',
            mode,
            exitCode: 0,
            deleted: removed,
            destructive,
            files,
            args,
            command: 'sf ' + args.map(quote).join(' '),
            message:
                total +
                ' file' +
                (total === 1 ? '' : 's') +
                ' to validate against ' +
                ref +
                (destructive.length
                    ? ', ' +
                      destructive.length +
                      ' component' +
                      (destructive.length === 1 ? '' : 's') +
                      ' to delete.'
                    : '.'),
            notes
        };
    }

    /* Replace comments and string contents with spaces so structure checks do not trip on them. */
    function mask(src) {
        let out = '';
        let i = 0;
        while (i < src.length) {
            const c = src[i];
            const n = src[i + 1];
            if (c === '/' && n === '/') {
                while (i < src.length && src[i] !== '\n') {
                    out += ' ';
                    i++;
                }
            } else if (c === '/' && n === '*') {
                out += '  ';
                i += 2;
                while (
                    i < src.length &&
                    !(src[i] === '*' && src[i + 1] === '/')
                ) {
                    out += src[i] === '\n' ? '\n' : ' ';
                    i++;
                }
                out += '  ';
                i += 2;
            } else if (c === "'") {
                out += "'";
                i++;
                while (i < src.length && src[i] !== "'") {
                    if (src[i] === '\\') {
                        out += '  ';
                        i += 2;
                        continue;
                    }
                    out += src[i] === '\n' ? '\n' : ' ';
                    i++;
                }
                out += "'";
                i++;
            } else {
                out += c;
                i++;
            }
        }
        return out;
    }

    function lineOf(src, idx) {
        let n = 1;
        for (let i = 0; i < idx; i++) if (src[i] === '\n') n++;
        return n;
    }

    function matchParen(s, open) {
        let d = 0;
        for (let i = open; i < s.length; i++) {
            if (s[i] === '(') d++;
            else if (s[i] === ')') {
                d--;
                if (d === 0) return i;
            }
        }
        return -1;
    }

    function topLevelArgs(s) {
        const args = [];
        let d = 0,
            cur = '';
        for (const ch of s) {
            if ('([{'.includes(ch)) d++;
            if (')]}'.includes(ch)) d--;
            if (ch === ',' && d === 0) {
                args.push(cur);
                cur = '';
            } else cur += ch;
        }
        if (cur.trim()) args.push(cur);
        return args;
    }

    /* Returns [start, end) body ranges of for/while/do loops. */
    function loopBodies(m) {
        const ranges = [];
        const re = /\b(for|while)\s*\(/g;
        let hit;
        while ((hit = re.exec(m))) {
            const open = m.indexOf('(', hit.index);
            const close = matchParen(m, open);
            if (close < 0) continue;
            let j = close + 1;
            while (/\s/.test(m[j] || '')) j++;
            if (m[j] === '{') {
                let d = 0,
                    k = j;
                for (; k < m.length; k++) {
                    if (m[k] === '{') d++;
                    else if (m[k] === '}') {
                        d--;
                        if (d === 0) break;
                    }
                }
                ranges.push([j, k]);
            } else {
                const semi = m.indexOf(';', j);
                ranges.push([j, semi < 0 ? m.length : semi]);
            }
        }
        const doRe = /\bdo\s*\{/g;
        while ((hit = doRe.exec(m))) {
            const j = m.indexOf('{', hit.index);
            let d = 0,
                k = j;
            for (; k < m.length; k++) {
                if (m[k] === '{') d++;
                else if (m[k] === '}') {
                    d--;
                    if (d === 0) break;
                }
            }
            ranges.push([j, k]);
        }
        return ranges;
    }

    function checkApex(src) {
        const m = mask(src);
        const out = [];
        const add = (rule, severity, idx, message, fix) =>
            out.push({ rule, severity, line: lineOf(src, idx), message, fix });
        const isTestClass = /@IsTest\b[\s\S]*?\bclass\b/i.test(
            m.slice(0, m.search(/\bclass\b/) + 5)
        );
        const loops = loopBodies(m);
        const inLoop = (idx) => loops.some(([a, b]) => idx > a && idx < b);

        let hit;
        const soql = /\[\s*SELECT\b[^\]]*\]/gi;
        while ((hit = soql.exec(m))) {
            if (inLoop(hit.index))
                add(
                    'APX001',
                    'error',
                    hit.index,
                    'SOQL query inside a loop. It runs once per iteration and hits the 100 query limit.',
                    'Query once before the loop into a Map keyed by Id.'
                );
            if (
                !isTestClass &&
                !/WITH\s+(USER_MODE|SECURITY_ENFORCED)/i.test(hit[0])
            )
                add(
                    'APX003',
                    'warning',
                    hit.index,
                    'Query does not enforce field and object security.',
                    'Add WITH USER_MODE.'
                );
        }
        const dml =
            /(^|[;{}\s])(insert|update|delete|upsert|undelete)\s+[A-Za-z_]|\bDatabase\.(insert|update|delete|upsert)\s*\(/g;
        while ((hit = dml.exec(m))) {
            const idx = hit.index + (hit[1] ? hit[1].length : 0);
            if (inLoop(idx))
                add(
                    'APX002',
                    'error',
                    idx,
                    'DML inside a loop. It hits the 150 DML statement limit on a large batch.',
                    'Collect records in a List and run one DML after the loop.'
                );
        }
        const dq = /\bDatabase\.(?:query|countQuery)\s*\(/g;
        while ((hit = dq.exec(m))) {
            const open = m.indexOf('(', hit.index);
            const close = matchParen(m, open);
            const arg = close > 0 ? m.slice(open + 1, close) : '';
            if (arg.includes('+'))
                add(
                    'APX007',
                    'error',
                    hit.index,
                    'Dynamic SOQL built by string concatenation. This allows SOQL injection.',
                    'Use bind variables with Database.queryWithBinds, or String.escapeSingleQuotes at minimum.'
                );
        }
        const ids = /'(0[0-9A-Za-z]{2}[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?)'/g;
        const rawMasked = src;
        while ((hit = ids.exec(rawMasked))) {
            if (m[hit.index] !== "'") continue;
            if (
                /\d/.test(hit[1]) &&
                /[A-Za-z]/.test(hit[1]) &&
                !/\s/.test(hit[1])
            )
                add(
                    'APX005',
                    'warning',
                    hit.index,
                    'Hard-coded Salesforce Id. It differs between orgs and breaks on deploy.',
                    'Query by DeveloperName or use a Custom Metadata record.'
                );
        }
        const cls =
            /\b(?:public|global|private)\s+(?:virtual\s+|abstract\s+)?class\s+\w+/g;
        while ((hit = cls.exec(m))) {
            const before = m.slice(
                Math.max(
                    0,
                    m.lastIndexOf('\n', m.lastIndexOf('\n', hit.index) - 1)
                ),
                hit.index + hit[0].length
            );
            const header = m.slice(hit.index, m.indexOf('{', hit.index));
            if (/@IsTest/i.test(before)) continue;
            if (!/\b(with|without|inherited)\s+sharing\b/i.test(header))
                add(
                    'APX004',
                    'warning',
                    hit.index,
                    "Class has no sharing keyword. It runs with the caller's default, which is easy to get wrong.",
                    'Declare "with sharing", or "inherited sharing" for a utility.'
                );
        }
        const as = /\bSystem\.assert(Equals|NotEquals)\s*\(/g;
        while ((hit = as.exec(m))) {
            const open = m.indexOf('(', hit.index);
            const close = matchParen(m, open);
            if (close > 0 && topLevelArgs(m.slice(open + 1, close)).length < 3)
                add(
                    'APX006',
                    'info',
                    hit.index,
                    'Assertion has no message. A failure in a deploy log will not say what broke.',
                    'Add a third argument that states the expectation.'
                );
        }
        out.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
        return out;
    }

    return { planDelta, checkApex, componentOf };
});

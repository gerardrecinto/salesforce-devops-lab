/* Browser versions of two repo behaviors. No dependencies, works in Node and the browser.
   planDelta mirrors scripts/validate-delta.sh. checkApex is a small subset of what PMD checks in CI. */
(function (root, factory) {
    if (typeof module === 'object' && module.exports)
        module.exports = factory();
    else root.Lab = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    const PACKAGES = ['core', 'ui'];

    function planDelta(text, base) {
        const ref = base || 'origin/main';
        const changed = [];
        const deleted = [];
        const ignored = [];
        const lines = String(text).split('\n');
        for (const raw of lines) {
            const line = raw.trim();
            if (!line) continue;
            const parts = line.split(/\s+/);
            const status = parts[0][0];
            const path = parts[parts.length - 1];
            if (!/^[ACDMRTUXB]$/.test(status) || parts.length < 2) {
                ignored.push({ line, why: 'not a git name-status line' });
                continue;
            }
            const top = path.split('/')[0];
            if (!PACKAGES.includes(top)) {
                ignored.push({ line, why: 'outside core/ and ui/' });
                continue;
            }
            if (status === 'D') deleted.push(path);
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
        if (deleted.length) {
            return {
                outcome: 'blocked',
                exitCode: 2,
                changed,
                deleted,
                ignored,
                touched,
                message:
                    'Deleted files need a destructiveChanges manifest, not a source deploy. The script stops here.',
                command: null,
                notes: []
            };
        }
        if (!changed.length) {
            return {
                outcome: 'nothing',
                exitCode: 0,
                changed,
                deleted,
                ignored,
                touched,
                message: 'No changes under core/ or ui/. Nothing to validate.',
                command: null,
                notes: []
            };
        }
        const args = changed.map((f) => '--source-dir ' + f).join(' ');
        const notes = [];
        if (touched.includes('ui'))
            notes.push(
                'ui depends on core. The validation org needs core deployed first, or include core in the change.'
            );
        if (changed.some((f) => /permissionsets\//.test(f)))
            notes.push(
                'A permission set changed. Re-test as a user without it, not only as an admin.'
            );
        if (
            changed.some(
                (f) => /\.cls$/.test(f) && !changed.includes(f + '-meta.xml')
            )
        )
            notes.push(
                'Apex class without its -meta.xml in the diff. That is fine if only the code changed.'
            );
        notes.push(
            'On success the job id can be passed to "sf project deploy quick --job-id <id>" so tests are not run twice.'
        );
        return {
            outcome: 'validate',
            exitCode: 0,
            changed,
            deleted,
            ignored,
            touched,
            base: ref,
            message:
                changed.length +
                ' file' +
                (changed.length === 1 ? '' : 's') +
                ' to validate against ' +
                ref +
                '.',
            command:
                'sf project deploy validate ' +
                args +
                ' --target-org <org> --test-level RunLocalTests --wait 30',
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

    return { planDelta, checkApex };
});

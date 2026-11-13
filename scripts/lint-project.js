#!/usr/bin/env node
/* Offline checks for things that only fail at package version create time or in an org.
   Usage: node scripts/lint-project.js [project-root] */
const fs = require('node:fs');
const path = require('node:path');

function walk(dir, out = []) {
    if (!fs.existsSync(dir)) return out;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, out);
        else out.push(p);
    }
    return out;
}

function lintProject(root) {
    const findings = [];
    const add = (file, message) =>
        findings.push({ file: path.relative(root, file) || file, message });
    const projectFile = path.join(root, 'sfdx-project.json');
    const project = JSON.parse(fs.readFileSync(projectFile, 'utf8'));
    const dirs = project.packageDirectories || [];
    const api = project.sourceApiVersion;

    const names = new Map();
    const seenPackages = new Set();
    const classOwner = new Map();
    const allowed = new Map();

    dirs.forEach((d, i) => {
        if (!fs.existsSync(path.join(root, d.path)))
            add(projectFile, `package directory "${d.path}" does not exist`);
        if (d.package) {
            if (names.has(d.package))
                add(projectFile, `package name "${d.package}" is used twice`);
            names.set(d.package, d.path);
            if (!/^\d+\.\d+\.\d+\.(NEXT|\d+)$/.test(d.versionNumber || ''))
                add(
                    projectFile,
                    `${d.package}: versionNumber "${d.versionNumber}" must look like 0.1.0.NEXT`
                );
        }
        const deps = [];
        for (const dep of d.dependencies || []) {
            if (!seenPackages.has(dep.package))
                add(
                    projectFile,
                    `${d.path}: depends on "${dep.package}", which must be listed before it in packageDirectories`
                );
            if (
                dep.versionNumber &&
                !/^\d+\.\d+\.\d+\.(LATEST|\d+)$/.test(dep.versionNumber)
            )
                add(
                    projectFile,
                    `${d.path}: dependency ${dep.package} versionNumber "${dep.versionNumber}" is not valid`
                );
            if (names.get(dep.package)) deps.push(names.get(dep.package));
        }
        if (d.package) seenPackages.add(d.package);
        allowed.set(
            d.path,
            new Set([
                d.path,
                ...deps.flatMap((x) => [...(allowed.get(x) || [x])])
            ])
        );
    });

    for (const d of dirs) {
        for (const f of walk(path.join(root, d.path))) {
            const m = f.match(/\/classes\/([^/]+)\.cls$/);
            if (m) classOwner.set(m[1], d.path);
        }
    }

    for (const d of dirs) {
        for (const f of walk(path.join(root, d.path))) {
            const rel = f.replace(/\\/g, '/');
            if (/\.(cls|trigger)$/.test(rel) && !fs.existsSync(f + '-meta.xml'))
                add(f, 'missing its -meta.xml file');
            if (
                /\.(cls|trigger)-meta\.xml$/.test(rel) ||
                /\.js-meta\.xml$/.test(rel)
            ) {
                const v = (fs
                    .readFileSync(f, 'utf8')
                    .match(/<apiVersion>([^<]+)<\/apiVersion>/) || [])[1];
                if (v && api && v !== api)
                    add(
                        f,
                        `apiVersion ${v} does not match sourceApiVersion ${api}`
                    );
            }
            if (/\.permissionset-meta\.xml$/.test(rel)) {
                const xml = fs.readFileSync(f, 'utf8');
                for (const m of xml.matchAll(
                    /<apexClass>([^<]+)<\/apexClass>/g
                )) {
                    const owner = classOwner.get(m[1]);
                    if (!owner)
                        add(
                            f,
                            `references Apex class ${m[1]}, which does not exist`
                        );
                    else if (!allowed.get(d.path).has(owner))
                        add(
                            f,
                            `references ${m[1]} in "${owner}", which is not a dependency of "${d.path}"`
                        );
                }
            }
            if (/\/lwc\/.+\.js$/.test(rel) && !/__tests__/.test(rel)) {
                const src = fs.readFileSync(f, 'utf8');
                for (const m of src.matchAll(
                    /@salesforce\/apex\/(\w+)\.(\w+)/g
                )) {
                    const owner = classOwner.get(m[1]);
                    if (!owner)
                        add(
                            f,
                            `imports Apex ${m[1]}.${m[2]}, but class ${m[1]} does not exist`
                        );
                    else if (!allowed.get(d.path).has(owner))
                        add(
                            f,
                            `imports ${m[1]} from "${owner}", but "${d.path}" does not depend on that package`
                        );
                    else {
                        const body = fs
                            .readFileSync(
                                path.join(
                                    root,
                                    owner,
                                    'main/default/classes',
                                    m[1] + '.cls'
                                ),
                                'utf8'
                            )
                            .replace(/\s+/g, ' ');
                        if (
                            !new RegExp(
                                `@AuraEnabled[^;{]*\\b${m[2]}\\s*\\(`
                            ).test(body)
                        )
                            add(
                                f,
                                `${m[1]}.${m[2]} is not @AuraEnabled, so the component cannot call it`
                            );
                    }
                }
            }
        }
    }
    return findings;
}

module.exports = { lintProject };

if (require.main === module) {
    const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
    const findings = lintProject(root);
    for (const f of findings) console.error(`${f.file}: ${f.message}`);
    console.log(
        findings.length ? `${findings.length} problem(s)` : 'project lint: ok'
    );
    process.exit(findings.length ? 1 : 0);
}

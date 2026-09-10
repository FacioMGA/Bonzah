#!/usr/bin/env node
/**
 * CHAMPS guard — ProductLaunchDraft isolation (ADR-0037).
 *
 * Enforces the canonical-ownership row "Product launch staging":
 * `ProductLaunchDraft` is read/written ONLY inside
 * `backend/modules/configuration/`. Any import of the Prisma delegate
 * or the domain type outside that module is drift — runtime config
 * reads must flow from canonical Program / Binder / Tenant rows, not
 * from the workflow draft.
 *
 * Modes: --strict (CI) exits 1; default reports only.
 */
import fs from 'node:fs';
import path from 'node:path';

const STRICT = process.argv.includes('--strict');
const ROOT = process.cwd();

const SCAN_ROOTS = [
    path.join(ROOT, 'backend'),
    path.join(ROOT, 'frontend'),
    path.join(ROOT, 'packages'),
    path.join(ROOT, 'tools'),
];
const ALLOWED_ROOT = path.join(ROOT, 'backend/modules/configuration');
// The Prisma extension file is allowed to enumerate the model name in
// the TENANT_SCOPED_MODELS set.
const ALLOWED_FILE_EXCEPTIONS = new Set([
    path.join(ROOT, 'backend/platform/db/tenantExtension.ts'),
    // The guard itself names the model in its docstring + regex.
    path.join(ROOT, 'tools/quality/check-product-launch-draft-isolation.mjs'),
    // Prisma schema obviously declares the model.
    path.join(ROOT, 'prisma/schema.prisma'),
]);

const PATTERNS = [
    /\bproductLaunchDraft\b/, // Prisma delegate access
    /\bProductLaunchDraft\b/, // Prisma model type / TS type
];

/** Lines that are pure comments (single-line // or block-comment lines) are allowed. */
function isCommentOnlyLine(line) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//')) return true;
    if (trimmed.startsWith('*')) return true;
    if (trimmed.startsWith('/*')) return true;
    if (trimmed.startsWith('--')) return true; // SQL / Prisma schema
    if (trimmed.startsWith('#')) return true;
    return false;
}

const failures = [];

function walk(dir) {
    let results = [];
    if (!fs.existsSync(dir)) return results;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (
                entry.name === 'node_modules' ||
                entry.name === 'dist' ||
                entry.name === '.next' ||
                entry.name === 'coverage' ||
                entry.name === '__generated__'
            ) {
                continue;
            }
            results = results.concat(walk(p));
        } else if (
            entry.isFile() &&
            (entry.name.endsWith('.ts') ||
                entry.name.endsWith('.tsx') ||
                entry.name.endsWith('.mjs'))
        ) {
            results.push(p);
        }
    }
    return results;
}

for (const root of SCAN_ROOTS) {
    for (const file of walk(root)) {
        // Files inside backend/modules/configuration are the canonical owner.
        if (file.startsWith(ALLOWED_ROOT + path.sep) || file === ALLOWED_ROOT) continue;
        if (ALLOWED_FILE_EXCEPTIONS.has(file)) continue;
        // Allow test files anywhere as long as they don't import the runtime model.
        // We still flag tests that touch the Prisma delegate to catch sneaky reads.
        const content = fs.readFileSync(file, 'utf8');
        const lines = content.split('\n');
        let firstViolationLine = -1;
        for (let lineIdx = 0; lineIdx < lines.length; lineIdx += 1) {
            const line = lines[lineIdx];
            if (isCommentOnlyLine(line)) continue;
            if (PATTERNS.some((p) => p.test(line))) {
                firstViolationLine = lineIdx + 1;
                break;
            }
        }
        if (firstViolationLine > 0) {
            failures.push(
                `${path.relative(ROOT, file)}:${firstViolationLine}: references ProductLaunchDraft outside backend/modules/configuration/. ` +
                    `ADR-0037: drafts are workflow objects, not a canonical config source — read from canonical rows instead.`,
            );
        }
    }
}

if (failures.length > 0) {
    console.error('check-product-launch-draft-isolation: violations detected');
    console.error('');
    for (const f of failures) console.error(`  ${f}`);
    if (STRICT) process.exit(1);
}

if (STRICT && failures.length === 0) {
    console.log('check-product-launch-draft-isolation: ok');
}

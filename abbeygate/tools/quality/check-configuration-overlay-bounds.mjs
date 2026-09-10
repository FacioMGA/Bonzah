#!/usr/bin/env node
/**
 * CHAMPS guard — Config MCP overlay bounds (ADR-0038).
 *
 * Ensures the closed allowlist of `Program.metadata` top-level keys
 * writable by Config MCP cannot drift sideways:
 *
 *   1. The DraftDelta slot list in
 *      `backend/modules/configuration/domain/draftDelta.ts` matches
 *      the allowlist declared in
 *      `backend/modules/configuration/domain/programMetadataExtensions.ts`
 *      (`CONFIG_MCP_METADATA_KEYS`).
 *
 *   2. No file under `backend/modules/configuration/` writes to a
 *      `Program.metadata.<key>` outside that allowlist. Catches
 *      `program.metadata.<unknownKey> =`, `metadata: { unknownKey: ... }`
 *      assignments in publishToSandbox-class code.
 *
 * Modes: --strict (CI) exits 1 on any violation; default reports only.
 *
 * References:
 *   - ADR-0036 (Config MCP module + tool surface)
 *   - ADR-0037 (Product launch drafts as workflow objects)
 *   - ADR-0038 (Program.metadata extension slots)
 */
import fs from 'node:fs';
import path from 'node:path';

const STRICT = process.argv.includes('--strict');
const ROOT = process.cwd();

const ALLOWLIST_FILE = path.join(
    ROOT,
    'backend/modules/configuration/domain/programMetadataExtensions.ts',
);
const DELTA_FILE = path.join(ROOT, 'backend/modules/configuration/domain/draftDelta.ts');
const SCAN_ROOT = path.join(ROOT, 'backend/modules/configuration');

const failures = [];

function readFileSafe(p) {
    try {
        return fs.readFileSync(p, 'utf8');
    } catch {
        return null;
    }
}

function extractAllowlistKeys(content) {
    if (!content) return null;
    const match = content.match(
        /CONFIG_MCP_METADATA_KEYS\s*=\s*\[\s*([\s\S]*?)\s*\]\s*as const/m,
    );
    if (!match) return null;
    const inside = match[1];
    return Array.from(inside.matchAll(/'([^']+)'/g)).map((m) => m[1]);
}

function extractDeltaSlots(content) {
    if (!content) return null;
    // DraftDeltaSchema = z(.<chain>)*?.object({ slot: schema, ... }).strict()
    const match = content.match(
        /DraftDeltaSchema\b[\s\S]*?\.object\(\s*\{\s*([\s\S]*?)\s*\}\s*\)\s*\.strict\(\)/m,
    );
    if (!match) return null;
    const inside = match[1];
    return Array.from(inside.matchAll(/^\s*([a-zA-Z_]+)\s*:/gm)).map((m) => m[1]);
}

const allowlistKeys = extractAllowlistKeys(readFileSafe(ALLOWLIST_FILE));
const deltaSlots = extractDeltaSlots(readFileSafe(DELTA_FILE));

if (!allowlistKeys) {
    failures.push(
        `${path.relative(ROOT, ALLOWLIST_FILE)}: could not locate CONFIG_MCP_METADATA_KEYS allowlist export.`,
    );
}
if (!deltaSlots) {
    failures.push(
        `${path.relative(ROOT, DELTA_FILE)}: could not locate DraftDeltaSchema declaration.`,
    );
}

// Slot ↔ metadata-key mapping. This must stay in sync with
// publishToSandbox.ts and the canonical-ownership row.
const SLOT_TO_KEY = {
    uwOverrides: 'abbeygateMotorUwConfig',
    mbeOverrides: 'mbeProductConfig',
    questionnaireOverrides: 'questionnaireOverrides',
    approvalRules: 'approvalRules',
    jurisdictionOverrides: 'jurisdictionOverrides',
    billing: 'billing',
    binderAuthorityOverrides: 'binder_authority_separate', // NOT a Program.metadata key; written to BinderProductAuthority on publish
};

if (allowlistKeys && deltaSlots) {
    for (const slot of deltaSlots) {
        const expected = SLOT_TO_KEY[slot];
        if (!expected) {
            failures.push(
                `DraftDelta slot "${slot}" has no SLOT_TO_KEY mapping in check-configuration-overlay-bounds.mjs — extend the guard.`,
            );
            continue;
        }
        // binderAuthorityOverrides is the one Program.metadata-bypass slot;
        // it publishes to BinderProductAuthority (a real column) not Program.metadata.
        if (expected === 'binder_authority_separate') continue;
        if (!allowlistKeys.includes(expected)) {
            failures.push(
                `DraftDelta slot "${slot}" → Program.metadata.${expected} is NOT in CONFIG_MCP_METADATA_KEYS. ` +
                    `Either add it to the allowlist via an ADR amendment, or remove the slot.`,
            );
        }
    }
}

// 2. Scan for non-allowlist Program.metadata writes inside the
// configuration module. We look for assignments / object literals that
// name a metadata key not in the allowlist + the bypass slot.
function walk(dir) {
    let results = [];
    if (!fs.existsSync(dir)) return results;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
            results = results.concat(walk(p));
        } else if (entry.isFile() && entry.name.endsWith('.ts')) {
            results.push(p);
        }
    }
    return results;
}

const allAllowed = new Set(allowlistKeys || []);
const writeRegex = /metadata\s*[:=]\s*\{[\s\S]*?\}/g;

for (const file of walk(SCAN_ROOT)) {
    const content = readFileSafe(file);
    if (!content) continue;
    let m;
    while ((m = writeRegex.exec(content)) !== null) {
        const block = m[0];
        // Pull top-level object keys inside the block.
        const keyMatches = Array.from(block.matchAll(/['"]?([a-zA-Z_][a-zA-Z0-9_]*)['"]?\s*:/g));
        for (const km of keyMatches) {
            const key = km[1];
            // Heuristic — ignore obvious nested keys (only complain when
            // the key matches a known Program.metadata-shaped name, i.e.
            // top-level Config MCP keys plus pre-existing keys).
            const looksLikeMetadataTopLevel =
                key.endsWith('Config') ||
                key.endsWith('Overrides') ||
                key === 'billing' ||
                key === 'approvalRules';
            if (!looksLikeMetadataTopLevel) continue;
            if (!allAllowed.has(key)) {
                const lineNo = content.slice(0, m.index).split('\n').length;
                failures.push(
                    `${path.relative(ROOT, file)}:${lineNo}: writes Program.metadata.${key} but it is not in CONFIG_MCP_METADATA_KEYS.`,
                );
            }
        }
    }
}

if (failures.length > 0) {
    console.error('check-configuration-overlay-bounds: violations detected');
    console.error('');
    for (const f of failures) console.error(`  ${f}`);
    if (STRICT) process.exit(1);
}

if (STRICT && failures.length === 0) {
    console.log('check-configuration-overlay-bounds: ok');
}

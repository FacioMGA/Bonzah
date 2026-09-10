#!/usr/bin/env node
/**
 * CHAMPS guard — Operator MCP V2 mutation tools require preview/confirm
 * (ADR-0039).
 *
 * Scans `backend/modules/operator/app/*.tool.ts` for tool descriptors
 * with `auditClass: 'mutate'` and asserts that the tool either RETURNS
 * a `confirmation_token` (preview tools) OR ACCEPTS one as input (commit
 * tools). Prevents accidentally shipping a mutate tool that skips the
 * preview step.
 *
 * Heuristic: a mutate-class tool is "preview-shaped" if its file body
 * contains a `confirmation_token` token reference in either the output
 * schema or the input schema. The actual runtime check is in the
 * confirmationTokenStore consume path; this is the static gate that
 * catches forgetting to wire the token at all.
 */
import fs from 'node:fs';
import path from 'node:path';

const STRICT = process.argv.includes('--strict');
const ROOT = process.cwd();
const SCAN_ROOT = path.join(ROOT, 'backend/modules/operator/app');

const failures = [];

function walk(dir) {
    let results = [];
    if (!fs.existsSync(dir)) return results;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === '__tests__') continue;
            results = results.concat(walk(p));
        } else if (entry.isFile() && entry.name.endsWith('.tool.ts')) {
            results.push(p);
        }
    }
    return results;
}

for (const file of walk(SCAN_ROOT)) {
    const content = fs.readFileSync(file, 'utf8');
    // Only scan mutate-class tools.
    if (!/auditClass:\s*['"]mutate['"]/.test(content)) continue;
    const hasTokenReference = /confirmation_token/.test(content);
    if (!hasTokenReference) {
        failures.push(
            `${path.relative(ROOT, file)}: mutate-class tool MUST either return a confirmation_token (preview) or accept one (commit). ADR-0039 §1 / canonical preview envelope = OperatorPreviewEnvelope.`,
        );
    }
}

if (failures.length > 0) {
    console.error('check-operator-mutation-preview-required: violations detected');
    console.error('');
    for (const f of failures) console.error(`  ${f}`);
    if (STRICT) process.exit(1);
}

if (STRICT && failures.length === 0) {
    console.log('check-operator-mutation-preview-required: ok');
}

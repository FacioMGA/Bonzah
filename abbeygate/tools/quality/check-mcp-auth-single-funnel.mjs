#!/usr/bin/env node
/**
 * CHAMPS guard — MCP auth single funnel (ADR-0040 §3).
 *
 * Asserts that only `backend/modules/mcp/http/mcpAuthMiddleware.ts`
 * may produce `req.resolvedPermissions` for MCP routes. Any other
 * file writing to `req.resolvedPermissions` from within
 * `backend/modules/mcp/` is a violation.
 *
 * The existing platform-wide `accessControl` middleware writes
 * `req.resolvedPermissions` legitimately for non-MCP routes — that's
 * fine. The constraint is scoped to the MCP module so we never grow
 * a second MCP auth path that drifts from the canonical one.
 *
 * Allowed writers:
 *   - backend/modules/mcp/http/mcpAuthMiddleware.ts  (THE funnel)
 *   - backend/modules/mcp/http/mcpApiKeyAuth.ts      (legacy export
 *     kept for backwards-compat — phase-out after Phase D)
 */
import fs from 'node:fs';
import path from 'node:path';

const STRICT = process.argv.includes('--strict');
const ROOT = process.cwd();
const SCAN_ROOT = path.join(ROOT, 'backend/modules/mcp');

const ALLOWED = [
    path.join(SCAN_ROOT, 'http/mcpAuthMiddleware.ts'),
    path.join(SCAN_ROOT, 'http/mcpApiKeyAuth.ts'),
];

const VIOLATION_RE = /req\.resolvedPermissions\s*=/;

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

const failures = [];

for (const file of walk(SCAN_ROOT)) {
    if (ALLOWED.includes(file)) continue;
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
        if (VIOLATION_RE.test(lines[i])) {
            failures.push(
                `${path.relative(ROOT, file)}:${i + 1}: only mcpAuthMiddleware.ts may assign req.resolvedPermissions (ADR-0040 §3).`,
            );
        }
    }
}

if (failures.length > 0) {
    console.error('check-mcp-auth-single-funnel: violations detected');
    console.error('');
    for (const f of failures) console.error(`  ${f}`);
    if (STRICT) process.exit(1);
}

if (STRICT && failures.length === 0) {
    console.log('check-mcp-auth-single-funnel: ok');
}

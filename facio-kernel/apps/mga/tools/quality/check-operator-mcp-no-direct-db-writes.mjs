#!/usr/bin/env node
/**
 * CHAMPS guard — Operator MCP no-direct-DB-writes (ADR-0036 amendment #2).
 *
 * Scans `backend/modules/operator/` for direct Prisma WRITES
 * (`create|createMany|update|updateMany|upsert|delete|deleteMany`)
 * outside the two sanctioned write zones:
 *
 *   1. `backend/modules/operator/infra/repositories/operatorAuditRepo.ts`
 *      — read-only audit history (writes only via shared
 *      `recordMcpAudit`, not from here).
 *   2. `backend/modules/operator/infra/delegators/*.ts`
 *      — operator-module-owned compositions of canonical write patterns
 *      that the V1 timeline did not have time to extract into proper
 *      `backend/modules/policy/app/*` services. V2 must refactor these
 *      out (see ADR-0036 amendment #2 §"out of scope").
 *
 * Reads (`find*`, `count`, `aggregate`, `groupBy`) are unrestricted.
 *
 * Modes:
 *   --strict   Exit 1 on any violation (CI).
 *   (default)  Report only.
 *
 * Why this guard exists: the spec is explicit that "the MCP should
 * expose business actions, not database writes" — every operator tool
 * must wrap an existing canonical service. The two sanctioned zones
 * above are the explicit-and-documented escape hatches.
 */
import fs from 'node:fs';
import path from 'node:path';

const STRICT = process.argv.includes('--strict');
const ROOT = process.cwd();
const SCAN_ROOT = path.join(ROOT, 'backend/modules/operator');

const FORBIDDEN_PRISMA_WRITE_RE =
    /\btenantScopedPrisma\.[A-Za-z]+\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/;
const FORBIDDEN_TX_WRITE_RE =
    /\btx\.[A-Za-z]+\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/;

const SANCTIONED_PATHS = [
    path.join(SCAN_ROOT, 'infra/repositories/operatorAuditRepo.ts'),
];
const SANCTIONED_DIRS = [path.join(SCAN_ROOT, 'infra/delegators') + path.sep];

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
    if (SANCTIONED_PATHS.includes(file)) continue;
    if (SANCTIONED_DIRS.some((dir) => file.startsWith(dir))) continue;
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (FORBIDDEN_PRISMA_WRITE_RE.test(line) || FORBIDDEN_TX_WRITE_RE.test(line)) {
            failures.push(
                `${path.relative(ROOT, file)}:${i + 1}: direct Prisma write outside sanctioned operator-write zones. Route this through backend/modules/<owning-module>/app/* or add it to infra/delegators/ with a comment naming the canonical service it composes.`,
            );
        }
    }
}

if (failures.length > 0) {
    console.error('check-operator-mcp-no-direct-db-writes: violations detected');
    console.error('');
    for (const f of failures) console.error(`  ${f}`);
    if (STRICT) process.exit(1);
}

if (STRICT && failures.length === 0) {
    console.log('check-operator-mcp-no-direct-db-writes: ok');
}

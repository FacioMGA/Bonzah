#!/usr/bin/env node
/**
 * CHAMPS guard — Claim Workspace + V1 MCP tools read `claim_memory_projections` ONLY
 * (ADR-0041 §7).
 *
 * Pins:
 *   - No file in `backend/modules/claims/` or `backend/modules/operator/`
 *     or `frontend/` may import the Neo4j client (`withSession`, etc.)
 *     EXCEPT the async refresh pipeline + graph repository.
 *
 *   Allowed importers:
 *     - backend/modules/claims/infra/mailgraph/*                (the repo)
 *     - backend/modules/claims/app/mailgraph/upsertClaimGraph.ts
 *     - backend/modules/claims/app/mailgraph/findSimilarClaims.ts
 *     - backend/workers/handlers/CLAIM_MEMORY.REFRESH.ts        (worker entry)
 *
 * Rationale: the projection IS the canonical UI/MCP read source.  A
 * direct Neo4j read on a request-serving path re-introduces the
 * critical-path coupling ADR-0041 specifically forbids.
 */
import fs from 'node:fs';
import path from 'node:path';

const STRICT = process.argv.includes('--strict');
const ROOT = process.cwd();
const SCAN_ROOTS = [
  path.join(ROOT, 'backend/modules/claims'),
  path.join(ROOT, 'backend/modules/operator'),
  path.join(ROOT, 'backend/modules/mcp'),
  path.join(ROOT, 'frontend/src'),
];
const ALLOWED_PREFIXES = [
  path.join(ROOT, 'backend/modules/claims/infra/mailgraph/'),
  path.join(ROOT, 'backend/modules/claims/app/mailgraph/upsertClaimGraph.ts'),
  path.join(ROOT, 'backend/modules/claims/app/mailgraph/findSimilarClaims.ts'),
  path.join(ROOT, 'backend/workers/handlers/CLAIM_MEMORY.REFRESH.ts'),
];

const VIOLATION_RE = /from\s+['"][^'"]*platform\/graph\/neo4jClient(\.[a-z]+)?['"]/;

function walk(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name === 'dist') continue;
      results = results.concat(walk(p));
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
      results.push(p);
    }
  }
  return results;
}

function isAllowed(file) {
  return ALLOWED_PREFIXES.some((prefix) => file === prefix || file.startsWith(prefix));
}

const failures = [];
for (const root of SCAN_ROOTS) {
  for (const file of walk(root)) {
    if (isAllowed(file)) continue;
    const content = fs.readFileSync(file, 'utf8');
    if (VIOLATION_RE.test(content)) {
      failures.push(`${path.relative(ROOT, file)}: imports the Neo4j client; only the mailgraph repo + refresh worker may (ADR-0041 §7).`);
    }
  }
}

if (failures.length > 0) {
  console.error('check-claim-workspace-no-direct-neo4j: violations detected');
  console.error('');
  for (const f of failures) console.error(`  ${f}`);
  if (STRICT) process.exit(1);
}

if (STRICT && failures.length === 0) {
  console.log('check-claim-workspace-no-direct-neo4j: ok');
}

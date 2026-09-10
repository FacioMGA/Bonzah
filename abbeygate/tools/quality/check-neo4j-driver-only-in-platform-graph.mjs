#!/usr/bin/env node
/**
 * CHAMPS guard — `neo4j-driver` is imported in exactly one place
 * (ADR-0041 §7).
 *
 * Pins:
 *   - `import ... from 'neo4j-driver'` is allowed ONLY in
 *     `backend/platform/graph/neo4jClient.ts`.
 *   - All other code paths must consume `withSession` / typed helpers
 *     from `backend/platform/graph/neo4jClient.ts`.
 *
 * Why: ADR-0041 makes Neo4j a graph-derivation enrichment.  Concentrating
 * the driver import means: (a) one place owns the connection-pool
 * lifecycle; (b) one place handles auth/timeout/SSL config; (c) one
 * place handles graceful degradation when `NEO4J_URI` is unset.  If a
 * second importer appears, the resilient-degradation contract silently
 * regresses and we cannot reason about who has driver state.
 */
import fs from 'node:fs';
import path from 'node:path';

const STRICT = process.argv.includes('--strict');
const ROOT = process.cwd();
const SCAN_ROOTS = [path.join(ROOT, 'backend')];
const ALLOWED = [path.join(ROOT, 'backend/platform/graph/neo4jClient.ts')];

const IMPORT_RE = /(?:from\s+['"]neo4j-driver['"]|require\(\s*['"]neo4j-driver['"]\s*\))/;

function walk(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name === 'dist') continue;
      results = results.concat(walk(p));
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.mjs') || entry.name.endsWith('.js'))) {
      results.push(p);
    }
  }
  return results;
}

const failures = [];
for (const root of SCAN_ROOTS) {
  for (const file of walk(root)) {
    if (ALLOWED.includes(file)) continue;
    const content = fs.readFileSync(file, 'utf8');
    if (IMPORT_RE.test(content)) {
      failures.push(`${path.relative(ROOT, file)}: imports 'neo4j-driver' (only backend/platform/graph/neo4jClient.ts may; ADR-0041 §7).`);
    }
  }
}

if (failures.length > 0) {
  console.error('check-neo4j-driver-only-in-platform-graph: violations detected');
  console.error('');
  for (const f of failures) console.error(`  ${f}`);
  if (STRICT) process.exit(1);
}

if (STRICT && failures.length === 0) {
  console.log('check-neo4j-driver-only-in-platform-graph: ok');
}

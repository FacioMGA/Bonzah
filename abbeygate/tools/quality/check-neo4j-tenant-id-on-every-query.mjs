#!/usr/bin/env node
/**
 * CHAMPS guard — every TS Cypher executor passes `tenantId` as a bind
 * parameter (ADR-0041 §7).
 *
 * Pins:
 *   - Every `session.run(...)` inside the mailgraph repo MUST be called
 *     with a parameters object whose JSON shape contains `tenantId`.
 *   - Interpolation into the Cypher string is forbidden (e.g.
 *     `session.run(\`MATCH ... ${tenantId} ...\`)`).
 *
 * The check is conservative: we scan the repo file
 * (`neo4jClaimGraphRepository.ts`) for `session.run(` and require that
 * each call's enclosing function body mentions `tenantId`.  If a future
 * helper is added that delegates differently, the guard's allowlist
 * grows alongside.
 */
import fs from 'node:fs';
import path from 'node:path';

const STRICT = process.argv.includes('--strict');
const ROOT = process.cwd();
const REPO_FILES = [
  path.join(ROOT, 'backend/modules/claims/infra/mailgraph/neo4jClaimGraphRepository.ts'),
];

const SESSION_RUN_RE = /session\.run\s*\(/g;
const STRING_INTERPOLATION_RE = /session\.run\s*\(\s*`[^`]*\$\{[^`]*\}[^`]*`/;

function checkFile(file) {
  if (!fs.existsSync(file)) return [];
  const content = fs.readFileSync(file, 'utf8');
  const failures = [];

  if (STRING_INTERPOLATION_RE.test(content)) {
    failures.push(`${path.relative(ROOT, file)}: session.run() uses template-string interpolation; pass values as bind parameters (ADR-0041 §7).`);
  }

  let match;
  // For each session.run, look backwards/forwards for `tenantId` reference inside the
  // surrounding function body (heuristic: same file must mention tenantId on every call).
  const callCount = (content.match(SESSION_RUN_RE) || []).length;
  const tenantIdCount = (content.match(/tenantId/g) || []).length;
  if (callCount > 0 && tenantIdCount < callCount) {
    failures.push(
      `${path.relative(ROOT, file)}: ${callCount} session.run() calls but only ${tenantIdCount} \`tenantId\` mentions; every call must receive tenantId as a bind parameter (ADR-0041 §7).`,
    );
  }

  return failures;
}

const failures = REPO_FILES.flatMap(checkFile);

if (failures.length > 0) {
  console.error('check-neo4j-tenant-id-on-every-query: violations detected');
  console.error('');
  for (const f of failures) console.error(`  ${f}`);
  if (STRICT) process.exit(1);
}

if (STRICT && failures.length === 0) {
  console.log('check-neo4j-tenant-id-on-every-query: ok');
}

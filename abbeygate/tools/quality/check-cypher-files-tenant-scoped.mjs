#!/usr/bin/env node
/**
 * CHAMPS guard — every `.cypher` file under the mailgraph repo references
 * `$tenantId` (ADR-0041 §7 / §5).
 *
 * A `.cypher` file in `backend/modules/claims/infra/mailgraph/cypher/`
 * that does NOT mention `$tenantId` either reads/writes across tenant
 * boundaries (fail-open multi-tenancy violation) OR encodes a write
 * that does not stamp the new node with `tenantId` — both are
 * unacceptable.
 *
 * The match is permissive (anywhere in the file) but realistically the
 * MATCH/MERGE pattern + a WHERE clause will both include `$tenantId`.
 * The guard catches drift; the file authors are responsible for using
 * the parameter in BOTH the MATCH/MERGE constraint AND the WHERE
 * filter.
 */
import fs from 'node:fs';
import path from 'node:path';

const STRICT = process.argv.includes('--strict');
const ROOT = process.cwd();
const CYPHER_DIR = path.join(ROOT, 'backend/modules/claims/infra/mailgraph/cypher');

function listCypher(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.cypher'))
    .map((entry) => path.join(dir, entry.name));
}

const TENANT_REF = /\$tenantId\b/;

const failures = [];
for (const file of listCypher(CYPHER_DIR)) {
  const content = fs.readFileSync(file, 'utf8');
  if (!TENANT_REF.test(content)) {
    failures.push(`${path.relative(ROOT, file)}: missing \`$tenantId\` parameter reference (ADR-0041 §5).`);
  }
}

if (failures.length > 0) {
  console.error('check-cypher-files-tenant-scoped: violations detected');
  console.error('');
  for (const f of failures) console.error(`  ${f}`);
  if (STRICT) process.exit(1);
}

if (STRICT && failures.length === 0) {
  console.log(`check-cypher-files-tenant-scoped: ok (${listCypher(CYPHER_DIR).length} cypher files)`);
}

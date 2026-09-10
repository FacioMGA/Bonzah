#!/usr/bin/env node
/**
 * CI guard: every backend code path that writes `policy.productType` + `policy.binderId`
 * together MUST go through `assertBinderAuthorizesProduct` (or the mutation router
 * that delegates to it). Prevents regression into ad-hoc product/binder pairings that
 * would bypass Lloyd's-grade line-of-business authorization.
 *
 * Rule: any file under `backend/` that contains a Prisma write touching BOTH
 * `productType` and `binderId` must also reference `assertBinderAuthorizesProduct`
 * or be on the explicit allowlist below.
 *
 * Allowlist entries should be rare and always accompanied by a comment explaining
 * why the check doesn't apply (e.g. test fixtures, seed scripts, backfill tools).
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const BACKEND_ROOT = path.join(ROOT, 'backend');

// Legitimate non-production callers that may bypass the guard.
const ALLOWLIST = new Set([
  // Seed script bulk-creates fixtures before any HTTP path runs.
  'backend/seed.ts',
  // Domain guard itself.
  'backend/modules/policy/app/binders/binderAuthority.ts',
  // The mutation router that delegates to the guard — allowed.
  'backend/modules/policy/http/mutationsRouter.ts',
  // BDX import reconstructs historical policies and may predate authority rows.
  'backend/modules/reporting/app/bdxImport/bdxImportExecution.ts',
]);

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '__tests__', 'test', 'tests', 'migrations']);
const EXTS = new Set(['.ts', '.tsx']);

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(ent.name)) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(full));
    else if (EXTS.has(path.extname(ent.name))) out.push(full);
  }
  return out;
}

function rel(full) {
  return path.relative(ROOT, full).replaceAll('\\', '/');
}

const failures = [];

for (const file of walk(BACKEND_ROOT)) {
  const fileRel = rel(file);
  if (ALLOWLIST.has(fileRel)) continue;
  if (fileRel.endsWith('.test.ts') || fileRel.endsWith('.spec.ts')) continue;
  const text = fs.readFileSync(file, 'utf8');
  // Require a Prisma policy write call (create/update/upsert) *and* both
  // productType+binderId tokens appearing in the file. Pure read-mappers and
  // list/count routes do not set productType on policy writes and are skipped.
  const hasPolicyWrite = /prisma\.policy\.(update|upsert|create|createMany|updateMany)\s*\(/.test(text);
  if (!hasPolicyWrite) continue;
  const writesProductType = /\bproductType\s*:/m.test(text);
  const writesBinderId = /\bbinderId\s*:/m.test(text);
  if (!writesProductType || !writesBinderId) continue;
  if (text.includes('assertBinderAuthorizesProduct')) continue;
  failures.push(fileRel);
}

if (failures.length > 0) {
  console.error('\n[check-policy-product-matches-binder-authority] FAILED — these files set productType alongside binderId without going through assertBinderAuthorizesProduct:');
  for (const f of failures) console.error(`  - ${f}`);
  console.error('\nFix: route the write through backend/modules/policy/http/mutationsRouter.ts');
  console.error('or explicitly allow the file in tools/quality/check-policy-product-matches-binder-authority.mjs with a comment explaining why.\n');
  process.exit(1);
}

console.log('[check-policy-product-matches-binder-authority] OK');

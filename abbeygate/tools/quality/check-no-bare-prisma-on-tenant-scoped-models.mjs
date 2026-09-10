#!/usr/bin/env node
/**
 * CHAMPS Guard — no bare `prisma` calls on tenant-scoped models.
 *
 * Tenant-scoped models are derived dynamically from `prisma/schema.prisma` at
 * run time: any model that declares an `operatingTenantId` field is included.
 * After Sprint 3 this covers all 38 tables (9 Sprint-2 + 29 Sprint-3).
 *
 * WRITES (create / createMany / upsert) on these models MUST go through
 * `tenantScopedPrisma` so the Prisma extension auto-injects `operatingTenantId`
 * from the per-request ALS context.  The bare `prisma` client bypasses the
 * extension and will throw a NOT NULL DB constraint violation at runtime.
 *
 * READS (findMany / findFirst / findUnique / count / aggregate / etc.) MUST
 * also go through `tenantScopedPrisma` so results are scoped to the operating
 * tenant, preventing cross-tenant data leaks.
 *
 * Exceptions
 * ----------
 *  - backend/platform/db/tenantExtension.ts — defines the extension itself.
 *  - backend/platform/db/connection.ts       — defines tenantScopedPrisma.
 *  - Test files (*.test.ts / *.spec.ts / files inside a __tests__ folder).
 *  - dist/ directory.
 *  - Files whose first line contains:
 *      // guard:cross-tenant-intentional
 *    Reserved for background system processes that legitimately read/write
 *    across all tenants (e.g., the outbox relay).  Must be accompanied by
 *    an explanatory comment in the file.
 *  - Individual lines that contain `// noguard` or `// guard:cross-tenant-intentional`
 *    (both are accepted as per-line suppressions).
 *
 * Modes
 * -----
 *  --strict   Exit 1 on any violation (CI enforcement).
 *  (default)  Print violations and exit 0 — report-only.
 *
 * Usage
 * -----
 *   node tools/quality/check-no-bare-prisma-on-tenant-scoped-models.mjs
 *   node tools/quality/check-no-bare-prisma-on-tenant-scoped-models.mjs --strict
 *
 * ADR: docs/adr/ADR-0009-shared-schema-row-level-tenancy.md
 */

import fs from 'node:fs';
import path from 'node:path';

const STRICT = process.argv.includes('--strict');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BACKEND_ROOT = path.resolve('backend');
const SCHEMA_PATH  = path.resolve('prisma/schema.prisma');

const ALWAYS_ALLOWED = new Set([
  path.resolve('backend/platform/db/tenantExtension.ts'),
  path.resolve('backend/platform/db/connection.ts'),
]);

function isSkipped(filePath) {
  if (ALWAYS_ALLOWED.has(filePath)) return true;
  if (filePath.endsWith('.test.ts') || filePath.endsWith('.spec.ts')) return true;
  if (filePath.includes('/__tests__/')) return true;
  if (filePath.includes('/tests/')) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Derive tenant-scoped model list from schema.prisma at run time.
// Any model that declares `operatingTenantId` is tenant-scoped.
// Returns camelCase Prisma accessor names (e.g., "policyListIndex").
// ---------------------------------------------------------------------------

function readTenantScopedModels() {
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  const seen = new Set();
  const models = [];
  let currentModel = null;
  let currentModelScoped = false;

  for (const line of schema.split('\n')) {
    const modelMatch = line.match(/^model\s+(\w+)\s*\{/);
    if (modelMatch) {
      currentModel = modelMatch[1];
      currentModelScoped = false;
      continue;
    }
    if (line.trim() === '}') {
      currentModel = null;
      currentModelScoped = false;
      continue;
    }
    // Only match the scalar field declaration line, not relation or index lines.
    // A scalar field looks like:  operatingTenantId  String
    // A relation line looks like: operatingTenant    Tenant  @relation(...)
    // An index looks like:        @@index([operatingTenantId])
    if (
      currentModel &&
      !currentModelScoped &&
      /^\s+operatingTenantId\s+String\b/.test(line)
    ) {
      const camel = currentModel[0].toLowerCase() + currentModel.slice(1);
      if (!seen.has(camel)) {
        seen.add(camel);
        models.push(camel);
      }
      currentModelScoped = true;
    }
  }
  return models;
}

// All Prisma CRUD operations — writes are the immediate safety issue (NOT NULL
// violation); reads are flagged so cross-tenant data leaks are caught early.
const FLAGGED_OPERATIONS = [
  'create',
  'createMany',
  'upsert',
  'findMany',
  'findFirst',
  'findUnique',
  'findUniqueOrThrow',
  'findFirstOrThrow',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
];

const TENANT_SCOPED_MODELS = readTenantScopedModels();

if (TENANT_SCOPED_MODELS.length === 0) {
  console.error('[no-bare-prisma-on-tenant-scoped-models] ⚠  No tenant-scoped models found in schema. Is SCHEMA_PATH correct?');
  process.exit(1);
}

// Matches `prisma.<tenantScopedModel>.<operation>(` — NOT `tenantScopedPrisma.*`
// nor `tx.*` (transactions started on tenantScopedPrisma inherit the extension).
const modelAlt = TENANT_SCOPED_MODELS.join('|');
const opAlt = FLAGGED_OPERATIONS.join('|');
const VIOLATION_RE = new RegExp(
  `(?<![\\w$])prisma\\.(?:${modelAlt})\\.(?:${opAlt})\\(`,
);

// ---------------------------------------------------------------------------
// File walker
// ---------------------------------------------------------------------------

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      yield* walk(full);
    } else if (
      entry.isFile() &&
      (entry.name.endsWith('.ts') || entry.name.endsWith('.mts'))
    ) {
      yield full;
    }
  }
}

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

const violations = [];

for (const filePath of walk(BACKEND_ROOT)) {
  if (isSkipped(filePath)) continue;

  const source = fs.readFileSync(filePath, 'utf8');

  // File-level suppression: any line (not just the first) may carry the marker.
  if (source.includes('// guard:cross-tenant-intentional')) continue;

  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Per-line suppression — both forms accepted.
    if (line.includes('// noguard') || line.includes('// guard:cross-tenant-intentional')) continue;
    if (VIOLATION_RE.test(line)) {
      violations.push({
        file: path.relative(process.cwd(), filePath),
        line: i + 1,
        text: line.trim(),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

if (violations.length === 0) {
  console.log(
    `[no-bare-prisma-on-tenant-scoped-models] ✅  ok — no bare prisma calls on ${TENANT_SCOPED_MODELS.length} tenant-scoped models.`,
  );
  process.exit(0);
}

// Group by file.
const byFile = new Map();
for (const v of violations) {
  if (!byFile.has(v.file)) byFile.set(v.file, []);
  byFile.get(v.file).push(v);
}

const mode = STRICT ? 'FAIL' : 'WARN (report-only)';
console.error(
  `\n[no-bare-prisma-on-tenant-scoped-models] ${mode} — bare \`prisma\` calls on tenant-scoped models.\n`,
);
console.error(
  'Use `tenantScopedPrisma` instead.  Background code that legitimately spans all tenants\n' +
  'may add `// guard:cross-tenant-intentional` anywhere in the file (file-level), or on the\n' +
  'specific line (line-level).  `// noguard` is also accepted as a shorter form.\n' +
  'See: docs/adr/ADR-0009-shared-schema-row-level-tenancy.md\n',
);

for (const [file, vs] of byFile) {
  console.error(`  ${file}`);
  for (const v of vs) {
    console.error(`    L${v.line}: ${v.text.slice(0, 120)}`);
  }
  console.error('');
}

console.error(
  `Total: ${violations.length} violation(s) across ${byFile.size} file(s).\n` +
  `Scanned ${TENANT_SCOPED_MODELS.length} tenant-scoped model(s): ${TENANT_SCOPED_MODELS.join(', ')}.`,
);

process.exit(STRICT ? 1 : 0);

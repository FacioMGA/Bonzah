/**
 * CI guard: no hardcoded string defaults on tenant-identity columns in schema.prisma.
 *
 * After Sprint 2, the three legacy `tenantId String @default("default")` columns
 * (RecoEvent, RecoBanditArm, SanctionScreeningRun) were replaced with proper
 * operatingTenantId FKs. No new model may introduce a String column whose name
 * matches /tenant|operating/i with ANY string default — `@default("default")`,
 * `@default("abbeygate-cy")`, etc.  The moment any hardcoded tenant identity
 * appears in a migration's default clause, Sprint 2's invariant is violated.
 *
 * Also checks a small list of TypeScript files for legacy in-code tenant
 * literal defaults that predated the Prisma model (kept for belt-and-braces).
 */
import fs from 'node:fs';
import path from 'node:path';

const violations = [];

// ---------------------------------------------------------------------------
// 1. Scan schema.prisma for any remaining @default("default") on tenant fields
// ---------------------------------------------------------------------------

const schemaPath = path.resolve('prisma/schema.prisma');
if (fs.existsSync(schemaPath)) {
  const lines = fs.readFileSync(schemaPath, 'utf8').split('\n');
  // Matches any column whose name contains "tenant" or "operating" (case-insensitive).
  const tenantFieldRe = /\b(?:tenant|operating)\w*/i;
  // Matches @default("any-string") — ANY hardcoded string default is forbidden
  // on a tenant-identity column, not just the word "default".
  const anyStringDefaultRe = /@default\(\s*["'][^"']*["']\s*\)/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Strip inline comments before pattern matching so that column-name checks
    // are not confused by comment text containing words like "TENANT".
    const codeOnly = line.split('//')[0];
    if (tenantFieldRe.test(codeOnly) && anyStringDefaultRe.test(codeOnly)) {
      violations.push({
        file: 'prisma/schema.prisma',
        rule: 'hardcoded string @default on tenant-identity column',
        snippet: line.trim(),
        line: i + 1,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Legacy TypeScript pattern check (pre-Sprint-2 belt-and-braces)
// ---------------------------------------------------------------------------

const targetFiles = [
  'backend/services/publicAutoQuote/controller.ts',
  'backend/http/routes/paymentsCardcorp.ts',
  'backend/core/recommendations/engine.ts',
  'backend/core/recommendations/bandit.ts',
  'backend/http/middleware/tenantResolution.ts',
];

const riskyPatterns = [
  { name: "tenantId literal default", re: /tenantId\s*:\s*['"]default['"]/g },
  { name: "tenant fallback with || default/env", re: /tenantId\s*\|\|\s*(['"]default['"]|process\.env\.[A-Z0-9_]+)/g },
  { name: "DEFAULT_TENANT constant usage", re: /DEFAULT_TENANT/gi },
];

for (const rel of targetFiles) {
  const file = path.resolve(rel);
  if (!fs.existsSync(file)) continue;
  const content = fs.readFileSync(file, 'utf8');
  for (const rule of riskyPatterns) {
    const matches = [...content.matchAll(rule.re)];
    for (const match of matches) {
      const idx = match.index || 0;
      const snippet = content.slice(Math.max(0, idx - 80), Math.min(content.length, idx + 140)).replace(/\s+/g, ' ').trim();
      violations.push({ file: rel, rule: rule.name, snippet });
    }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

if (violations.length > 0) {
  // eslint-disable-next-line no-console
  console.error('[tenant-default-guard] Found forbidden tenant fallback/default patterns:');
  for (const v of violations) {
    const loc = v.line ? `:${v.line}` : '';
    // eslint-disable-next-line no-console
    console.error(`- ${v.file}${loc} (${v.rule}): ${v.snippet}`);
  }
  process.exit(1);
}

// eslint-disable-next-line no-console
console.log('[tenant-default-guard] ok');


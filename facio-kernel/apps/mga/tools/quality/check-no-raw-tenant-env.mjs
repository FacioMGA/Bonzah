/**
 * CI guard: no raw process.env.DEFAULT_* / ALLOWED_RISK_COUNTRIES / PRIORITY_COUNTRIES reads.
 *
 * All jurisdiction-scoped config must flow through getTenantConfig() in
 * backend/platform/tenant/tenantConfig.ts. Any direct read of the banned env
 * vars outside that file (and test files) is a Sprint 1 contract violation.
 *
 * Banned patterns:
 *   process.env.DEFAULT_COUNTRY
 *   process.env.DEFAULT_REGION_CODE
 *   process.env.DEFAULT_CURRENCY
 *   process.env.ALLOWED_RISK_COUNTRIES
 *   process.env.PRIORITY_COUNTRIES
 *   process.env.DEFAULT_NATIONALITY
 *   process.env.DEFAULT_DRIVERS_LICENSE_COUNTRY
 *   process.env.DEFAULT_BROKER_NAME
 */

import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BACKEND_ROOT = path.resolve('backend');

/** Paths that are allowed to read the banned env vars (allowlist). */
const ALLOWED_PATHS = [
  // `tenantConfigForCli.ts` (ADR-0019) is the only legitimate CLI /
  // system-outbox / seed entry point that materialises TenantConfig from env.
  path.resolve('backend/platform/tenant/tenantConfigForCli.ts'),
  // Test fixtures may set env vars to control the fallback path.
  // (matched by suffix: any *.test.ts or */__tests__/* file)
];

const BANNED_PATTERNS = [
  /process\.env\.DEFAULT_COUNTRY\b/,
  /process\.env\.DEFAULT_REGION_CODE\b/,
  /process\.env\.DEFAULT_CURRENCY\b/,
  /process\.env\.ALLOWED_RISK_COUNTRIES\b/,
  /process\.env\.PRIORITY_COUNTRIES\b/,
  /process\.env\.DEFAULT_NATIONALITY\b/,
  /process\.env\.DEFAULT_DRIVERS_LICENSE_COUNTRY\b/,
  /process\.env\.DEFAULT_BROKER_NAME\b/,
];

// ---------------------------------------------------------------------------
// File walker
// ---------------------------------------------------------------------------

function isAllowed(filePath) {
  if (ALLOWED_PATHS.includes(filePath)) return true;
  // Allow test files.
  if (filePath.endsWith('.test.ts') || filePath.endsWith('.spec.ts')) return true;
  if (filePath.includes('/__tests__/')) return true;
  if (filePath.includes('/tests/')) return true;
  return false;
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      yield* walk(full);
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.mts'))) {
      yield full;
    }
  }
}

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

const violations = [];

for (const filePath of walk(BACKEND_ROOT)) {
  if (isAllowed(filePath)) continue;

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pattern of BANNED_PATTERNS) {
      if (pattern.test(line)) {
        violations.push({
          file: path.relative(process.cwd(), filePath),
          line: i + 1,
          text: line.trim(),
          pattern: pattern.source,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

if (violations.length === 0) {
  // eslint-disable-next-line no-console
  console.log('[no-raw-tenant-env] ok — no forbidden process.env.DEFAULT_* reads found');
  process.exit(0);
}

// eslint-disable-next-line no-console
console.error('[no-raw-tenant-env] FAIL — forbidden raw env var reads detected.');
// eslint-disable-next-line no-console
console.error('All jurisdiction-scoped config must flow through getTenantConfig() in');
// eslint-disable-next-line no-console
console.error('backend/platform/tenant/tenantConfig.ts (ADR-0009).\n');

for (const v of violations) {
  // eslint-disable-next-line no-console
  console.error(`  ${v.file}:${v.line}  [${v.pattern}]`);
  // eslint-disable-next-line no-console
  console.error(`    ${v.text}\n`);
}

// eslint-disable-next-line no-console
console.error(`Total: ${violations.length} violation(s). Fix them and re-run the build.`);
process.exit(1);

#!/usr/bin/env node
/**
 * Guard: no product-type string literals in shared BO code.
 *
 * Shared BO surfaces (policy list, policy detail, UW tab, MBE, program editor)
 * must render from the ProductManifest — never branch on `'MOTOR'`, `'HOME'`,
 * etc. The manifest lives in `frontend/src/products/{code}/manifest.ts` and
 * the adapter lives in `backend/products/{code}/`.
 *
 * This guard scans the shared zones and fails on any `'MOTOR'` (or other known
 * product type) string literal. Test files and the products/ zone itself are
 * exempt.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const exts = new Set(['.ts', '.tsx']);

/** Zones that must be product-agnostic. */
const SHARED_ZONES = [
  'frontend/src/modules',
  'frontend/src/shared',
  'frontend/src/surfaces/bo',
  'frontend/src/surfaces/client',
];

/** Directories within the shared zones that are explicitly product-scoped and exempted. */
const EXEMPT_SUBTREES = [
  // Motor's config / legacy modules are motor implementation, not shared BO.
  'frontend/src/modules/policies/config',
  'frontend/src/modules/policies/questionnaire',
  'frontend/src/modules/policies/validation',
  // Claims motor intake is intentionally motor-specific.
  'frontend/src/modules/claims/intake/motor',
];

/** File-level exemptions — deprecated shims or files undergoing migration. */
const EXEMPT_FILES = new Set([
  'frontend/src/surfaces/bo/components/programs/ProgramPricing.tsx',
  'frontend/src/surfaces/bo/components/programs/ProgramEligibility.tsx',
  // Policy model policy.ts carries legacy PolicyRecord quoteData typed against motor.
  'frontend/src/modules/policies/model/policy.ts',
]);

/** Regexes we flag. */
const BANNED_PATTERNS = [
  // Literal product-type strings with motor-check-like comparisons or uses.
  // We only flag direct string literals — imports, variables named "MOTOR" allowed.
  /\b['"]MOTOR['"]/g,
  /Certificate of Motor Insurance/g,
  /Auto Insurance Policy/g,
  /\bMotor cover\b/g,
  /\bMotor Scheme\b/g,
  /Motor automation/g,
];

const failures = [];

function rel(p) {
  return p.replaceAll('\\', '/');
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else if (exts.has(path.extname(ent.name))) out.push(p);
  }
  return out;
}

function isTestFile(file) {
  return /\.(test|spec)\.(ts|tsx)$/.test(file) || file.includes('__tests__');
}

function isExempt(fileRel) {
  if (EXEMPT_FILES.has(fileRel)) return true;
  return EXEMPT_SUBTREES.some((prefix) => fileRel.startsWith(`${prefix}/`));
}

function scan(file) {
  const fileRel = rel(path.relative(ROOT, file));
  if (isTestFile(fileRel)) return;
  if (isExempt(fileRel)) return;

  const contents = fs.readFileSync(file, 'utf8');
  const lines = contents.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pat of BANNED_PATTERNS) {
      pat.lastIndex = 0;
      const match = pat.exec(line);
      if (match) {
        // Allow references to MOTOR within import specifiers of `products/motor/`.
        if (/['"]@?\/?src\/products\/motor\//.test(line)) continue;
        // Allow simple product-code-literal map keys:  MOTOR: motorManifest (adapter registration / test fixtures)
        if (/MOTOR:\s*[a-zA-Z_]/.test(line)) continue;
        failures.push({ file: fileRel, line: i + 1, snippet: line.trim() });
      }
    }
  }
}

for (const zone of SHARED_ZONES) {
  for (const file of walk(path.join(ROOT, zone))) {
    scan(file);
  }
}

if (failures.length > 0) {
  console.error('Product-type literals found in shared BO code.');
  console.error('Shared surfaces must render from the ProductManifest — not branch on product strings.');
  console.error('');
  for (const f of failures) {
    console.error(`  ${f.file}:${f.line}  ${f.snippet}`);
  }
  console.error('');
  console.error(`${failures.length} violation(s). See frontend/src/products/motor/manifest.ts for the manifest pattern.`);
  process.exit(1);
}

console.log('OK: no product-type literals in shared BO code.');

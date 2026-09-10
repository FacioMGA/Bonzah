#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const MODULES_DIR = path.join(ROOT, 'backend', 'modules');
const EXTS = new Set(['.ts', '.tsx', '.js', '.mjs']);

const BUSINESS_CORE_PREFIXES = [
  'backend/core/claims/',
  'backend/core/policy/',
  'backend/core/pricing/',
  'backend/core/documents/',
  'backend/core/underwriting/',
];

const FORBIDDEN_PLATFORM_SERVICE_TARGETS = new Set([
  'backend/platform/services.ts',
  'backend/platform/services.js',
]);

const ALLOWLIST = new Set([
  'backend/modules/claims/domain/claimsContract.ts',
  'backend/modules/claims/domain/claimsHelpers.ts',
  'backend/modules/claims/domain/claimsKpis.ts',
  'backend/modules/claims/domain/claimsValidation.ts',
  'backend/modules/claims/domain/fnolRisk.ts',
  'backend/modules/claims/domain/intakeCanonical.ts',
  'backend/modules/claims/domain/worksheetCommands.ts',
  'backend/modules/claims/domain/worksheetProjection.ts',
  'backend/modules/documents/app/documentGenerator.ts',
  'backend/modules/documents/app/documentService.ts',
  'backend/modules/policy/app/issueReadiness.ts',
  'backend/modules/pricing/app/canonicalRules.ts',
]);

function toPosix(value) {
  return String(value || '').replaceAll('\\', '/');
}

function toRepoRel(absPath) {
  return toPosix(path.relative(ROOT, absPath));
}

function isTestFile(relPath) {
  const p = toPosix(relPath);
  return p.includes('/__tests__/') || p.includes('.test.') || p.includes('.spec.');
}

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else if (EXTS.has(path.extname(ent.name))) out.push(p);
  }
  return out;
}

function extractSpecifiers(source) {
  const specs = [];
  const fromRe = /from\s+['"]([^'"]+)['"]/g;
  const dynImportRe = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m;
  while ((m = fromRe.exec(source)) !== null) specs.push(m[1]);
  while ((m = dynImportRe.exec(source)) !== null) specs.push(m[1]);
  return specs;
}

function resolveImportToAbs(fromAbs, specifier) {
  const spec = String(specifier || '');
  if (!spec) return null;
  if (spec.startsWith('.')) return path.resolve(path.dirname(fromAbs), spec);
  if (spec.startsWith('@/backend/')) return path.join(ROOT, spec.replace('@/backend/', 'backend/'));
  if (spec.startsWith('backend/')) return path.join(ROOT, spec);
  return null;
}

function isBusinessCoreTarget(relPath) {
  const normalized = toPosix(relPath);
  return BUSINESS_CORE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function isForbiddenPlatformServicesSpecifier(specifier) {
  const normalized = String(specifier || '').replaceAll('\\', '/');
  return (
    normalized.endsWith('/platform/services') ||
    normalized.endsWith('/platform/services.ts') ||
    normalized.endsWith('/platform/services.js') ||
    normalized === 'backend/platform/services' ||
    normalized === 'backend/platform/services.ts' ||
    normalized === 'backend/platform/services.js' ||
    normalized === '@/backend/platform/services' ||
    normalized === '@/backend/platform/services.ts' ||
    normalized === '@/backend/platform/services.js'
  );
}

const failures = [];
for (const fileAbs of walk(MODULES_DIR)) {
  const fileRel = toRepoRel(fileAbs);
  if (isTestFile(fileRel)) continue;
  if (ALLOWLIST.has(fileRel)) continue;

  const content = fs.readFileSync(fileAbs, 'utf8');
  for (const spec of extractSpecifiers(content)) {
    if (isForbiddenPlatformServicesSpecifier(spec)) {
      failures.push(`[modules-import-platform-services] ${fileRel} -> "${spec}" (platform/services)`);
      continue;
    }
    const targetAbs = resolveImportToAbs(fileAbs, spec);
    if (!targetAbs) continue;
    const targetRel = toRepoRel(targetAbs);
    if (FORBIDDEN_PLATFORM_SERVICE_TARGETS.has(targetRel)) {
      failures.push(`[modules-import-platform-services] ${fileRel} -> "${spec}" (${targetRel})`);
      continue;
    }
    if (!isBusinessCoreTarget(targetRel)) continue;
    failures.push(`[modules-import-core-business] ${fileRel} -> "${spec}" (${targetRel})`);
  }
}

if (failures.length > 0) {
  console.error('\n[backend-core-business-imports] FAILED:\n');
  for (const line of Array.from(new Set(failures)).sort()) console.error(` - ${line}`);
  process.exit(1);
}

console.log('[backend-core-business-imports] OK');

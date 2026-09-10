#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const ROUTES_DIR = path.join(ROOT, 'backend', 'http', 'routes');
const EXTS = new Set(['.ts', '.tsx', '.js', '.mjs']);

const ORCHESTRATOR_ALLOWLIST = new Set([
  'backend/http/routes/auth.ts',
  'backend/http/routes/bo.ts',
  'backend/http/routes/client.ts',
  'backend/http/routes/policies.ts',
  'backend/http/routes/public.ts',
  'backend/http/routes/users.ts',
  'backend/http/routes/v1/index.ts',
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

function classifyTarget(repoRelPath) {
  const rel = toPosix(repoRelPath);
  if (!rel.startsWith('backend/')) return 'external';
  if (rel.startsWith('backend/modules/')) {
    if (rel.includes('/http/')) return 'module-http';
    if (rel.includes('/app/')) return 'module-app';
    if (rel.includes('/domain/')) return 'module-domain';
    if (rel.includes('/infra/')) return 'module-infra';
    if (rel.includes('/internal/')) return 'module-internal';
    return 'module-other';
  }
  if (rel.startsWith('backend/core/')) return 'core';
  if (rel.startsWith('backend/db/')) return 'db';
  if (rel.startsWith('backend/services/')) return 'services';
  if (rel.startsWith('backend/app/')) return 'legacy-app';
  if (rel.startsWith('backend/domain/')) return 'legacy-domain';
  if (rel.startsWith('backend/http/')) return 'api';
  if (rel.startsWith('backend/platform/')) return 'platform';
  return 'other-server';
}

const failures = [];
const routeFiles = walk(ROUTES_DIR);

for (const fileAbs of routeFiles) {
  const fileRel = toRepoRel(fileAbs);
  if (isTestFile(fileRel)) continue;

  const content = fs.readFileSync(fileAbs, 'utf8');
  const specs = extractSpecifiers(content);

  if (ORCHESTRATOR_ALLOWLIST.has(fileRel)) {
    continue;
  }

  let hasModuleDelegationImport = false;

  for (const spec of specs) {
    const targetAbs = resolveImportToAbs(fileAbs, spec);
    if (!targetAbs) continue;
    const targetRel = toRepoRel(targetAbs);
    const targetKind = classifyTarget(targetRel);

    if (targetKind === 'module-http' || targetKind === 'module-app') {
      hasModuleDelegationImport = true;
      continue;
    }

    if (
      targetKind === 'core' ||
      targetKind === 'db' ||
      targetKind === 'services' ||
      targetKind === 'legacy-app' ||
      targetKind === 'legacy-domain' ||
      targetKind === 'module-domain' ||
      targetKind === 'module-infra' ||
      targetKind === 'module-internal' ||
      targetKind === 'module-other' ||
      targetKind === 'other-server'
    ) {
      failures.push(
        `[route-delegation-target] ${fileRel} imports "${spec}" (${targetRel}); allowed targets are modules/http or modules/app only`,
      );
    }
  }

// Route adapters should be thin delegation shims only.
  if (!hasModuleDelegationImport) {
    failures.push(`[route-delegation-missing] ${fileRel} has no module http/app delegation import`);
  }
  if (/router\.(get|post|put|patch|delete|use)\s*\(/.test(content) || /\bRouter\s*\(\s*\)/.test(content)) {
    failures.push(`[route-delegation-thickness] ${fileRel} defines routes directly; expected thin adapter delegating to modules/*/http`);
  }
}

if (failures.length > 0) {
  console.error('\n[backend-module-delegation] FAILED:\n');
  for (const line of Array.from(new Set(failures)).sort()) console.error(` - ${line}`);
  console.error('\nPolicy: backend/http/routes owns transport composition only; module route behavior belongs in backend/modules/*/http.');
  process.exit(1);
}

console.log('[backend-module-delegation] OK');

#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const APPS = path.join(ROOT, 'apps');
const MODULES = path.join(ROOT, 'backend', 'modules');
const PLATFORM = path.join(ROOT, 'backend', 'platform');
const exts = new Set(['.ts', '.tsx', '.js', '.mjs']);
const LEGACY_PLATFORM_ALLOWLIST = new Set([
  'backend/platform/config/startupValidation.ts',
  'backend/platform/types/contracts.ts',
]);

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

function toPosix(v) {
  return v.replaceAll('\\', '/');
}

function layerForAbs(fileAbs) {
  const rel = toPosix(path.relative(ROOT, fileAbs));
  if (rel.startsWith('apps/')) return 'apps';
  if (rel.startsWith('backend/modules/')) return 'domains';
  if (rel.startsWith('backend/platform/')) return 'platform';
  return 'other';
}

function resolveImportToAbs(fromAbs, spec) {
  if (!spec) return null;
  if (spec.startsWith('.')) return path.resolve(path.dirname(fromAbs), spec);
  if (spec.startsWith('@/backend/')) return path.join(ROOT, spec.replace('@/backend/', 'backend/'));
  if (spec.startsWith('backend/')) return path.join(ROOT, spec);
  if (spec.startsWith('@/apps/')) return path.join(ROOT, spec.replace('@/', ''));
  if (spec.startsWith('apps/')) return path.join(ROOT, spec);
  return null;
}

const importRe = /from\s+['"]([^'"]+)['"]/g;
const files = [...walk(APPS), ...walk(MODULES), ...walk(PLATFORM)];
const failures = [];

for (const file of files) {
  const fromLayer = layerForAbs(file);
  if (fromLayer === 'other') continue;
  const fromRel = toPosix(path.relative(ROOT, file));
  if (fromRel.includes('/__tests__/') || fromRel.includes('.test.')) continue;
  const text = fs.readFileSync(file, 'utf8');
  let m;
  while ((m = importRe.exec(text)) !== null) {
    const spec = m[1];
    const toAbs = resolveImportToAbs(file, spec);
    if (!toAbs) continue;
    const toLayer = layerForAbs(toAbs);
    if (toLayer === 'other') continue;

    if (fromLayer === 'domains' && toLayer === 'apps') {
      failures.push(`[domains->apps forbidden] ${toPosix(path.relative(ROOT, file))} -> "${spec}"`);
    }
    if (fromLayer === 'platform' && (toLayer === 'domains' || toLayer === 'apps')) {
      if (LEGACY_PLATFORM_ALLOWLIST.has(fromRel)) continue;
      failures.push(`[platform->${toLayer} forbidden] ${toPosix(path.relative(ROOT, file))} -> "${spec}"`);
    }
  }
}

if (failures.length) {
  console.error('\nLAYER BOUNDARY GUARD FAILED:\n' + failures.map((v) => ` - ${v}`).join('\n') + '\n');
  process.exit(1);
}

console.log('layer boundary guard OK (apps -> domains -> platform)');

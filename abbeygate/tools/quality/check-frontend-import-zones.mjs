#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'frontend', 'src');
const EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs'];
const STRICT_FEATURE_PUBLIC_APIS = process.env.STRICT_FEATURE_PUBLIC_APIS === '1';
const SURFACE_CROSS_IMPORT_EXCEPTIONS = new Set([]);
const BANNED_ROOT_NAMESPACES = [
  'frontend/src/components/',
  'frontend/src/tenants/',
  'frontend/src/lib/',
  'frontend/src/types/',
  'frontend/src/features/',
];

function toPosix(p) {
  return p.replaceAll('\\', '/');
}

function walk(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else if (EXTS.includes(path.extname(ent.name))) out.push(p);
  }
  return out;
}

function fileZone(absPath) {
  const rel = toPosix(path.relative(ROOT, absPath));
  const m = rel.match(/^frontend\/src\/surfaces\/([^/]+)\//);
  if (m) return `surface:${m[1]}`;
  const p = rel.match(/^frontend\/src\/products\/([^/]+)\//);
  if (p) return `product:${p[1]}`;
  if (rel.startsWith('frontend/src/shared/')) return 'shared';
  return 'other';
}

function resolveImportAbs(fromAbs, spec) {
  const s = String(spec || '').trim();
  if (!s) return null;
  if (s.startsWith('.')) return path.resolve(path.dirname(fromAbs), s);
  if (s.startsWith('@/')) return path.join(ROOT, s.slice(2));
  if (s.startsWith('@surfaces/')) return path.join(ROOT, 'frontend/src/surfaces', s.slice('@surfaces/'.length));
  if (s.startsWith('@products/')) return path.join(ROOT, 'frontend/src/products', s.slice('@products/'.length));
  if (s.startsWith('@shared/')) return path.join(ROOT, 'frontend/src/shared', s.slice('@shared/'.length));
  if (s.startsWith('@bo/')) return path.join(ROOT, 'frontend/src/surfaces/bo', s.slice('@bo/'.length));
  if (s.startsWith('@client/')) return path.join(ROOT, 'frontend/src/surfaces/client', s.slice('@client/'.length));
  if (s.startsWith('@public/')) return path.join(ROOT, 'frontend/src/surfaces/public', s.slice('@public/'.length));
  return null;
}

function violations(fromZone, toZone) {
  const out = [];
  if (fromZone === 'shared' && (toZone.startsWith('product:') || toZone.startsWith('surface:'))) {
    out.push('shared cannot import products/surfaces');
  }
  if (fromZone.startsWith('product:') && toZone.startsWith('surface:')) {
    out.push('products cannot import surfaces');
  }
  if (fromZone.startsWith('surface:') && toZone.startsWith('surface:')) {
    const a = fromZone.slice('surface:'.length);
    const b = toZone.slice('surface:'.length);
    if (a !== b) out.push('surface cannot import another surface');
  }
  return out;
}

const files = fs.existsSync(SRC) ? walk(SRC) : [];
const importRe = /from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
const failures = [];

for (const file of files) {
  const fromZone = fileZone(file);
  if (fromZone === 'other') continue;
  const text = fs.readFileSync(file, 'utf8');
  let m;
  while ((m = importRe.exec(text)) !== null) {
    const spec = String(m[1] || m[2] || '');
    const toAbs = resolveImportAbs(file, spec);
    if (!toAbs) continue;
    const relTarget = toPosix(path.relative(ROOT, toAbs));
    if (BANNED_ROOT_NAMESPACES.some((prefix) => relTarget.startsWith(prefix))) {
      const relFile = toPosix(path.relative(ROOT, file));
      failures.push(`[legacy root namespace import] ${relFile} -> "${spec}" (${relTarget})`);
      continue;
    }
    const toZone = fileZone(toAbs);
    if (toZone === 'other') continue;
    const relFile = toPosix(path.relative(ROOT, file));
    if (SURFACE_CROSS_IMPORT_EXCEPTIONS.has(`${relFile}|${spec}`)) continue;
    const errs = violations(fromZone, toZone);
    for (const err of errs) {
      failures.push(`[${err}] ${relFile} -> "${spec}" (${toZone})`);
    }
  }
}

if (failures.length) {
  console.error('\nFRONTEND IMPORT ZONES GUARD FAILED:\n' + failures.map((x) => ` - ${x}`).join('\n') + '\n');
  console.error('Boundary model: surfaces (composition) -> products (capabilities) -> shared/core (reusable).');
  process.exit(1);
}

console.log('frontend import zones guard OK');

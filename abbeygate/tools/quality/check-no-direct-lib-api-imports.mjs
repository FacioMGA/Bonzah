#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const ALLOWLIST = new Set([]);

function toPosix(p) {
  return String(p || '').replaceAll('\\', '/');
}

function walk(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === '.git') continue;
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(abs));
    else if (EXTS.has(path.extname(ent.name))) out.push(abs);
  }
  return out;
}

function zoneFor(rel) {
  if (rel.startsWith('frontend/src/products/')) return 'products';
  if (rel.startsWith('frontend/src/shared/')) return 'shared';
  if (rel.startsWith('frontend/src/surfaces/')) return 'surfaces';
  if (rel.includes('.test.') || rel.includes('.spec.')) return 'tests';
  return 'other';
}

function resolveImportAbs(fromAbs, spec) {
  if (spec.startsWith('@/')) return path.join(ROOT, spec.slice(2));
  if (spec.startsWith('.')) return path.resolve(path.dirname(fromAbs), spec);
  return null;
}

function isLegacyLibApiImport(fromAbs, spec) {
  const resolved = resolveImportAbs(fromAbs, spec);
  if (!resolved) return false;
  const normalized = toPosix(resolved);
  const libApiRoot = toPosix(path.join(ROOT, 'frontend/src/lib/api'));
  return normalized === libApiRoot || normalized.startsWith(`${libApiRoot}/`);
}

const scanRoots = ['src', 'pages', 'components']
  .map((p) => path.join(ROOT, p))
  .filter((p) => fs.existsSync(p));
const files = scanRoots.flatMap((p) => walk(p));
const importRe = /from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

const hits = [];
for (const absFile of files) {
  const relFile = toPosix(path.relative(ROOT, absFile));
  const text = fs.readFileSync(absFile, 'utf8');
  let m;
  while ((m = importRe.exec(text)) !== null) {
    const spec = String(m[1] || m[2] || '').trim();
    if (!spec) continue;
    if (!isLegacyLibApiImport(absFile, spec)) continue;
    hits.push({ file: relFile, spec, zone: zoneFor(relFile) });
  }
}

const byZone = new Map();
for (const h of hits) {
  byZone.set(h.zone, (byZone.get(h.zone) || 0) + 1);
}

const lines = [];
lines.push(`legacy-api-imports: total=${hits.length}`);
for (const zone of ['products', 'features', 'pages', 'components', 'tests', 'shared', 'surfaces', 'other']) {
  const count = byZone.get(zone) || 0;
  if (count > 0) lines.push(` - ${zone}: ${count}`);
}

const actionable = hits.filter((h) => !ALLOWLIST.has(h.file));

if (hits.length > 0) {
  lines.push('\nlegacy-api-imports: references');
  for (const h of hits) {
    const allowTag = ALLOWLIST.has(h.file) ? ' (allowlisted)' : '';
    lines.push(` - [${h.zone}] ${h.file} -> "${h.spec}"${allowTag}`);
  }
}

if (actionable.length > 0) {
  console.error(`${lines.join('\n')}\n\nlegacy-api-imports: failed`);
  process.exit(1);
}

console.log(lines.join('\n'));

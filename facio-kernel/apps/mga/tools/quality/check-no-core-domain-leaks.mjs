#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { readChangedNameStatus } from './lib/ci-diff-range.mjs';

const ROOT = process.cwd();
const CORE_DIR = path.join(ROOT, 'backend', 'core');
const exts = new Set(['.ts', '.tsx', '.js', '.mjs']);

const bannedTokens = [
  'policy',
  'claim',
  'binder',
  'premium',
  'bordereaux',
  'vehicle',
  'quote',
  'underwrite',
  'endorse',
  'fnol',
  'coverage',
  'deductible',
  'commission',
  'risk',
];

const legacyAllowedCoreFiles = new Set([]);

function toPosix(p) {
  return p.replaceAll('\\', '/');
}

function read(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}

function walk(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else if (exts.has(path.extname(ent.name))) out.push(p);
  }
  return out;
}

function rel(p) {
  return toPosix(path.relative(ROOT, p));
}

const failures = [];

if (!fs.existsSync(CORE_DIR)) {
  console.log('core guard OK');
  process.exit(0);
}

const allCoreFiles = walk(CORE_DIR);
for (const fileAbs of allCoreFiles) {
  if (rel(fileAbs).includes('/__tests__/')) continue;
  const text = read(fileAbs);
  const importRe = /from\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = importRe.exec(text)) !== null) {
    const spec = String(m[1] || '');
    if (spec.includes('/modules/') || spec.startsWith('../modules') || spec.startsWith('backend/modules')) {
      failures.push(`[core-imports-modules] ${rel(fileAbs)} imports "${spec}"`);
    }
  }
}

const changed = readChangedNameStatus()
  .filter((c) => c.status.startsWith('A'))
  .map((c) => path.join(ROOT, c.file))
  .filter((abs) => abs.startsWith(CORE_DIR) && exts.has(path.extname(abs)) && fs.existsSync(abs));

for (const fileAbs of changed) {
  if (legacyAllowedCoreFiles.has(rel(fileAbs))) continue;
  if (rel(fileAbs).includes('/__tests__/')) continue;
  if (rel(fileAbs).startsWith('backend/core/platform/')) continue;
  const fileRel = rel(fileAbs).toLowerCase();
  const text = read(fileAbs).toLowerCase();
  for (const token of bannedTokens) {
    if (fileRel.includes(token) || text.includes(token)) {
      failures.push(`[core-domain-token] ${rel(fileAbs)} matched "${token}"`);
      break;
    }
  }
}

if (failures.length) {
  console.error('\nCORE GUARD FAILED:\n' + failures.map((x) => ` - ${x}`).join('\n') + '\n');
  process.exit(1);
}

console.log('core guard OK');

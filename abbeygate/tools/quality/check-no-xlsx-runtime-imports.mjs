#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const TARGET_DIRS = [
  path.join(ROOT, 'backend'),
];
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs']);
const IMPORT_RE = /from\s+['"]xlsx['"]|import\(\s*['"]xlsx['"]\s*\)/;

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'build') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
      continue;
    }
    if (EXTENSIONS.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

function toRel(abs) {
  return path.relative(ROOT, abs).replaceAll('\\', '/');
}

const offenders = [];
for (const target of TARGET_DIRS) {
  if (!fs.existsSync(target)) continue;
  for (const file of walk(target)) {
    const rel = toRel(file);
    if (rel.includes('/__tests__/')) continue;
    const source = fs.readFileSync(file, 'utf8');
    if (IMPORT_RE.test(source)) offenders.push(rel);
  }
}

if (offenders.length > 0) {
  console.error('Runtime xlsx import guard failed:\n');
  for (const file of offenders) console.error(`- ${file}`);
  process.exit(1);
}

console.log('Runtime xlsx import guard passed.');

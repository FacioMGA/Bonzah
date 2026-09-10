#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const TARGET_DIR = path.join(ROOT, 'tools', 'quality');
const EXTS = new Set(['.mjs', '.js', '.ts']);
const RETIRED_PATTERNS = [
  /server\/src/g,
  /server\/test/g,
  /path\.join\(\s*ROOT\s*,\s*['"]server['"]/g,
];

function toPosix(value) {
  return String(value || '').replaceAll('\\', '/');
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'build') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (EXTS.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

const violations = [];
for (const file of walk(TARGET_DIR)) {
  const rel = toPosix(path.relative(ROOT, file));
  const content = fs.readFileSync(file, 'utf8');
  for (const pattern of RETIRED_PATTERNS) {
    const matches = content.match(pattern);
    if (matches?.length) {
      violations.push(`${rel} -> matched ${pattern}`);
    }
  }
}

if (violations.length > 0) {
  console.error('[retired-path-references] FAILED');
  for (const line of violations) console.error(` - ${line}`);
  process.exit(1);
}

console.log('[retired-path-references] OK');

#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const MODULES_DIR = path.join(ROOT, 'backend', 'modules');
const ALLOWLIST_FILE = path.join(ROOT, 'tools', 'quality', 'domain-purity-allowlist.json');

function toPosix(p) {
  return p.replaceAll('\\', '/');
}

function rel(p) {
  return toPosix(path.relative(ROOT, p));
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === 'build') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (path.extname(entry.name) === '.ts') out.push(full);
  }
  return out;
}

function readAllow() {
  if (!fs.existsSync(ALLOWLIST_FILE)) return new Set();
  const parsed = JSON.parse(fs.readFileSync(ALLOWLIST_FILE, 'utf8'));
  return new Set(Array.isArray(parsed.allow) ? parsed.allow : []);
}

const importRe = /from\s+['"]([^'"]+)['"]/g;
const allow = readAllow();
const violations = [];

for (const file of walk(MODULES_DIR)) {
  const fileRel = rel(file);
  if (!fileRel.includes('/domain/')) continue;
  if (fileRel.includes('/__tests__/')) continue;

  const source = fs.readFileSync(file, 'utf8');
  let match;
  let isImpure = false;
  while ((match = importRe.exec(source)) !== null) {
    const spec = String(match[1] || '');
    if (spec.includes('/platform/db/connection') || spec === '@prisma/client') {
      isImpure = true;
      break;
    }
  }
  if (!isImpure) continue;
  if (!allow.has(fileRel)) {
    violations.push(fileRel);
  }
}

if (violations.length > 0) {
  console.error('Domain purity guard failed. Unallowlisted domain impurities:\n');
  for (const v of violations) console.error(`- ${v}`);
  console.error('\nRemove DB/Prisma imports from domain, or temporarily ticket and add to tools/quality/domain-purity-allowlist.json.');
  process.exit(1);
}

console.log('Domain purity guard passed.');

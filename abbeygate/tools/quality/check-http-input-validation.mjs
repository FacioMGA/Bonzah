#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SERVER_SRC = path.join(ROOT, 'backend');
const ALLOWLIST_FILE = path.join(ROOT, 'tools', 'quality', 'http-input-validation-allowlist.json');

const SCAN_EXT = new Set(['.ts']);
const VALIDATION_HINT_RE = /safeParse|\.parse\(|z\.object|parseRecord|ZodError|CreateSessionBodySchema|PatchSessionBodySchema|RateSessionBodySchema/i;
const IGNORE_FILE_RE = /backend\/api\/middleware\/logger\.ts$/;

function toPosix(p) {
  return p.replaceAll('\\', '/');
}

function rel(p) {
  return toPosix(path.relative(ROOT, p));
}

function walk(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === 'dist' || ent.name === 'build') continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(full));
    else if (SCAN_EXT.has(path.extname(ent.name))) out.push(full);
  }
  return out;
}

function readAllowlist() {
  if (!fs.existsSync(ALLOWLIST_FILE)) return new Set();
  const parsed = JSON.parse(fs.readFileSync(ALLOWLIST_FILE, 'utf8'));
  return new Set(Array.isArray(parsed.allow) ? parsed.allow : []);
}

const allow = readAllowlist();
const violations = [];

for (const file of walk(SERVER_SRC)) {
  const fileRel = rel(file);
  if (IGNORE_FILE_RE.test(fileRel)) continue;
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].includes('req.body')) continue;
    const key = `${fileRel}:${i + 1}`;
    if (allow.has(key)) continue;

    const start = Math.max(0, i - 14);
    const end = Math.min(lines.length - 1, i + 14);
    const windowText = lines.slice(start, end + 1).join('\n');
    if (!VALIDATION_HINT_RE.test(windowText)) {
      violations.push(key);
    }
  }
}

if (violations.length > 0) {
  console.error('HTTP input validation guard failed. Unvalidated req.body usage found:\n');
  for (const v of violations) console.error(`- ${v}`);
  console.error('\nFix by adding strict request validation (safeParse/parse schema) or add ticketed allowlist entry.');
  process.exit(1);
}

console.log('HTTP input validation guard passed.');

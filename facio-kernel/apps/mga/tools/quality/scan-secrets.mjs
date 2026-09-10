#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const maxBytes = 1024 * 1024;
const ignoreDirs = new Set(['.git', 'node_modules', 'dist', 'build', '.cursor']);
const textExt = new Set([
  '.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.yml', '.yaml', '.env', '.md', '.sh', '.txt', '.sql',
]);
const allowTokens = ['change-me', 'example', 'sample', 'dummy', 'test', 'dev', 'placeholder', 'mock'];

const rules = [
  { id: 'private-key', re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { id: 'aws-key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'api-key-assignment', re: /\b(api[_-]?key|secret|token)\b\s*[:=]\s*['"][A-Za-z0-9_\-]{20,}['"]/i },
];

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ignoreDirs.has(ent.name)) continue;
      walk(p, out);
      continue;
    }
    const ext = path.extname(ent.name).toLowerCase();
    if (!textExt.has(ext)) continue;
    out.push(p);
  }
  return out;
}

function shouldIgnoreLine(line) {
  const lower = line.toLowerCase();
  return allowTokens.some((token) => lower.includes(token));
}

const failures = [];
for (const abs of walk(root)) {
  const rel = path.relative(root, abs).replaceAll('\\', '/');
  const st = fs.statSync(abs);
  if (st.size > maxBytes) continue;
  const text = fs.readFileSync(abs, 'utf8');
  const lines = text.split('\n');
  lines.forEach((line, idx) => {
    if (shouldIgnoreLine(line)) return;
    for (const rule of rules) {
      if (rule.re.test(line)) {
        failures.push(`${rel}:${idx + 1} [${rule.id}] ${line.trim().slice(0, 140)}`);
      }
    }
  });
}

if (failures.length > 0) {
  console.error('\n[scan-secrets] FAILED\n');
  for (const f of failures.slice(0, 50)) console.error(` - ${f}`);
  if (failures.length > 50) console.error(` - ... and ${failures.length - 50} more`);
  process.exit(1);
}

console.log('[scan-secrets] OK');

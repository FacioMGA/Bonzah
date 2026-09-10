#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const targets = [
  'backend/modules/communications/domain/webhooks',
];
const allowedClientImport = "platform/http/safeHttpClient";
const disallowedPatterns = [/(\W|^)fetch\(/, /from\s+['"]axios['"]/, /from\s+['"]node-fetch['"]/];
const exts = new Set(['.ts', '.tsx', '.js', '.mjs']);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (exts.has(path.extname(entry.name))) out.push(p);
  }
  return out;
}

const failures = [];
for (const target of targets) {
  const absTarget = path.join(root, target);
  for (const file of walk(absTarget)) {
    const rel = file.replace(`${root}${path.sep}`, '').replaceAll('\\', '/');
    if (rel.includes('/__tests__/') || rel.endsWith('.test.ts') || rel.endsWith('.spec.ts')) continue;
    const text = fs.readFileSync(file, 'utf8');
    if (!text.includes(allowedClientImport)) {
      failures.push(`[outbound-http-boundary] ${rel} must import ${allowedClientImport}`);
    }
    for (const pattern of disallowedPatterns) {
      if (pattern.test(text)) {
        failures.push(`[outbound-http-boundary] ${rel} uses disallowed outbound call primitive (${pattern})`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error('\n[outbound-http-boundary] FAILED\n');
  for (const line of failures) console.error(` - ${line}`);
  process.exit(1);
}
console.log('[outbound-http-boundary] OK');

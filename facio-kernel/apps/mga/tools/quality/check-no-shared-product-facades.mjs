#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

const TARGETS = [
  'backend/modules/policy/app/quoteDataSchema.ts',
  'backend/modules/pricing/app/canonicalRules.ts',
];

const BANNED_IMPORT_PATTERNS = [
  /products\/motor\//,
  /products\/home\//,
  /products\/travel\//,
];

const failures = [];

for (const relPath of TARGETS) {
  const absPath = path.join(ROOT, relPath);
  if (!fs.existsSync(absPath)) continue;
  const content = fs.readFileSync(absPath, 'utf8');
  const lines = content.split('\n');
  for (let idx = 0; idx < lines.length; idx += 1) {
    const line = lines[idx];
    if (!/\bfrom\s+['"]|import\(/.test(line)) continue;
    for (const pattern of BANNED_IMPORT_PATTERNS) {
      if (pattern.test(line)) {
        failures.push(`${relPath}:${idx + 1} ${line.trim()}`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error('Shared product facades detected in stop-ship backend surfaces.');
  console.error('These files must stay generic and must not import product-owned implementations directly.');
  console.error('');
  for (const failure of failures) console.error(`  ${failure}`);
  console.error('');
  process.exit(1);
}

console.log('OK: no shared product facades in protected backend surfaces.');

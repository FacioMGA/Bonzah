#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const domainsDir = path.join(ROOT, 'frontend', 'src', 'domains');

if (!fs.existsSync(domainsDir)) {
  console.log('[domains-transitional-zone] skipped (src/domains not present)');
  process.exit(0);
}

const violations = [];

for (const ent of fs.readdirSync(domainsDir, { withFileTypes: true })) {
  if (ent.name === 'index.ts') continue;
  const p = path.join(domainsDir, ent.name);
  if (ent.isFile()) {
    violations.push(`unexpected file: src/domains/${ent.name}`);
    continue;
  }
  if (!ent.isDirectory()) continue;
  const files = fs.readdirSync(p).filter((name) => !name.startsWith('.'));
  const invalid = files.filter((name) => name !== 'index.ts');
  if (!files.includes('index.ts')) {
    violations.push(`missing index export: src/domains/${ent.name}/index.ts`);
  }
  for (const name of invalid) {
    violations.push(`non-transitional file: src/domains/${ent.name}/${name}`);
  }
}

if (violations.length > 0) {
  console.error('\n[domains-transitional-zone] FAILED:\n' + violations.map((v) => ` - ${v}`).join('\n') + '\n');
  process.exit(1);
}

console.log('[domains-transitional-zone] OK');

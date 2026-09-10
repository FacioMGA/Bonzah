#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const TOOLS = path.join(ROOT, 'tools');
const OWNERS = ['quality', 'migrations', 'maintenance'];
const ALLOWLIST = new Set(['.gitkeep']);

const byName = new Map();

for (const owner of OWNERS) {
  const dir = path.join(TOOLS, owner);
  if (!fs.existsSync(dir)) continue;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const ent of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, ent.name);
      if (ent.isDirectory()) {
        stack.push(full);
        continue;
      }
      const rel = path.relative(TOOLS, full).replaceAll('\\', '/');
      if (!byName.has(ent.name)) byName.set(ent.name, []);
      byName.get(ent.name).push(rel);
    }
  }
}

const failures = [];
for (const [name, paths] of byName.entries()) {
  if (paths.length < 2) continue;
  if (ALLOWLIST.has(name)) continue;
  failures.push(`${name}: ${paths.join(', ')}`);
}

if (failures.length) {
  console.error('\n[tools-duplicate-ownership] FAILED:\n' + failures.map((f) => ` - ${f}`).join('\n') + '\n');
  process.exit(1);
}

console.log('[tools-duplicate-ownership] OK');

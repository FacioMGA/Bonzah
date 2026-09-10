#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const conformanceDir = path.join(root, 'backend/products/__tests__');
const failures = [];
const banned = [
  /\b['"]MOTOR['"]/g,
  /\b['"]HOME['"]/g,
  /\b['"]TRAVEL['"]/g,
  /\bproductType\s*===\s*['"]/g,
  /\bswitch\s*\([^)]*productType[^)]*\)/g,
];

for (const entry of fs.readdirSync(conformanceDir, { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  if (!/^productConformance\..*\.test\.ts$/.test(entry.name)) continue;
  const relPath = `backend/products/__tests__/${entry.name}`;
  const text = fs.readFileSync(path.join(conformanceDir, entry.name), 'utf8');
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    for (const pattern of banned) {
      pattern.lastIndex = 0;
      if (pattern.test(line)) {
        failures.push(`${relPath}:${index + 1}: conformance tests must not branch on product literals`);
      }
    }
  });
}

if (failures.length > 0) {
  console.error('Product literal guard failed in conformance tests:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('No product literals in conformance tests.');

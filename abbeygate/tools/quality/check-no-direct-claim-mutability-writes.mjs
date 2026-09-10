import fs from 'node:fs';
import path from 'node:path';

const serverDir = path.resolve('backend');

function walkTsFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTsFiles(full));
    else if (entry.isFile() && full.endsWith('.ts') && !full.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

const files = walkTsFiles(serverDir).filter((f) => {
  const normalized = f.replace(/\\/g, '/');
  if (normalized.endsWith('.test.ts')) return false;
  // Allow the dedicated command boundary to perform legacy projection sync writes.
  if (normalized.endsWith('core/claims/worksheetCommands.ts')) return false;
  // CHAMPS migration: worksheet command boundary now lives in modules/claims/app.
  if (normalized.endsWith('modules/claims/app/worksheetRepo.ts')) return false;
  return true;
});
const violations = [];

const claimUpdatePattern = /claim\.update\(\{[\s\S]{0,1400}?\}\);/g;
const dataObjectPattern = /data\s*:\s*\{([\s\S]{0,800}?)\}/;
const forbiddenDataFields = ['status', 'amountReserved', 'amountPaid'];

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  const matches = [...content.matchAll(claimUpdatePattern)];
  for (const match of matches) {
    const block = String(match[0] || '');
    const dataMatch = block.match(dataObjectPattern);
    const dataBody = String(dataMatch?.[1] || '');
    const hasForbidden = forbiddenDataFields.some((field) => new RegExp(`\\b${field}\\s*:`).test(dataBody));
    if (!hasForbidden) continue;
    const snippet = content
      .slice(Math.max(0, (match.index || 0) - 60), Math.min(content.length, (match.index || 0) + 260))
      .replace(/\s+/g, ' ')
      .trim();
    violations.push({ file: path.relative(process.cwd(), file), snippet });
  }
}

if (violations.length > 0) {
  // eslint-disable-next-line no-console
  console.error('[direct-claim-mutability-write-check] Found forbidden direct claim mutable writes outside command boundary:');
  for (const v of violations) {
    // eslint-disable-next-line no-console
    console.error(`- ${v.file}: ${v.snippet}`);
  }
  process.exit(1);
}

// eslint-disable-next-line no-console
console.log('[direct-claim-mutability-write-check] ok');

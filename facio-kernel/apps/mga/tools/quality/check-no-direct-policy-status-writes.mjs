import fs from 'node:fs';
import path from 'node:path';

// Scan HTTP route layers that can mutate policies. Only `statusRouter.ts`
// (the canonical status owner) may write `policy.update({ data: { status: ... } })`
// directly; every other router must delegate to `transitionPolicyLifecycle`.
const ROUTE_DIRS = [
  path.resolve('backend/modules/policy/http'),
  path.resolve('backend/modules/quotes/http'),
];
const ALLOW_LIST = new Set([
  path.resolve('backend/modules/policy/http/statusRouter.ts'),
]);

function walkTsFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkTsFiles(full));
      continue;
    }
    if (entry.isFile() && full.endsWith('.ts') && !full.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

const files = ROUTE_DIRS.flatMap((dir) => walkTsFiles(dir)).filter((f) => !ALLOW_LIST.has(f));
const violations = [];

const policyUpdatePattern = /policy\.update\(\{[\s\S]{0,1000}?\}\);/g;
const dataObjectPattern = /data\s*:\s*\{([\s\S]{0,400}?)\}/;

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  const matches = [...content.matchAll(policyUpdatePattern)];
  for (const match of matches) {
    const block = String(match[0] || '');
    const dataMatch = block.match(dataObjectPattern);
    const dataBody = String(dataMatch?.[1] || '');
    if (!/\bstatus\s*:/.test(dataBody) && !/\bbo_status\s*:/.test(dataBody)) continue;
    const start = Math.max(0, (match.index || 0) - 60);
    const end = Math.min(content.length, (match.index || 0) + 260);
    const snippet = content.slice(start, end).replace(/\s+/g, ' ').trim();
    violations.push({
      file: path.relative(process.cwd(), file),
      snippet,
    });
  }
}

if (violations.length > 0) {
  // eslint-disable-next-line no-console
  console.error('[direct-policy-status-write-check] Found forbidden direct policy status writes in route handlers:');
  for (const v of violations) {
    // eslint-disable-next-line no-console
    console.error(`- ${v.file}: ${v.snippet}`);
  }
  process.exit(1);
}

// eslint-disable-next-line no-console
console.log('[direct-policy-status-write-check] ok');


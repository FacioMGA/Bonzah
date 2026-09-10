#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const TARGETS = [
  path.join(ROOT, 'backend'),
  path.join(ROOT, 'backend', 'test'),
];
const exts = new Set(['.ts', '.tsx', '.js', '.mjs']);

const bannedImportMatchers = [
  { re: /^(?:\.\.\/|\.\/)*(?:backend\/)?core\//, label: 'core/*' },
  { re: /^(?:\.\.\/|\.\/)*(?:backend\/)?services\//, label: 'services/*' },
  { re: /^(?:\.\.\/|\.\/)*(?:backend\/)?workers\//, label: 'workers/*' },
];

const allowlist = [];

function toPosix(p) {
  return p.replaceAll('\\', '/');
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else if (exts.has(path.extname(ent.name)) && /\.test\./.test(ent.name)) out.push(p);
  }
  return out;
}

function isAllowed(fileRel, spec) {
  return allowlist.some((rule) => rule.file === fileRel && rule.importRe.test(spec));
}

const importFromRe = /from\s+['"]([^'"]+)['"]/g;
const bareImportRe = /import\s+['"]([^'"]+)['"]/g;
const dynamicImportRe = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
const viMockRe = /vi\.(?:mock|doMock|unmock)\(\s*['"]([^'"]+)['"]/g;
const failures = [];

function checkSpecifier(fileRel, spec, kind) {
  const normalized = String(spec || '').toLowerCase();
  const hit = bannedImportMatchers.find((rule) => rule.re.test(normalized));
  if (!hit) return;
  if (isAllowed(fileRel, spec)) return;
  failures.push(`${fileRel} -> "${spec}" (${hit.label}) via ${kind}`);
}

const files = TARGETS.flatMap((dir) => walk(dir));
for (const fileAbs of files) {
  const fileRel = toPosix(path.relative(ROOT, fileAbs));
  const text = fs.readFileSync(fileAbs, 'utf8');
  const matchers = [
    { re: importFromRe, kind: 'import-from' },
    { re: bareImportRe, kind: 'import-bare' },
    { re: dynamicImportRe, kind: 'import-dynamic' },
    { re: viMockRe, kind: 'vi.mock' },
  ];

  for (const { re, kind } of matchers) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const spec = String(m[1] || '');
      checkSpecifier(fileRel, spec, kind);
    }
  }
}

if (failures.length) {
  console.error('\n[test-import-zones] FAILED\n');
  for (const failure of failures) {
    console.error(` - ${failure}`);
  }
  console.error('\nImport test dependencies from modules/* unless explicitly allowlisted.\n');
  process.exit(1);
}

console.log('[test-import-zones] OK');

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SEARCH_ROOT = path.resolve(ROOT, 'frontend', 'src');
const CODE_FILE_RE = /\.(ts|tsx|js|jsx|mjs)$/;
const RETIRED_IMPORT_RE = /from\s+['"]@\/pages\/[^'"]+['"]|import\(\s*['"]@\/pages\/[^'"]+['"]\s*\)/g;

function walkFiles(dirAbs) {
  const out = [];
  const entries = fs.readdirSync(dirAbs, { withFileTypes: true });
  for (const entry of entries) {
    const abs = path.join(dirAbs, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
      out.push(...walkFiles(abs));
      continue;
    }
    if (entry.isFile() && CODE_FILE_RE.test(abs)) out.push(abs);
  }
  return out;
}

if (!fs.existsSync(SEARCH_ROOT)) {
  console.log('[retired-pages-import-guard] skipped (frontend/src missing)');
  process.exit(0);
}

const violations = [];
for (const fileAbs of walkFiles(SEARCH_ROOT)) {
  const rel = path.relative(ROOT, fileAbs).replaceAll(path.sep, '/');
  const content = fs.readFileSync(fileAbs, 'utf8');
  const matches = [...content.matchAll(RETIRED_IMPORT_RE)];
  if (!matches.length) continue;
  violations.push({
    file: rel,
    import: matches[0][0],
  });
}

if (violations.length) {
  console.error('[retired-pages-import-guard] "@/pages/*" imports are forbidden.');
  for (const v of violations) {
    console.error(`- ${v.file}: ${v.import}`);
  }
  process.exit(1);
}

console.log('[retired-pages-import-guard] ok');

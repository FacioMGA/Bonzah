import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SEARCH_DIRS = ['components', 'pages', 'src'];
const SHARED_UI_ROOT_ALIAS = '@/src/shared/ui';
const DEEP_IMPORT_RE =
  /(?:import\s+[\s\S]*?\s+from\s*|import\s*)(['"])([^'"]+)\1/g;

function isCodeFile(fileName) {
  return /\.(ts|tsx|js|jsx|mjs)$/.test(fileName);
}

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
    if (entry.isFile() && isCodeFile(abs)) out.push(abs);
  }
  return out;
}

function isDeepSharedUiImport(specifier) {
  return specifier.startsWith(`${SHARED_UI_ROOT_ALIAS}/`);
}

const violations = [];
for (const relDir of SEARCH_DIRS) {
  const dirAbs = path.resolve(ROOT, relDir);
  if (!fs.existsSync(dirAbs)) continue;
  const files = walkFiles(dirAbs);
  for (const fileAbs of files) {
    const rel = path.relative(ROOT, fileAbs).replaceAll(path.sep, '/');
    if (rel.startsWith('frontend/src/shared/ui/')) continue;

    const content = fs.readFileSync(fileAbs, 'utf8');
    let match;
    while ((match = DEEP_IMPORT_RE.exec(content)) !== null) {
      const specifier = match[2];
      if (!isDeepSharedUiImport(specifier)) continue;
      violations.push({ file: rel, specifier });
    }
  }
}

if (violations.length) {
  // eslint-disable-next-line no-console
  console.error('[shared-ui-import-guard] Deep shared-ui imports are not allowed outside src/shared/ui. Use "@/src/shared/ui" barrel import instead.');
  for (const v of violations) {
    // eslint-disable-next-line no-console
    console.error(`- ${v.file}: ${v.specifier}`);
  }
  process.exit(1);
}

// eslint-disable-next-line no-console
console.log('[shared-ui-import-guard] ok');

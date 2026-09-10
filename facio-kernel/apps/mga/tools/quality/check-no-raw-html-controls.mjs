import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SEARCH_DIRS = ['components', 'pages', 'src'];
const CONTROL_RE = /<(button|input|select|textarea)\b/g;

// Intentional native control files:
// - primitive component sources
// - test fixtures
// - a few bespoke controls (e.g. range sliders/custom dropdown shells)
const ALLOWLIST = new Set([
  'frontend/src/products/policies/quote_wizard/components/steps/Step4Quote.test.tsx',
  'frontend/src/products/policies/quote_wizard/components/steps/Step5IssueDetails.test.tsx',
  'frontend/src/core/recordList/ui/RecordListView.tsx',
  'frontend/src/shared/core/recordList/ui/RecordListView.tsx',
  'frontend/src/shared/core/recordList/ui/PoliciesFiltersModal.tsx',
  'frontend/src/shared/core/recordList/ui/RecordListDataTable.tsx',
  'frontend/src/shared/ui/primitives/Checkbox.tsx',
  'frontend/src/shared/ui/primitives/Input.tsx',
  'frontend/src/shared/ui/primitives/RadioGroup.tsx',
  'frontend/src/shared/ui/primitives/SearchableSelect.tsx',
  'frontend/src/shared/ui/primitives/Select.tsx',
  'frontend/src/shared/ui/primitives/Textarea.tsx',
  'frontend/src/shared/ui/primitives/FileUpload.tsx',
  'frontend/src/shared/ui/primitives/wizard/Input.tsx',
  'frontend/src/shared/ui/primitives/wizard/SearchableSelect.tsx',
  'frontend/src/shared/ui/primitives/wizard/Select.tsx',
  'frontend/src/shared/ui/primitives/wizard/Textarea.tsx',
]);

function walkTsxFiles(dirAbs) {
  const out = [];
  const entries = fs.readdirSync(dirAbs, { withFileTypes: true });
  for (const entry of entries) {
    const abs = path.join(dirAbs, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
      out.push(...walkTsxFiles(abs));
      continue;
    }
    if (entry.isFile() && abs.endsWith('.tsx')) out.push(abs);
  }
  return out;
}

const violations = [];
for (const relDir of SEARCH_DIRS) {
  const dirAbs = path.resolve(ROOT, relDir);
  if (!fs.existsSync(dirAbs)) continue;
  const files = walkTsxFiles(dirAbs);
  for (const fileAbs of files) {
    const rel = path.relative(ROOT, fileAbs).replaceAll(path.sep, '/');
    if (ALLOWLIST.has(rel)) continue;
    const content = fs.readFileSync(fileAbs, 'utf8');
    const matches = [...content.matchAll(CONTROL_RE)];
    if (matches.length === 0) continue;
    const first = matches[0];
    const idx = first.index || 0;
    const snippet = content
      .slice(Math.max(0, idx - 80), Math.min(content.length, idx + 120))
      .replace(/\s+/g, ' ')
      .trim();
    violations.push({ file: rel, count: matches.length, snippet });
  }
}

if (violations.length) {
  // eslint-disable-next-line no-console
  console.error('[raw-html-controls-guard] Found raw HTML controls outside allowlist:');
  for (const v of violations) {
    // eslint-disable-next-line no-console
    console.error(`- ${v.file} (${v.count} matches): ${v.snippet}`);
  }
  process.exit(1);
}

// eslint-disable-next-line no-console
console.log('[raw-html-controls-guard] ok');

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const exts = new Set(['.ts', '.tsx']);
const failures = [];

const LEGACY_ALLOWLIST = new Set([
  'frontend/src/products/claims/views/desk/ClaimsDeskCommunicationsPanel.tsx|@/src/products/policies/components/Communications/CommunicationsTab',
  'frontend/src/products/claims/views/intake/FnolAmendDrawer.tsx|@/src/products/policies/api/policyCrudApiClient',
  'frontend/src/products/claims/views/intake/FnolAmendDrawer.tsx|@/src/products/policies/api/documentsApiClient',
  'frontend/src/products/claims/views/intake/FnolAmendDrawer.tsx|../../../../../frontend/src/products/policies/quote_wizard/config/region',
  'frontend/src/products/claims/views/intake/useClientFnolController.ts|@/src/products/policies/api/documentsApiClient',
  'frontend/src/products/claims/views/intake/useClientFnolController.ts|@/src/products/policies/quote_wizard/config/region',
]);

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else if (exts.has(path.extname(ent.name))) out.push(p);
  }
  return out;
}

function rel(p) {
  return p.replaceAll('\\', '/');
}

function normalizeSpecifier(spec) {
  return String(spec || '')
    .replace(/^@\//, '')
    .replace(/^\.\//, '');
}

function parseProductTarget(spec) {
  const s = normalizeSpecifier(spec);
  const m = s.match(/(?:^|\/)src\/products\/([^/]+)\/(.+)$/) || s.match(/(?:^|\/)products\/([^/]+)\/(.+)$/);
  if (!m) return null;
  return { product: m[1], deepPath: m[2] };
}

function isPublicProductPath(deepPath) {
  return deepPath === 'index' || deepPath === 'index.ts' || deepPath === 'index.tsx' || deepPath.startsWith('public');
}

function fileProduct(relPath) {
  const m = relPath.match(/^src\/products\/([^/]+)\//);
  return m ? m[1] : null;
}

function checkFile(fileAbs, ownerType) {
  const fileRel = rel(path.relative(ROOT, fileAbs));
  const text = fs.readFileSync(fileAbs, 'utf8');
  const importRe = /from\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = importRe.exec(text)) !== null) {
    const spec = m[1];
    const target = parseProductTarget(spec);
    if (!target) continue;
    if (ownerType === 'surface' && !isPublicProductPath(target.deepPath)) {
      failures.push(`[surface->product-deep] ${fileRel} -> "${spec}"`);
      continue;
    }
    if (ownerType === 'product') {
      const ownerProduct = fileProduct(fileRel);
      if (ownerProduct && ownerProduct !== target.product && !isPublicProductPath(target.deepPath)) {
        const key = `${fileRel}|${spec}`;
        if (!LEGACY_ALLOWLIST.has(key)) {
          failures.push(`[product-cross-deep] ${fileRel} -> "${spec}"`);
        }
      }
    }
  }
}

for (const f of walk(path.join(ROOT, 'frontend', 'src', 'surfaces'))) checkFile(f, 'surface');
for (const f of walk(path.join(ROOT, 'frontend', 'src', 'products'))) checkFile(f, 'product');
for (const f of walk(path.join(ROOT, 'pages'))) checkFile(f, 'surface');

if (failures.length > 0) {
  console.error('\n[no-deep-product-imports] FAILED:\n' + failures.map((f) => ` - ${f}`).join('\n') + '\n');
  process.exit(1);
}

console.log('[no-deep-product-imports] OK');

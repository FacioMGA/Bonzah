#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const STRICT = String(process.env.STRICT_ONE_SOURCE_TRUTH || '') === '1';

const FRONTEND_ALLOWED = new Set(['surfaces', 'products', 'modules', 'shared']);
// `seed` houses the per-stage submodules of `backend/seed.ts` after the
// composer split in the errors-and-warnings cleanup sprint. The file
// itself remains at root (`backend/seed.ts`); the directory is the
// composer's per-stage children. Same fixture-bootstrap role as the
// allowlist entries in `check-architecture-locks.mjs` /
// `check-product-engine-contract.mjs`.
const BACKEND_ALLOWED = new Set(['api', 'http', 'modules', 'platform', 'products', 'scripts', 'seed', 'shared', 'test', 'types', 'workers']);
const BACKEND_ROOT_IGNORE = new Set(['dist', 'node_modules', 'tmp']);

const FRONTEND_LEGACY = ['app', 'core', 'features', 'store'];
const BACKEND_LEGACY = ['core', 'db', 'utils', 'data', 'config', 'app', 'domain', 'services'];

function toPosix(value) {
  return String(value || '').replaceAll('\\', '/');
}

function collectSourceRootViolations() {
  const violations = [];

  const srcDir = path.join(ROOT, 'frontend', 'src');
  if (fs.existsSync(srcDir)) {
    for (const ent of fs.readdirSync(srcDir, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      if (FRONTEND_ALLOWED.has(ent.name)) continue;
      violations.push(`[frontend-root] frontend/src/${ent.name} is outside allowed roots (surfaces/products/modules/shared)`);
    }
  }

  const backendDir = path.join(ROOT, 'backend');
  if (fs.existsSync(backendDir)) {
    for (const ent of fs.readdirSync(backendDir, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      if (BACKEND_ROOT_IGNORE.has(ent.name)) continue;
      if (BACKEND_ALLOWED.has(ent.name)) continue;
      violations.push(`[backend-root] backend/${ent.name} is outside allowed roots (api/http/modules/platform/products/scripts/shared/test/types/workers)`);
    }
  }

  return violations;
}

function collectLegacyDirViolations() {
  const violations = [];
  for (const dir of FRONTEND_LEGACY) {
    const p = path.join(ROOT, 'frontend', 'src', dir);
    if (fs.existsSync(p)) violations.push(`[frontend-legacy] src/${dir} exists`);
  }
  for (const dir of BACKEND_LEGACY) {
    const p = path.join(ROOT, 'backend', dir);
    if (fs.existsSync(p)) violations.push(`[backend-legacy] backend/${dir} exists`);
  }
  return violations;
}

function collectDuplicateTreeViolations() {
  const violations = [];
  const platformTestDir = path.join(ROOT, 'backend', 'platform', 'test');
  const platformTestsDir = path.join(ROOT, 'backend', 'platform', 'tests');
  if (fs.existsSync(platformTestDir) && fs.existsSync(platformTestsDir)) {
    violations.push(
      '[backend-duplicate-tree] both backend/platform/test and backend/platform/tests exist; keep a single canonical test root',
    );
  }
  return violations;
}

function collectImportViolations() {
  const violations = [];
  const exts = new Set(['.ts', '.tsx', '.js', '.mjs']);

  const walk = (dir) => {
    const out = [];
    if (!fs.existsSync(dir)) return out;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.isDirectory() && (ent.name === 'node_modules' || ent.name === 'dist' || ent.name === 'build')) continue;
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) out.push(...walk(p));
      else if (exts.has(path.extname(ent.name))) out.push(p);
    }
    return out;
  };

  const extractSpecifiers = (source) => {
    const specs = [];
    const fromRe = /from\s+['"]([^'"]+)['"]/g;
    const dynImportRe = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
    let m;
    while ((m = fromRe.exec(source)) !== null) specs.push(m[1]);
    while ((m = dynImportRe.exec(source)) !== null) specs.push(m[1]);
    return specs;
  };

  const resolveAbs = (fromAbs, specifier) => {
    const spec = String(specifier || '');
    if (!spec) return null;
    if (spec.startsWith('.')) return path.resolve(path.dirname(fromAbs), spec);
    if (spec.startsWith('@/')) return path.join(ROOT, spec.slice(2));
    if (spec.startsWith('frontend/src/')) return path.join(ROOT, spec);
    if (spec.startsWith('backend/')) return path.join(ROOT, spec);
    return null;
  };

  const files = [...walk(path.join(ROOT, 'frontend', 'src')), ...walk(path.join(ROOT, 'backend'))];
  for (const absFile of files) {
    const relFile = toPosix(path.relative(ROOT, absFile));
    if (relFile.includes('/__tests__/') || relFile.includes('.test.') || relFile.includes('.spec.')) continue;
    const content = fs.readFileSync(absFile, 'utf8');
    for (const spec of extractSpecifiers(content)) {
      const targetAbs = resolveAbs(absFile, spec);
      if (!targetAbs) continue;
      const targetRel = toPosix(path.relative(ROOT, targetAbs));
      if (targetRel.startsWith('frontend/src/')) {
        const zone = targetRel.split('/')[2] || '';
        if (!FRONTEND_ALLOWED.has(zone)) {
          violations.push(`[frontend-import] ${relFile} -> ${spec} (${targetRel}) points outside surfaces/products/modules/shared`);
        }
      } else if (targetRel.startsWith('backend/')) {
        const zone = targetRel.split('/')[1] || '';
        if (!BACKEND_ALLOWED.has(zone)) {
          violations.push(`[backend-import] ${relFile} -> ${spec} (${targetRel}) points outside api/http/modules/platform/products/scripts/shared/test/types/workers`);
        }
      }
    }
  }

  return violations;
}

const violations = [
  ...collectSourceRootViolations(),
  ...collectLegacyDirViolations(),
  ...collectDuplicateTreeViolations(),
  ...collectImportViolations(),
];
const unique = Array.from(new Set(violations)).sort();

if (unique.length > 0) {
  const msg = '\n[one-source-truth] violations:\n' + unique.map((v) => ` - ${v}`).join('\n') + '\n';
  if (STRICT) {
    console.error(msg);
    process.exit(1);
  }
  console.warn(msg);
  console.warn('[one-source-truth] running in advisory mode (set STRICT_ONE_SOURCE_TRUTH=1 to enforce).');
  process.exit(0);
}

console.log('[one-source-truth] OK');

#!/usr/bin/env node
// tools/quality/check-docs-code-consistency.mjs
// Guard: every module / worker / guard / contract that exists in code
// must be referenced by its corresponding generated inventory under
// docs/reference/. This is the *coverage completeness* check that
// complements docs:generate:check (which only checks that the file
// matches the generator output verbatim).
//
// Three checks:
//   1. modules: every backend/modules/<name>/ appears in docs/reference/modules.md
//   2. workers: every backend/workers/handlers/<name>.ts appears in docs/reference/workers.md
//   3. guards:  every guard:* / lint:* / verify:* npm script appears in docs/reference/guards.md
//
// Contracts coverage is intentionally deferred until the contracts
// generator has run at least once with real validation contract files
// (post-validation-PR). The guard is wired but no-ops on contracts
// until that PR lands.
//
// Severity: error by default per ADR-0010. Bypass with DOCS_GUARDS_STRICT=0
// (local debug only — never set in CI).

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const REFERENCE_DIR = path.join(REPO_ROOT, 'docs', 'reference');

// Strict by default per ADR-0010 (escalated from warn in this PR). Set
// DOCS_GUARDS_STRICT=0 to bypass (intended for local debugging only).
const STRICT = process.env.DOCS_GUARDS_STRICT !== '0';

const SCRIPT_PREFIXES = ['guard:', 'lint:', 'policy:', 'verify:', 'proof:'];

async function readDocText(name) {
  try {
    return await fs.readFile(path.join(REFERENCE_DIR, name), 'utf8');
  } catch {
    return '';
  }
}

async function listSubdirs(dir) {
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

async function listFiles(dir, ext) {
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(ext))
    .map((e) => e.name);
}

async function checkModules() {
  const modules = await listSubdirs(path.join(REPO_ROOT, 'backend', 'modules'));
  const doc = await readDocText('modules.md');
  return modules.filter((m) => !doc.includes('`' + m + '`'));
}

async function checkWorkers() {
  const handlers = await listFiles(path.join(REPO_ROOT, 'backend', 'workers', 'handlers'), '.ts');
  const doc = await readDocText('workers.md');
  return handlers
    .map((h) => h.replace(/\.ts$/, ''))
    .filter((job) => !doc.includes('`' + job + '`'));
}

async function checkGuards() {
  const pkg = JSON.parse(await fs.readFile(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const scripts = pkg.scripts || {};
  // Only count scripts that the guards generator includes — i.e. scripts
  // whose value invokes a file under tools/quality/. Composite/aggregator
  // scripts (`lint:all`, `policy:any`, etc.) are excluded by design.
  const guardScripts = Object.keys(scripts).filter((name) => {
    if (!SCRIPT_PREFIXES.some((p) => name.startsWith(p))) return false;
    return /tools\/quality\//.test(scripts[name]);
  });
  const doc = await readDocText('guards.md');
  return guardScripts.filter((g) => !doc.includes('`' + g + '`'));
}

async function main() {
  const [missingModules, missingWorkers, missingGuards] = await Promise.all([
    checkModules(),
    checkWorkers(),
    checkGuards(),
  ]);

  const total = missingModules.length + missingWorkers.length + missingGuards.length;
  if (total === 0) {
    console.log('guard:docs-code-consistency: ok (every module / worker / guard appears in its inventory)');
    return;
  }

  console.error(`guard:docs-code-consistency: ${total} coverage gap(s)`);
  if (missingModules.length) {
    console.error('  modules missing from docs/reference/modules.md:');
    for (const m of missingModules) console.error(`    - ${m}`);
  }
  if (missingWorkers.length) {
    console.error('  workers missing from docs/reference/workers.md:');
    for (const w of missingWorkers) console.error(`    - ${w}`);
  }
  if (missingGuards.length) {
    console.error('  guards missing from docs/reference/guards.md:');
    for (const g of missingGuards) console.error(`    - ${g}`);
  }
  console.error('\nFix: run `npm run docs:generate` and commit the result.');

  if (STRICT) process.exit(1);
  console.error('\n(bypassed via DOCS_GUARDS_STRICT=0 — local debug only; CI will fail)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

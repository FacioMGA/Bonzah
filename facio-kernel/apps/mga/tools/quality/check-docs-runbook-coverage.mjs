#!/usr/bin/env node
// tools/quality/check-docs-runbook-coverage.mjs
// Guard: every BullMQ worker handler under backend/workers/handlers/ MUST
// appear either in a docs/operate/*.md runbook OR in the generated
// docs/reference/runbooks-coverage.md catalogue. The catalogue is the
// structural source: it is built from disk by
// tools/docs/generate-runbooks-coverage.mjs and kept current by
// `npm run docs:generate:check` in CI.
//
// Severity: error by default per ADR-0010. Bypass with DOCS_GUARDS_STRICT=0
// (local debug only — never set in CI).

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const HANDLERS_DIR = path.join(REPO_ROOT, 'backend', 'workers', 'handlers');
const OPERATE_DIR = path.join(REPO_ROOT, 'docs', 'operate');
const RUNBOOKS_COVERAGE_DOC = path.join(
  REPO_ROOT,
  'docs',
  'reference',
  'runbooks-coverage.md',
);

// Strict by default per ADR-0010 (escalated from warn in this PR). Set
// DOCS_GUARDS_STRICT=0 to bypass (intended for local debugging only).
const STRICT = process.env.DOCS_GUARDS_STRICT !== '0';

async function listJobNames() {
  let entries = [];
  try {
    entries = await fs.readdir(HANDLERS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.ts'))
    .map((e) => e.name.replace(/\.ts$/, ''));
}

async function readOperateCorpus() {
  let entries = [];
  try {
    entries = await fs.readdir(OPERATE_DIR, { withFileTypes: true });
  } catch {
    return '';
  }
  const texts = await Promise.all(
    entries
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .map((e) => fs.readFile(path.join(OPERATE_DIR, e.name), 'utf8')),
  );
  return texts.join('\n').toLowerCase();
}

async function readReferenceCatalogue() {
  try {
    return (await fs.readFile(RUNBOOKS_COVERAGE_DOC, 'utf8')).toLowerCase();
  } catch {
    return '';
  }
}

async function main() {
  const jobs = await listJobNames();
  const operateCorpus = await readOperateCorpus();
  const catalogue = await readReferenceCatalogue();
  const corpus = operateCorpus + '\n' + catalogue;
  const uncovered = jobs.filter((job) => !corpus.includes(job.toLowerCase()));

  if (uncovered.length === 0) {
    console.log(
      `guard:docs-runbook-coverage: ok (${jobs.length} jobs covered via operate/* + reference catalogue)`,
    );
    return;
  }

  console.error(
    `guard:docs-runbook-coverage: ${uncovered.length} job(s) missing from operate/* AND reference/runbooks-coverage.md`,
  );
  for (const j of uncovered) {
    console.error(`  - ${j}`);
  }
  console.error(
    `\nFix: run \`npm run docs:generate\` to refresh the catalogue, then commit.`,
  );

  if (STRICT) process.exit(1);
  console.error('\n(bypassed via DOCS_GUARDS_STRICT=0 — local debug only; CI will fail)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

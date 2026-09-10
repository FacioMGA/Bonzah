// tools/docs/generate-runbooks-coverage.mjs
//
// Generator: docs/reference/runbooks-coverage.md
// Single canonical worker-handler catalogue and runbook coverage map.
// The catalogue is built from disk (`backend/workers/handlers/*.ts`) so
// it cannot drift; runbooks under docs/operate/ are scanned for matches.
// `guard:docs-runbook-coverage` accepts presence either in operate/* OR
// in this generated file — the generator IS the structural source.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lastChangedFor } from './lib/git.mjs';
import { parseFrontmatter, serializeFrontmatter } from './lib/frontmatter.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const OPERATE_DIR = path.join(REPO_ROOT, 'docs', 'operate');
const HANDLERS_DIR = path.join(REPO_ROOT, 'backend', 'workers', 'handlers');

async function listRunbooks() {
  let entries = [];
  try {
    entries = await fs.readdir(OPERATE_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.md') && e.name !== 'README.md')
    .map((e) => e.name)
    .sort();
}

function extractTriggerSection(body) {
  const headings = ['## Trigger', '## When to use this runbook', '## When to use', '## Triggers'];
  for (const heading of headings) {
    const idx = body.indexOf(heading);
    if (idx === -1) continue;
    const rest = body.slice(idx + heading.length);
    const next = rest.search(/\n##\s/);
    return (next === -1 ? rest : rest.slice(0, next)).trim();
  }
  return '_no Trigger section_';
}

async function readRunbook(name) {
  const filePath = path.join(OPERATE_DIR, name);
  const raw = await fs.readFile(filePath, 'utf8');
  const { frontmatter, body } = parseFrontmatter(raw);
  const trigger = extractTriggerSection(body).slice(0, 240);
  const lastChanged = lastChangedFor(path.relative(REPO_ROOT, filePath));
  return {
    file: name,
    owner: (frontmatter && frontmatter.owner) || 'platform-eng',
    reviewed: (frontmatter && frontmatter.reviewed) || 'unknown',
    trigger,
    lastChanged: lastChanged.raw,
  };
}

async function listWorkerJobs() {
  let entries = [];
  try {
    entries = await fs.readdir(HANDLERS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.ts'))
    .map((e) => e.name.replace(/\.ts$/, ''))
    .sort();
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

function buildHandlerCatalogue(workerJobs, operateCorpus) {
  return workerJobs.map((job) => {
    const lc = job.toLowerCase();
    const handlerFile = `backend/workers/handlers/${job}.ts`;
    const lastChanged = lastChangedFor(handlerFile);
    const coveredInOperate = operateCorpus.includes(lc);
    return {
      job,
      handlerFile,
      coveredInOperate,
      lastChanged: lastChanged.raw,
    };
  });
}

function renderHandlerCatalogue(catalogue) {
  const header = '| Worker job | Handler | Operate runbook reference | Content revision |';
  const sep = '|------------|---------|---------------------------|--------------|';
  const rows = catalogue.map((h) => {
    const ref = h.coveredInOperate ? 'mentioned in `docs/operate/*`' : '_no operate doc names this job — generated catalogue is canonical_';
    return `| \`${h.job}\` | \`${h.handlerFile}\` | ${ref} | ${h.lastChanged} |`;
  });
  return [header, sep, ...rows].join('\n');
}

function renderRunbookTable(runbooks) {
  const header = '| Runbook | Owner | Reviewed | Trigger summary | Content revision |';
  const sep = '|---------|-------|----------|------------------|--------------|';
  const rows = runbooks.map(
    (r) =>
      `| \`${r.file}\` | ${r.owner} | ${r.reviewed} | ${r.trigger.replace(/\n+/g, ' ').slice(0, 120)}${
        r.trigger.length > 120 ? '…' : ''
      } | ${r.lastChanged} |`,
  );
  return [header, sep, ...rows].join('\n');
}

export async function buildRunbooksCoverageDoc() {
  const runbookFiles = await listRunbooks();
  const runbooks = await Promise.all(runbookFiles.map(readRunbook));
  const workerJobs = await listWorkerJobs();
  const operateCorpus = await readOperateCorpus();
  const catalogue = buildHandlerCatalogue(workerJobs, operateCorpus);

  const frontmatter = serializeFrontmatter({
    title: 'Runbook Coverage Inventory',
    audience: 'agent',
    status: 'living',
    owner: 'platform-eng',
    reviewed: new Date().toISOString().slice(0, 10),
    binding: false,
    generated_by: 'tools/docs/generate-runbooks-coverage.mjs',
  });

  const body = `<!--
  GENERATED FILE — DO NOT EDIT BY HAND.
  Run \`npm run docs:generate -- --only=runbooks-coverage\` to regenerate.
  CI: \`npm run docs:generate -- --check\` fails on drift.
-->

# Runbook Coverage Inventory

Every runbook under \`docs/operate/\` and the canonical worker handler catalogue from \`backend/workers/handlers/\`. \`guard:docs-runbook-coverage\` accepts presence in either operate runbooks OR the catalogue below — this generated file is structurally the source.

## Runbooks (${runbooks.length})

${renderRunbookTable(runbooks)}

## Worker handler catalogue (${catalogue.length})

Generated from disk. Every handler file under \`backend/workers/handlers/*.ts\` appears here automatically. The "Operate runbook reference" column shows whether any operate runbook names the job by string match.

${renderHandlerCatalogue(catalogue)}
`;

  return frontmatter + body;
}

export const generator = {
  name: 'runbooks-coverage',
  target: 'docs/reference/runbooks-coverage.md',
  build: buildRunbooksCoverageDoc,
};

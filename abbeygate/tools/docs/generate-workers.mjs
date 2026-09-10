// tools/docs/generate-workers.mjs
//
// Generator: docs/reference/workers.md
// Walks backend/workers/handlers/* and extracts the canonical handler
// inventory from registerHandler() calls. Queue is resolved
// from the eventType prefix rules in
// backend/platform/events/queue.ts::routeEventToQueue.
//
// Triggered by `npm run docs:generate -- --only=workers`.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lastChangedFor } from './lib/git.mjs';
import { serializeFrontmatter } from './lib/frontmatter.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const HANDLERS_DIR = path.join(REPO_ROOT, 'backend', 'workers', 'handlers');

// Mirrors the prefix rules in backend/platform/events/queue.ts::routeEventToQueue.
// Update both sites together when adding a new queue or eventType prefix.
const QUEUE_RULES = [
  { queue: 'notifications', exact: ['COMM.OUTBOUND_QUEUED'] },
  { queue: 'notifications', prefixes: ['EMAIL.', 'RENEWAL.', 'SLACK.'] },
  { queue: 'documents', prefixes: ['DOC.', 'PDF.', 'XLSX.'] },
];
const DEFAULT_QUEUE = 'data-sync';

function detectQueueForJob(jobName) {
  for (const rule of QUEUE_RULES) {
    if (rule.exact?.includes(jobName)) return rule.queue;
    if (rule.prefixes?.some((p) => jobName.startsWith(p))) return rule.queue;
  }
  return DEFAULT_QUEUE;
}

export async function buildWorkersInventory() {
  let entries = [];
  try {
    entries = await fs.readdir(HANDLERS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  const handlers = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.ts')) continue;
    const filePath = path.join(HANDLERS_DIR, entry.name);
    const source = await fs.readFile(filePath, 'utf8');
    const registeredNames = [...source.matchAll(/registerHandler\(\s*['"]([A-Z][A-Z0-9._]*?)['"]/g)]
      .map((match) => match[1]);
    const jobNames = registeredNames.length ? registeredNames : [entry.name.replace(/\.ts$/, '')];
    const lastChanged = lastChangedFor(path.relative(REPO_ROOT, filePath));
    for (const jobName of jobNames) {
      handlers.push({
        handler: entry.name,
        handlerId: entry.name.replace(/\.ts$/, ''),
        jobName,
        queue: detectQueueForJob(jobName),
        lastChanged: lastChanged.raw,
      });
    }
  }
  handlers.sort((a, b) => a.jobName.localeCompare(b.jobName));
  return handlers;
}

function renderTable(handlers) {
  const header = '| Handler | Handler id | Job name | Queue | Last changed |';
  const sep = '|---------|------------|----------|-------|--------------|';
  const rows = handlers.map(
    (h) => `| \`${h.handler}\` | \`${h.handlerId}\` | \`${h.jobName}\` | \`${h.queue}\` | ${h.lastChanged} |`,
  );
  return [header, sep, ...rows].join('\n');
}

export async function buildWorkersDoc() {
  const handlers = await buildWorkersInventory();
  const frontmatter = serializeFrontmatter({
    title: 'Worker Handlers Inventory',
    audience: 'agent',
    status: 'living',
    owner: 'platform-eng',
    reviewed: new Date().toISOString().slice(0, 10),
    binding: false,
    generated_by: 'tools/docs/generate-workers.mjs',
  });

  const body = `<!--
  GENERATED FILE — DO NOT EDIT BY HAND.
  Run \`npm run docs:generate -- --only=workers\` to regenerate.
  CI: \`npm run docs:generate -- --check\` fails on drift.
-->

# Worker Handlers Inventory

Canonical list of every BullMQ worker handler under \`backend/workers/handlers/\`. Concurrency is governed by \`WORKER_CONCURRENCY\` (env) or per-handler overrides in \`registerQueues.ts\`. Retry/backoff is set at queue registration time.

## Schema

| Column | Source |
|--------|--------|
| Handler | File name under \`backend/workers/handlers/\` |
| Handler id | Filename without \`.ts\` |
| Job name | \`registerHandler('<JOB>', ...)\` key inside the handler file |
| Queue | Queue name resolved from the eventType prefix rules in \`backend/platform/events/queue.ts\` (\`routeEventToQueue\`) |
| Last changed | Most recent \`git log\` commit touching the handler |

## Inventory (${handlers.length} handlers)

${renderTable(handlers)}
`;

  return frontmatter + body;
}

export const generator = {
  name: 'workers',
  target: 'docs/reference/workers.md',
  build: buildWorkersDoc,
};

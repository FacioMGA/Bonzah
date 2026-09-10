// tools/docs/generate-npm-scripts.mjs
//
// Generator: docs/reference/npm-scripts.md
// Reads package.json scripts and groups them by namespace prefix
// (dev:, build:, db:, prisma:, test:, lint:, guard:, smoke:, gate:,
// docs:, etc). Eliminates the temptation to maintain command lists in
// runbooks / develop docs by hand.
//
// Triggered by `npm run docs:generate -- --only=npm-scripts`.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serializeFrontmatter } from './lib/frontmatter.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PACKAGE_JSON = path.join(REPO_ROOT, 'package.json');

function namespaceFor(name) {
  const idx = name.indexOf(':');
  return idx === -1 ? name : name.slice(0, idx);
}

function escapeCommand(value) {
  return String(value).replace(/\|/g, '\\|');
}

function renderGroup(ns, entries) {
  const header = `### ${ns} (${entries.length})`;
  const tableHeader = '| Script | Command |';
  const sep = '|--------|---------|';
  const rows = entries
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) => `| \`${e.name}\` | \`${escapeCommand(e.value)}\` |`);
  return [header, '', tableHeader, sep, ...rows].join('\n');
}

export async function buildNpmScriptsDoc() {
  const pkg = JSON.parse(await fs.readFile(PACKAGE_JSON, 'utf8'));
  const scripts = pkg.scripts || {};
  const groups = new Map();
  for (const [name, value] of Object.entries(scripts)) {
    const ns = namespaceFor(name);
    if (!groups.has(ns)) groups.set(ns, []);
    groups.get(ns).push({ name, value });
  }
  const orderedNamespaces = [...groups.keys()].sort((a, b) => a.localeCompare(b));

  const frontmatter = serializeFrontmatter({
    title: 'npm Scripts Catalogue',
    audience: 'agent',
    status: 'living',
    owner: 'platform-eng',
    reviewed: new Date().toISOString().slice(0, 10),
    binding: false,
    generated_by: 'tools/docs/generate-npm-scripts.mjs',
  });

  const totalCount = Object.keys(scripts).length;
  const body = `<!--
  GENERATED FILE — DO NOT EDIT BY HAND.
  Run \`npm run docs:generate -- --only=npm-scripts\` to regenerate.
  CI: \`npm run docs:generate -- --check\` fails on drift.
-->

# npm Scripts Catalogue

Every script in \`package.json\` (${totalCount} total), grouped by namespace prefix. This is the single source for command-line invocations — runbooks and develop docs MUST link here rather than reproducing tables.

${orderedNamespaces.map((ns) => renderGroup(ns, groups.get(ns))).join('\n\n')}
`;

  return frontmatter + body;
}

export const generator = {
  name: 'npm-scripts',
  target: 'docs/reference/npm-scripts.md',
  build: buildNpmScriptsDoc,
};

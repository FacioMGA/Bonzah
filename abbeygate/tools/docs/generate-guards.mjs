// tools/docs/generate-guards.mjs
//
// Generator: docs/reference/guards.md
// Reads package.json scripts and pairs every `guard:*` (and the related
// `lint:*`, `policy:*`, `verify:*`, `proof:*` checks) with the underlying
// script file in tools/quality/. Also extracts the first comment block
// from the script for a one-line "enforces" summary.
//
// Triggered by `npm run docs:generate -- --only=guards`.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lastChangedFor } from './lib/git.mjs';
import { serializeFrontmatter } from './lib/frontmatter.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PACKAGE_JSON = path.join(REPO_ROOT, 'package.json');

const SCRIPT_PREFIXES = ['guard:', 'lint:', 'policy:', 'verify:', 'proof:'];
const FILE_TOKEN = /tools\/quality\/[\w./-]+/;

function isInterestingScript(name) {
  return SCRIPT_PREFIXES.some((p) => name.startsWith(p));
}

function findToolPath(scriptValue) {
  const match = scriptValue.match(FILE_TOKEN);
  return match ? match[0] : null;
}

async function readEnforces(absolutePath) {
  try {
    const content = await fs.readFile(absolutePath, 'utf8');
    const lines = content.split(/\r?\n/).slice(0, 30);
    const docLines = [];
    for (const raw of lines) {
      const line = raw.trimStart();
      if (line.startsWith('//')) {
        docLines.push(line.replace(/^\/\/\s?/, '').trim());
      } else if (line.startsWith('#!')) {
        continue;
      } else if (docLines.length > 0) {
        break;
      }
    }
    const summary = docLines.find(
      (l) => l && !l.toLowerCase().startsWith('tools/quality/'),
    );
    return summary || '_no summary in script header_';
  } catch {
    return '_script not found_';
  }
}

function severityFor(scriptName, scriptValue) {
  // Heuristic: scripts wired into build:api / build:frontend or aks/release-blocking-* are error-level.
  // Everything else starts at warn. CI escalates explicitly via the reusable workflow.
  if (/release-blocking|guard|architecture-locks|single-source|purity/.test(scriptName)) {
    return 'error';
  }
  if (/strict|:strict/.test(scriptValue)) return 'error';
  return 'warn';
}

export async function buildGuardsInventory() {
  const pkg = JSON.parse(await fs.readFile(PACKAGE_JSON, 'utf8'));
  const scripts = pkg.scripts || {};
  const rows = [];
  for (const [name, value] of Object.entries(scripts)) {
    if (!isInterestingScript(name)) continue;
    const toolPath = findToolPath(value);
    if (!toolPath) continue;
    const absolute = path.join(REPO_ROOT, toolPath);
    const enforces = await readEnforces(absolute);
    const lastChanged = lastChangedFor(toolPath);
    rows.push({
      name,
      script: toolPath,
      enforces,
      severity: severityFor(name, value),
      lastChanged: lastChanged.raw,
    });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}

function renderTable(rows) {
  const header = '| Guard | Script | Severity | Enforces | Last changed |';
  const sep = '|-------|--------|----------|----------|--------------|';
  const lines = rows.map(
    (r) =>
      `| \`${r.name}\` | \`${r.script}\` | \`${r.severity}\` | ${r.enforces} | ${r.lastChanged} |`,
  );
  return [header, sep, ...lines].join('\n');
}

export async function buildGuardsDoc() {
  const rows = await buildGuardsInventory();
  const frontmatter = serializeFrontmatter({
    title: 'CI Guards Inventory',
    audience: 'agent',
    status: 'living',
    owner: 'platform-eng',
    reviewed: new Date().toISOString().slice(0, 10),
    binding: false,
    generated_by: 'tools/docs/generate-guards.mjs',
  });

  const body = `<!--
  GENERATED FILE — DO NOT EDIT BY HAND.
  Run \`npm run docs:generate -- --only=guards\` to regenerate.
  CI: \`npm run docs:generate -- --check\` fails on drift.
-->

# CI Guards Inventory

Every guard / lint / policy / verify / proof script wired through \`package.json\`. Severity is read from script wiring (release-blocking and strict variants are \`error\`; the rest start at \`warn\` and graduate via the reusable quality-gate workflow).

## Schema

| Column | Source |
|--------|--------|
| Guard | npm script name |
| Script | Path under \`tools/quality/\` |
| Severity | \`error\` (blocks merge) or \`warn\` (logged, does not block) |
| Enforces | First comment block in the script |
| Last changed | Most recent \`git log\` commit touching the script |

## Inventory (${rows.length} guards)

${renderTable(rows)}
`;

  return frontmatter + body;
}

export const generator = {
  name: 'guards',
  target: 'docs/reference/guards.md',
  build: buildGuardsDoc,
};

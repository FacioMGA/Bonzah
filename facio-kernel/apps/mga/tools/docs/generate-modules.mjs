// tools/docs/generate-modules.mjs
//
// Generator: docs/reference/modules.md
// Reads every module under backend/modules/<name>/ and produces a
// canonical inventory: name, present layers, public surface (re-exports
// from index.ts), owner, and last-changed (git).
//
// Triggered by `npm run docs:generate -- --only=modules`.
// Validated by `npm run docs:generate -- --check` in CI.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lastChangedFor } from './lib/git.mjs';
import { serializeFrontmatter } from './lib/frontmatter.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MODULES_ROOT = path.join(REPO_ROOT, 'backend', 'modules');

const LAYER_DIRS = ['domain', 'app', 'http', 'infra'];

async function readOwner(moduleDir) {
  for (const candidate of ['OWNERS', 'OWNERS.md']) {
    try {
      const content = await fs.readFile(path.join(moduleDir, candidate), 'utf8');
      return content.split(/\r?\n/).find((line) => line.trim()) || 'platform-eng';
    } catch {
      // not present, try next candidate
    }
  }
  return 'platform-eng';
}

async function detectLayers(moduleDir) {
  const present = [];
  for (const layer of LAYER_DIRS) {
    try {
      const stat = await fs.stat(path.join(moduleDir, layer));
      if (stat.isDirectory()) present.push(layer);
    } catch {
      // not present
    }
  }
  return present;
}

async function readPublicSurface(moduleDir) {
  try {
    const content = await fs.readFile(path.join(moduleDir, 'index.ts'), 'utf8');
    const exports = new Set();
    const reExport = /export\s+\*\s+from\s+['"]([^'"]+)['"]/g;
    const namedExport = /export\s+\{\s*([^}]+)\s*\}/g;
    let match;
    while ((match = reExport.exec(content))) {
      exports.add(`* from '${match[1]}'`);
    }
    while ((match = namedExport.exec(content))) {
      const names = match[1]
        .split(',')
        .map((s) => s.trim().split(/\s+as\s+/i)[0].trim())
        .filter(Boolean);
      for (const n of names) exports.add(n);
    }
    return [...exports].sort();
  } catch {
    return [];
  }
}

export async function buildModulesInventory() {
  const entries = await fs.readdir(MODULES_ROOT, { withFileTypes: true });
  const modules = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const moduleDir = path.join(MODULES_ROOT, entry.name);
    const [layers, surface, owner] = await Promise.all([
      detectLayers(moduleDir),
      readPublicSurface(moduleDir),
      readOwner(moduleDir),
    ]);
    const lastChanged = lastChangedFor(path.relative(REPO_ROOT, moduleDir));
    modules.push({
      name: entry.name,
      layers,
      surface,
      owner,
      lastChanged: lastChanged.raw,
    });
  }
  modules.sort((a, b) => a.name.localeCompare(b.name));
  return modules;
}

function renderTable(modules) {
  const header = '| Module | Layers | Public surface | Owner | Content revision |';
  const sep = '|--------|--------|----------------|-------|--------------|';
  const rows = modules.map((m) => {
    const layers = m.layers.length ? m.layers.join(', ') : '_none_';
    const surface = m.surface.length
      ? m.surface.map((s) => '`' + s + '`').join(', ')
      : '_no public exports_';
    return `| \`${m.name}\` | ${layers} | ${surface} | ${m.owner} | ${m.lastChanged} |`;
  });
  return [header, sep, ...rows].join('\n');
}

export async function buildModulesDoc() {
  const modules = await buildModulesInventory();
  const frontmatter = serializeFrontmatter({
    title: 'Backend Modules Inventory',
    audience: 'agent',
    status: 'living',
    owner: 'platform-eng',
    reviewed: new Date().toISOString().slice(0, 10),
    binding: false,
    generated_by: 'tools/docs/generate-modules.mjs',
  });

  const body = `<!--
  GENERATED FILE — DO NOT EDIT BY HAND.
  Run \`npm run docs:generate -- --only=modules\` to regenerate.
  CI: \`npm run docs:generate -- --check\` fails on drift.
-->

# Backend Modules Inventory

This file is the canonical inventory of every domain module under \`backend/modules/\`. It is overwritten by the modules generator on every run.

## Schema

| Column | Source |
|--------|--------|
| Module | Directory name under \`backend/modules/\` |
| Layers present | Subset of \`domain\`, \`app\`, \`http\`, \`infra\` detected from subdirectories |
| Public surface | Symbols re-exported from \`<module>/index.ts\` |
| Owner | From module-level \`OWNERS\` file or fallback to \`platform-eng\` |
| Content revision | Stable hash of the module content tree |

## Inventory (${modules.length} modules)

${renderTable(modules)}
`;

  return frontmatter + body;
}

export const generator = {
  name: 'modules',
  target: 'docs/reference/modules.md',
  build: buildModulesDoc,
};

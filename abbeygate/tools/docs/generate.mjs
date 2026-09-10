#!/usr/bin/env node
// tools/docs/generate.mjs
//
// Orchestrator for the docs generators (modules, workers, guards,
// contracts, runbooks-coverage, npm-scripts). Two modes:
//
//   npm run docs:generate            -> rewrite all generated files
//   npm run docs:generate -- --check -> exit non-zero on any drift (CI)
//
// `--only=name1,name2` runs a subset (used by the per-area scripts).
//
// Each generator module exports a `generator` object with:
//   { name: string, target: string (repo-relative path), build: () => Promise<string> }

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generator as modulesGen } from './generate-modules.mjs';
import { generator as workersGen } from './generate-workers.mjs';
import { generator as guardsGen } from './generate-guards.mjs';
import { generator as contractsGen } from './generate-contracts.mjs';
import { generator as runbooksGen } from './generate-runbooks-coverage.mjs';
import { generator as npmScriptsGen } from './generate-npm-scripts.mjs';
import { normalizeForCompare } from './lib/frontmatter.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const ALL = [modulesGen, workersGen, guardsGen, contractsGen, runbooksGen, npmScriptsGen];

function parseArgs(argv) {
  const args = { check: false, only: null };
  for (const arg of argv) {
    if (arg === '--check') args.check = true;
    else if (arg.startsWith('--only=')) {
      args.only = arg.slice('--only='.length).split(',').filter(Boolean);
    }
  }
  return args;
}

async function readIfExists(absolutePath) {
  try {
    return await fs.readFile(absolutePath, 'utf8');
  } catch {
    return null;
  }
}

async function main() {
  const { check, only } = parseArgs(process.argv.slice(2));
  const generators = only
    ? ALL.filter((g) => only.includes(g.name))
    : ALL;

  if (only && generators.length !== only.length) {
    const found = new Set(generators.map((g) => g.name));
    const missing = only.filter((n) => !found.has(n));
    console.error(`docs:generate: unknown generator(s): ${missing.join(', ')}`);
    console.error(`Available: ${ALL.map((g) => g.name).join(', ')}`);
    process.exit(2);
  }

  let driftCount = 0;
  for (const gen of generators) {
    const targetAbs = path.join(REPO_ROOT, gen.target);
    const generated = await gen.build();
    if (check) {
      const current = await readIfExists(targetAbs);
      const a = current ? normalizeForCompare(current) : '';
      const b = normalizeForCompare(generated);
      if (a !== b) {
        driftCount += 1;
        console.error(`drift: ${gen.target} differs from generator output`);
      } else {
        console.log(`ok: ${gen.target}`);
      }
    } else {
      await fs.mkdir(path.dirname(targetAbs), { recursive: true });
      await fs.writeFile(targetAbs, generated, 'utf8');
      console.log(`wrote: ${gen.target}`);
    }
  }

  if (check && driftCount > 0) {
    console.error(`\ndocs:generate: ${driftCount} file(s) drifted. Run \`npm run docs:generate\` and commit the result.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

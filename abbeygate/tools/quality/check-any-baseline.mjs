#!/usr/bin/env node
// tools/quality/check-any-baseline.mjs
//
// Regex-scoped explicit-any ratchet (Layer 5). Counts every literal
// `any`/`as unknown as`/`Record<string, any>`/`<any>`/colon-any occurrence
// (see ANY_PATTERNS in lib/any-patterns.mjs) per scope and gates the total
// against a per-scope ceiling. Lower-only: a PR may reduce the count and
// drop the ceiling in the same commit, but never raise either.
//
// Two scopes are gated:
//   - backend  (LLM-bypass debt accumulated in workers/services/handlers)
//   - frontend (LLM-bypass debt accumulated in views/wizards/clients)
//
// The frontend resolved-any baseline (any-resolved-baseline.json) is
// dominated by React stdlib propagation noise (`React.ReactNode`
// transitively reaches `Iterable<…, any, any>`), so its compiler-counted
// floor cannot fall much below ~45. That floor would mask any genuine
// new LLM bypass landing in the frontend, which is exactly why this
// regex-counted ratchet is added: the patterns it scans for (literal
// `any`, the laundered cast through `unknown`, the polite-any record
// shape, etc.) are the moves LLMs reach for when their first attempt is
// blocked, and they are independent of the React stdlib floor.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { countAnyPatternMatches, SCANNABLE_EXTENSIONS } from './lib/any-patterns.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BASELINE_FILE = path.join(REPO_ROOT, 'tools', 'quality', 'any-baseline.json');

const SCOPES = [
  { name: 'backend', dir: path.join(REPO_ROOT, 'backend') },
  { name: 'frontend', dir: path.join(REPO_ROOT, 'frontend') },
];

const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.vite',
  'coverage',
]);

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
      continue;
    }
    if (SCANNABLE_EXTENSIONS.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

function readBaseline() {
  if (!fs.existsSync(BASELINE_FILE)) {
    return { backend: { maxExplicitAny: 0 }, frontend: { maxExplicitAny: 0 } };
  }
  const raw = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
  // Back-compat: an older single-scope baseline used the flat
  // `maxExplicitAny` key for backend only. Map it onto the new
  // `backend.maxExplicitAny` slot so the ratchet keeps working through
  // the migration commit.
  const backendMax = Number(
    raw.backend?.maxExplicitAny ?? raw.maxExplicitAny ?? 0,
  );
  const frontendMax = Number(raw.frontend?.maxExplicitAny ?? 0);
  return {
    backend: { maxExplicitAny: backendMax },
    frontend: { maxExplicitAny: frontendMax },
  };
}

function countScope(scope) {
  let total = 0;
  for (const file of walk(scope.dir)) {
    const text = fs.readFileSync(file, 'utf8');
    total += countAnyPatternMatches(text);
  }
  return total;
}

function main() {
  const baseline = readBaseline();
  const failures = [];
  const successes = [];
  for (const scope of SCOPES) {
    const observed = countScope(scope);
    const ceiling = baseline[scope.name].maxExplicitAny;
    if (observed > ceiling) {
      failures.push({ scope: scope.name, observed, ceiling });
    } else {
      successes.push({ scope: scope.name, observed, ceiling });
    }
  }

  if (failures.length > 0) {
    console.error('Any-pattern ratchet failed:');
    for (const f of failures) {
      console.error(`  ${f.scope}: ${f.observed} > ${f.ceiling}`);
    }
    console.error(
      '\nLower the offending count (preferred) or, if the increase is unavoidable',
      '\nand has a tracked deletion plan, raise the ceiling in any-baseline.json',
      '\nin a separate documented PR. This counts the narrow ANY_PATTERNS set',
      '\n(literal `any` casts and the closest laundering shapes); the diff-only',
      '\ntripwire is `check-no-new-any.mjs`, the compiler-walk truth is',
      '\n`check-any-resolved.mjs`.',
    );
    process.exit(1);
  }

  console.log('Any-pattern ratchet passed:');
  for (const s of successes) {
    console.log(`  ${s.scope}: ${s.observed} <= ${s.ceiling}`);
  }
}

main();

#!/usr/bin/env node
/**
 * Questionnaire Path Consolidation — STOP-THE-WORLD FREEZE GUARD.
 *
 * While the consolidation runs, this guard fails any PR that:
 *
 *   1. Adds a NEW file matching a questionnaire-contract path pattern
 *      outside the documented canonical locations.
 *   2. Adds NEW occurrences (diff `+` lines minus diff `-` lines) of
 *      banned transitional-offender symbols inside `validation/profile.ts`.
 *   3. Adds a NEW generated `*Validation*Contract*.generated.*` file
 *      (those must come from the canonical generator, period).
 *
 * Allowlist semantics:
 *   The allowlist file `tools/quality/questionnaire-freeze.allow.json` is a
 *   DELETION QUEUE, not permission. Each entry is an existing offender
 *   carrying a deletion phase, owner, and Linear ticket. Entries shrink
 *   (never grow) as phases land. The allowlist is empty by Phase 7 close.
 *
 *   - `allowedExistingPaths`     — existing file paths whose presence is
 *     grandfathered until the named deletion phase. Modifying them does
 *     NOT trigger the guard for that file.
 *   - `allowedSymbolFiles`       — existing files allowed to retain banned
 *     symbols. The guard tolerates `canonicalShape` etc. inside these,
 *     but still fails if the diff introduces a NET-NEW `+` line.
 *
 * Removal:
 *   This guard is removed from CI in Phase 7 once the structural guards
 *   (single-source, no-legacy-shims, no-duplicate-generated, no-parallel-
 *   engines) take over the equivalent enforcement permanently.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readChangedNameStatus, readUnifiedDiff } from './lib/ci-diff-range.mjs';

const ROOT = process.cwd();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ALLOWLIST_PATH = path.join(__dirname, 'questionnaire-freeze.allow.json');

function loadAllowlist() {
  if (!fs.existsSync(ALLOWLIST_PATH)) {
    return { allowedExistingPaths: [], allowedSymbolFiles: [] };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(ALLOWLIST_PATH, 'utf8'));
    return {
      allowedExistingPaths: Array.isArray(raw.allowedExistingPaths)
        ? raw.allowedExistingPaths.map((entry) => entry.path).filter(Boolean)
        : [],
      allowedSymbolFiles: Array.isArray(raw.allowedSymbolFiles)
        ? raw.allowedSymbolFiles.map((entry) => entry.path).filter(Boolean)
        : [],
    };
  } catch (err) {
    console.error('[questionnaire-freeze] FAILED to parse allowlist JSON:', err.message);
    process.exit(1);
  }
}

const { allowedExistingPaths, allowedSymbolFiles } = loadAllowlist();
const allowedExistingSet = new Set(allowedExistingPaths);
const allowedSymbolSet = new Set(allowedSymbolFiles);

// ---------- new-file path patterns ----------

const PRODUCT_PATH_PREFIXES = [
  /^frontend\/src\/products\/[^/]+\//,
  /^backend\/products\/[^/]+\//,
  /^packages\/validation\/src\/products\/[^/]+\//,
];

function inCanonicalProductPath(filePath) {
  return PRODUCT_PATH_PREFIXES.some((re) => re.test(filePath));
}

const NEW_FILE_RULES = [
  {
    name: 'manifest.ts outside canonical product path',
    test: (p) => /(^|\/)manifest\.ts$/.test(p) && !inCanonicalProductPath(p),
    why: 'Add product manifests only under {frontend/src,backend,packages/validation/src}/products/<code>/manifest.ts',
  },
  {
    name: 'validation/profile.ts outside canonical product path',
    test: (p) => /(^|\/)validation\/profile\.ts$/.test(p) && !inCanonicalProductPath(p),
    why: 'Add validation profiles only under {frontend/src,backend,packages/validation/src}/products/<code>/validation/profile.ts',
  },
  {
    name: 'gen1 questionnaire.contract.ts (deleted in Phase 1)',
    test: (p) => /(^|\/)questionnaire\.contract\.ts$/.test(p),
    why: 'Gen1 contract concept is dead. Add field metadata to ValidationProfile.fields instead.',
  },
  {
    name: '*QuestionnaireContract.ts alias (deleted in Phase 1)',
    test: (p) => /[A-Za-z]+QuestionnaireContract\.ts$/.test(p),
    why: 'Gen1 contract aliases are deleted. Read from ValidationProfile via the runner.',
  },
  {
    name: '*QuestionContract.ts alias (deleted in Phase 1)',
    test: (p) => /[A-Za-z]+QuestionContract\.ts$/.test(p),
    why: 'Gen1 contract aliases are deleted. Read from ValidationProfile via the runner.',
  },
  {
    name: '*Validation*Contract*.generated.* (single canonical generator only)',
    test: (p) =>
      /[A-Za-z]+Validation[A-Za-z]+Contract[A-Za-z]*\.generated\.[a-zA-Z]+$/.test(p) &&
      !/^packages\/validation\/src\/products\/[^/]+\/generated\//.test(p),
    why: 'Generated validation contracts may only live under packages/validation/src/products/<code>/generated/',
  },
];

// ---------- banned symbol introductions ----------

const BANNED_SYMBOLS = [
  { symbol: 'canonicalShape', where: 'anywhere' },
  { symbol: 'canonicalPolicyholderFallback', where: 'anywhere' },
  { symbol: 'liftToCanonical', where: 'anywhere' },
  { symbol: 'legacyQuoteData', where: 'anywhere' },
  { symbol: 'legacyQuotePayload', where: 'anywhere' },
  // z.preprocess inside validation/profile.ts is a fallback shim by design.
  // Its presence elsewhere (e.g. tests) is fine.
  { symbol: 'z.preprocess(', where: /(^|\/)validation\/profile\.ts$/ },
];

function symbolApplies(rule, filePath) {
  if (rule.where === 'anywhere') return true;
  return rule.where instanceof RegExp ? rule.where.test(filePath) : false;
}

// ---------- diff parsing ----------

function parseDiffByFile(diff) {
  const byFile = new Map();
  let currentFile = null;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
      currentFile = m ? m[2] : null;
      if (currentFile && !byFile.has(currentFile)) byFile.set(currentFile, { plus: [], minus: [] });
      continue;
    }
    if (!currentFile) continue;
    if (line.startsWith('+++ ') || line.startsWith('--- ')) continue;
    if (line.startsWith('@@')) continue;
    const bucket = byFile.get(currentFile);
    if (!bucket) continue;
    if (line.startsWith('+')) bucket.plus.push(line.slice(1));
    else if (line.startsWith('-')) bucket.minus.push(line.slice(1));
  }
  return byFile;
}

function countOccurrences(lines, token) {
  let count = 0;
  for (const line of lines) {
    let idx = 0;
    while ((idx = line.indexOf(token, idx)) !== -1) {
      count += 1;
      idx += token.length;
    }
  }
  return count;
}

// ---------- run guard ----------

const violations = [];
const changed = readChangedNameStatus();
const added = changed.filter((entry) => entry.status === 'A');
const modifiedOrAdded = changed.filter((entry) => /^[AMR]/.test(entry.status));

for (const { file } of added) {
  if (allowedExistingSet.has(file)) continue;
  for (const rule of NEW_FILE_RULES) {
    if (rule.test(file)) {
      violations.push({
        kind: 'new-file',
        file,
        rule: rule.name,
        why: rule.why,
      });
    }
  }
}

// Documentation files (*.md, *.mdx) are explicitly NOT subject to symbol-
// introduction checks. Markdown does not execute; it describes. The
// consolidation baseline and audit reports under `docs/architecture/` are
// the right place to record what was deleted and why so future readers
// understand the history. Banning these tokens in prose would break the
// very documentation that explains why they were banned. The structural
// guards (no-legacy-shims, no-parallel-engines, etc.) enforce the
// no-resurrection invariant on source code; this guard does the same on
// non-doc files.
const SYMBOL_GUARD_IGNORED_EXTENSIONS = /\.(md|mdx)$/i;

const diffByFile = parseDiffByFile(readUnifiedDiff());
for (const { file } of modifiedOrAdded) {
  if (SYMBOL_GUARD_IGNORED_EXTENSIONS.test(file)) continue;
  const buckets = diffByFile.get(file);
  if (!buckets) continue;
  for (const rule of BANNED_SYMBOLS) {
    if (!symbolApplies(rule, file)) continue;
    const plus = countOccurrences(buckets.plus, rule.symbol);
    const minus = countOccurrences(buckets.minus, rule.symbol);
    if (plus > minus) {
      if (allowedSymbolSet.has(file)) continue;
      violations.push({
        kind: 'symbol-introduction',
        file,
        token: rule.symbol,
        netNew: plus - minus,
        why: `Banned symbol "${rule.symbol}" added (net +${plus - minus}). This belongs to the consolidation deletion queue.`,
      });
    }
  }
}

if (violations.length > 0) {
  console.error('\n[questionnaire-freeze] FAILED — Questionnaire Path Consolidation is in progress.\n');
  console.error('  Until consolidation is complete:');
  console.error('    - no new questionnaire contracts');
  console.error('    - no new validation profiles outside canonical paths');
  console.error('    - no new generated validation artifacts');
  console.error('    - no new canonicalShape / fallback / lift logic');
  console.error('  See docs/architecture/questionnaire-consolidation/baseline.md');
  console.error('  PR approval from the consolidation owner is required for any change');
  console.error('  inside the watched paths.\n');

  for (const v of violations) {
    if (v.kind === 'new-file') {
      console.error(` - new file blocked: ${v.file}`);
      console.error(`     reason: ${v.rule}`);
      console.error(`     fix:    ${v.why}`);
    } else {
      console.error(` - symbol "${v.token}" introduced (+${v.netNew}) in: ${v.file}`);
      console.error(`     fix:    ${v.why}`);
    }
  }
  console.error('');
  process.exit(1);
}

console.log('[questionnaire-freeze] OK');

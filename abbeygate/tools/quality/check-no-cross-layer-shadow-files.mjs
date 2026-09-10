#!/usr/bin/env node
// Guard: within a backend module, no source-file basename may exist with
// substantive content in more than one layer of {domain, app, infra, http}.
// The pattern of "same name in two layers" historically masked drift between
// near-duplicate copies of safety-critical code (see ADR-0011 —
// policyStateService and policyCompliance were shadow-duplicated in app/ and
// domain/, with the domain copies using `await import()` to dodge the
// static-import layer guard).
//
// Conventional barrels (`index.ts`, `types.ts`) are exempted — they exist by
// design at every layer entrypoint.
//
// Pure re-export shims are also exempted: a file that contains only
// `export * from '...'` / `export { ... } from '...'` (plus comments and
// imports) is a legitimate one-liner exposing a primitive from another
// layer. Both files in a pair must contain substantive code for it to count
// as a shadow duplicate.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const MODULES_DIR = path.join(ROOT, 'backend', 'modules');
const BASELINE_FILE = path.join(ROOT, 'tools', 'quality', 'cross-layer-shadow-files-baseline.json');
const LAYERS = ['domain', 'app', 'infra', 'http'];
const EXEMPT_BASENAMES = new Set(['index.ts', 'types.ts']);

// Intentional, documented same-basename pairs that contain substantive code
// in BOTH files. Pure re-export shims are auto-detected and do not need to
// be allowlisted. Adding here requires an ADR reference in `reason`.
const ALLOWED_PAIRS = [];

// Known-issue baseline: the set of shadow pairs that existed when the guard
// was introduced (ADR-0011). Goal is to drive this set to empty. The guard
// fails on any pair that is NOT in the baseline AND on any baseline entry
// that no longer exists in the codebase (the baseline must only ever
// shrink). Missing baseline file = treat baseline as empty.
function loadBaseline() {
  if (!fs.existsSync(BASELINE_FILE)) return new Set();
  const parsed = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
  const entries = Array.isArray(parsed?.baseline) ? parsed.baseline : [];
  return new Set(
    entries.map((e) =>
      `${e.module}|${e.basename}|${[...(e.layers || [])].sort().join(',')}`
    )
  );
}

function toPosix(p) {
  return p.replaceAll('\\', '/');
}

function listLayerFiles(moduleDir, layer) {
  const layerDir = path.join(moduleDir, layer);
  if (!fs.existsSync(layerDir) || !fs.statSync(layerDir).isDirectory()) return [];
  const out = [];
  for (const entry of fs.readdirSync(layerDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.ts')) continue;
    if (entry.name.endsWith('.test.ts')) continue;
    out.push(entry.name);
  }
  return out;
}

// A "pure re-export shim" contains only re-export statements (and optionally
// imports/comments/blank lines). Strips comments + import/export-from blocks
// (single- and multi-line) and asserts nothing substantive remains.
function isReExportShim(absolutePath) {
  let source = fs.readFileSync(absolutePath, 'utf8');

  // Strip block comments.
  source = source.replace(/\/\*[\s\S]*?\*\//g, '');
  // Strip line comments.
  source = source.replace(/(^|[^:])\/\/.*$/gm, '$1');

  // Strip `export * from '...';` and `export type * from '...';` (single line).
  source = source.replace(/export\s+(?:type\s+)?\*\s+from\s+['"][^'"]+['"]\s*;?/g, '');

  // Strip `export { foo, bar as baz } from '...';` and the `type` variant —
  // multiline-aware. The `[^{}]*` is safe here because TS re-export blocks
  // do not contain nested braces.
  source = source.replace(
    /export\s+(?:type\s+)?\{[^{}]*\}\s+from\s+['"][^'"]+['"]\s*;?/g,
    ''
  );

  // Strip `import ... from '...';` (single- or multi-line, including
  // namespace + named + default forms) and side-effect-only imports.
  source = source.replace(/import\s+[^;]*?from\s+['"][^'"]+['"]\s*;?/g, '');
  source = source.replace(/import\s+['"][^'"]+['"]\s*;?/g, '');

  // Anything substantive left?
  return source.replace(/\s+/g, '').length === 0;
}

const allowedKey = ({ module, basename, layers }) =>
  `${module}|${basename}|${[...layers].sort().join(',')}`;
const allowed = new Set(ALLOWED_PAIRS.map(allowedKey));

function isAllowed(module, basename, foundLayers) {
  return allowed.has(allowedKey({ module, basename, layers: foundLayers }));
}

if (!fs.existsSync(MODULES_DIR)) {
  console.log('shadow-files guard: no backend/modules — skipping');
  process.exit(0);
}

const baseline = loadBaseline();
const baselineSeen = new Set(); // entries we matched to existing files
const newViolations = [];

for (const moduleEntry of fs.readdirSync(MODULES_DIR, { withFileTypes: true })) {
  if (!moduleEntry.isDirectory()) continue;
  const moduleName = moduleEntry.name;
  const moduleDir = path.join(MODULES_DIR, moduleName);

  const seen = new Map();
  for (const layer of LAYERS) {
    for (const file of listLayerFiles(moduleDir, layer)) {
      if (EXEMPT_BASENAMES.has(file)) continue;
      const layers = seen.get(file) ?? [];
      layers.push(layer);
      seen.set(file, layers);
    }
  }

  for (const [basename, foundLayers] of seen) {
    if (foundLayers.length < 2) continue;
    if (isAllowed(moduleName, basename, foundLayers)) continue;
    const absolutePaths = foundLayers.map((layer) => path.join(moduleDir, layer, basename));
    const substantive = absolutePaths.filter((abs) => !isReExportShim(abs));
    if (substantive.length < 2) continue;
    const substantiveLayers = substantive.map((abs) => path.basename(path.dirname(abs)));
    const paths = substantive.map((abs) => toPosix(path.relative(ROOT, abs))).join(', ');
    const key = `${moduleName}|${basename}|${[...substantiveLayers].sort().join(',')}`;
    if (baseline.has(key)) {
      baselineSeen.add(key);
      continue;
    }
    newViolations.push(
      `[${moduleName}] '${basename}' has substantive copies in layers {${substantiveLayers.join(', ')}}: ${paths}`
    );
  }
}

const baselineDrift = [...baseline].filter((k) => !baselineSeen.has(k));

if (newViolations.length > 0 || baselineDrift.length > 0) {
  if (newViolations.length > 0) {
    console.error(
      '\nCROSS-LAYER SHADOW-FILE GUARD FAILED — new same-basename pair(s) introduced:\n'
    );
    for (const v of newViolations) console.error(`- ${v}`);
    console.error(
      '\nFix: keep one canonical implementation. If an app-layer entrypoint is' +
        '\n     needed so http/* can reach a domain primitive, write a one-line' +
        "\n     `export * from '...'` shim (auto-detected and allowed). Substantive" +
        '\n     same-name pairs require an ADR and an entry in ALLOWED_PAIRS in' +
        '\n     this script.'
    );
  }
  if (baselineDrift.length > 0) {
    console.error(
      '\nBASELINE DRIFT — entries in cross-layer-shadow-files-baseline.json no' +
        '\nlonger match the codebase. Remove the resolved entries (the baseline' +
        '\nmust only shrink, never include stale rows):\n'
    );
    for (const v of baselineDrift) console.error(`- ${v}`);
  }
  process.exit(1);
}

const baselineCount = baseline.size;
const tail = baselineCount > 0 ? ` (${baselineCount} known shadow pair(s) in baseline)` : '';
console.log(`shadow-files guard OK${tail}`);

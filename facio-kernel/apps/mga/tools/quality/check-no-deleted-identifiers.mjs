#!/usr/bin/env node
/**
 * Guard: forbid identifiers that have been intentionally deleted from
 * the production codebase as part of the stale-code-removal program.
 *
 * Fed by `tools/quality/deleted-identifiers.json`. Each pattern names an
 * identifier (`id`), a `regex` (string, JavaScript-flavour, no flags), and
 * a list of `allowedPaths` (POSIX prefixes; trailing slash means
 * directory). CI fails when any tracked source file matches the regex
 * outside `allowedPaths`.
 *
 * Companion self-test: `tools/quality/__tests__/check-no-deleted-identifiers.test.mjs`
 * injects a fixture containing each banned identifier, runs this guard,
 * and asserts non-zero exit. That ensures the JSON regex actually catches
 * the thing it claims to catch.
 *
 * To run the guard programmatically (without CLI exit), import
 * `runDeletedIdentifiersCheck` and inspect the returned violations.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const JSON_PATH = path.join(ROOT, 'tools/quality/deleted-identifiers.json');

const SCANNABLE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.mts',
]);

/** Load and validate the JSON pattern list. Throws on malformed input. */
export function loadPatterns(jsonPath = JSON_PATH) {
  const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  if (!Array.isArray(raw.patterns)) {
    throw new Error(`[no-deleted-identifiers] ${jsonPath}: missing "patterns" array.`);
  }
  return raw.patterns.map((entry) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`[no-deleted-identifiers] malformed pattern entry: ${JSON.stringify(entry)}`);
    }
    if (typeof entry.id !== 'string' || entry.id.length === 0) {
      throw new Error(`[no-deleted-identifiers] pattern missing "id": ${JSON.stringify(entry)}`);
    }
    if (typeof entry.regex !== 'string' || entry.regex.length === 0) {
      throw new Error(`[no-deleted-identifiers] pattern "${entry.id}": missing "regex".`);
    }
    const allowed = Array.isArray(entry.allowedPaths) ? entry.allowedPaths : [];
    return {
      id: entry.id,
      regex: new RegExp(entry.regex),
      allowedPaths: allowed,
    };
  });
}

function isAllowed(filePath, allowedPaths) {
  for (const prefix of allowedPaths) {
    if (filePath === prefix) return true;
    if (prefix.endsWith('/') && filePath.startsWith(prefix)) return true;
    if (!prefix.endsWith('/') && filePath.startsWith(`${prefix}/`)) return true;
  }
  return false;
}

// Walk-the-tree fallback for environments where `git` isn't available
// (e.g. inside `npm run build:api` running in the production Docker
// build context, where the base image is `node:22-bookworm-slim` —
// no git binary AND no `.git` directory copied in via the Dockerfile).
// Mirrors the same set git would have reported: every scannable source
// file under the repo root, minus everything under `node_modules`,
// `dist`, `.git`, `tmp`, `temp`, `puppeteer-cache`, build outputs,
// and similar locations the guard never wanted to scan.
const FS_WALK_SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'tmp',
  'temp',
  'coverage',
  '.next',
  '.turbo',
  '.cache',
  'puppeteer-cache',
  'facio-runtime',
  '.cursor',
]);

function walkFilesystem(rootDir) {
  const results = [];
  const stack = [''];
  while (stack.length > 0) {
    const rel = stack.pop();
    const abs = rel ? path.join(rootDir, rel) : rootDir;
    let entries;
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (FS_WALK_SKIP_DIRS.has(entry.name)) continue;
        if (entry.name.startsWith('.')) continue; // skip dotfolders other than allowed ones above
        stack.push(childRel);
        continue;
      }
      if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (!SCANNABLE_EXTENSIONS.has(ext)) continue;
        results.push(childRel.replaceAll('\\', '/'));
      }
    }
  }
  return results;
}

function listTrackedFiles(rootDir = ROOT) {
  // Prefer git's tracked-files set (cheaper + matches the policy contract:
  // "every tracked source file"). When git is unavailable — typically
  // inside the production Docker build where neither the binary nor the
  // .git folder is present — fall back to a deterministic filesystem
  // walk over the same scannable extensions. The fallback is a strict
  // superset (it sees untracked files too), so the guard remains
  // sound: a forbidden identifier in an untracked-but-scannable file
  // would still trip the check.
  let trackedOut;
  let deletedOut;
  try {
    trackedOut = execSync('git ls-files -z', {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    deletedOut = execSync('git ls-files -z --deleted', {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return walkFilesystem(rootDir);
  }
  const deleted = new Set(
    deletedOut
      .toString('utf8')
      .split('\0')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.replaceAll('\\', '/')),
  );
  return trackedOut
    .toString('utf8')
    .split('\0')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replaceAll('\\', '/'))
    .filter((p) => !deleted.has(p));
}

/**
 * Run the check against a list of files (defaults to `git ls-files`).
 * Returns an array of violations: `{ id, file, line, snippet }`.
 */
export function runDeletedIdentifiersCheck({
  patterns = loadPatterns(),
  rootDir = ROOT,
  files = null,
} = {}) {
  const targetFiles = files ?? listTrackedFiles(rootDir);
  const violations = [];

  for (const file of targetFiles) {
    const ext = path.extname(file);
    if (!SCANNABLE_EXTENSIONS.has(ext)) continue;
    const abs = path.isAbsolute(file) ? file : path.join(rootDir, file);
    if (!fs.existsSync(abs)) continue;
    let text;
    try {
      text = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    const lines = text.split('\n');
    for (const pattern of patterns) {
      if (isAllowed(file, pattern.allowedPaths)) continue;
      for (let i = 0; i < lines.length; i++) {
        if (pattern.regex.test(lines[i])) {
          violations.push({
            id: pattern.id,
            file,
            line: i + 1,
            snippet: lines[i].trim().slice(0, 200),
          });
        }
      }
    }
  }

  return violations;
}

function main() {
  const patterns = loadPatterns();
  const violations = runDeletedIdentifiersCheck({ patterns });

  if (violations.length > 0) {
    console.error('\n[no-deleted-identifiers] Forbidden identifier(s) found:\n');
    for (const v of violations) {
      console.error(`  - ${v.file}:${v.line} (${v.id}): ${v.snippet}`);
    }
    console.error(
      '\nThese identifiers were intentionally deleted as part of the\n' +
        'stale-code-removal program. If a re-introduction is genuinely\n' +
        'needed, open an ADR amending the row in\n' +
        '`tools/quality/deleted-identifiers.json` first.\n',
    );
    process.exit(1);
  }

  console.log(`[no-deleted-identifiers] ok (${patterns.length} pattern(s) enforced)`);
}

const invokedDirectly = (() => {
  try {
    const argv1 = process.argv[1] ? path.resolve(process.argv[1]) : '';
    const here = fileURLToPath(import.meta.url);
    return argv1 === here;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main();
}

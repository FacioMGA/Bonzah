#!/usr/bin/env node
import { execSync } from 'node:child_process';
import path from 'node:path';

const ROOT = process.cwd();

function toPosix(p) {
  return p.replaceAll('\\', '/');
}

function listTrackedFiles() {
  const trackedOut = execSync('git ls-files -z', {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const deletedOut = execSync('git ls-files -z --deleted', {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'ignore'],
  });

  const deleted = new Set(
    deletedOut
      .toString('utf8')
      .split('\0')
      .map((x) => x.trim())
      .filter(Boolean)
      .map(toPosix),
  );

  return trackedOut
    .toString('utf8')
    .split('\0')
    .map((x) => x.trim())
    .filter(Boolean)
    .map(toPosix)
    .filter((p) => !deleted.has(p));
}

const trackedFiles = listTrackedFiles();
const rootOnly = trackedFiles.filter((p) => !p.includes('/'));

const bannedPatterns = [
  /^tmp[_-].+/i,
  /^debug[_-].+/i,
  /^test[-_].+\.(mjs|cjs|js|ts|sh)$/i,
  /^fix[_-].+\.(py|mjs|js|ts)$/i,
  /^rewrite[_-].+\.(py|mjs|js|ts)$/i,
  /^replace[_-].+\.(py|mjs|js|ts)$/i,
  /^server_error\.log$/i,
  /^ts_errors\.txt$/i,
  /^frontend_tree\.txt$/i,
  /^current_tree\.txt$/i,
];

const failures = [];
for (const file of rootOnly) {
  for (const re of bannedPatterns) {
    if (re.test(file)) {
      failures.push(file);
      break;
    }
  }
}

const bannedLegacyRoots = ['components/', 'pages/', 'shared/'];
const legacyRootViolations = trackedFiles.filter((file) => bannedLegacyRoots.some((prefix) => file.startsWith(prefix)));

const bannedTrackedPrefixes = ['node_modules/', 'puppeteer-cache/', 'dist/', 'tmp/', 'artifacts/'];
const bannedTrackedViolations = trackedFiles.filter((file) =>
  bannedTrackedPrefixes.some((prefix) => file.startsWith(prefix)),
);

// Canonical docs taxonomy per ADR-0010 (Documentation is enforced).
// Update this set ONLY by amending ADR-0010 and the start-here landing
// pages — every namespace below has a binding owner and cap.
const allowedDocsTopLevel = new Set([
  'start-here', // audience entrypoints (developer / operator / agent / architect)
  'product', // unique product reference (overview, lifecycle, triggers, glossary)
  'architecture', // binding contracts + ADRs (architecture/contracts, architecture/decisions)
  'develop', // engineer guides (write-code, test)
  'operate', // executable runbooks + operate/reference long-form
  'reference', // generated inventories (modules, workers, guards, contracts, ...)
  'archive', // historical evidence; frozen
]);
const docsTopLevelViolations = trackedFiles.filter((file) => {
  if (!file.startsWith('docs/')) return false;
  const rest = file.slice('docs/'.length);
  if (!rest || !rest.includes('/')) return true;
  const topLevel = rest.split('/')[0];
  return !allowedDocsTopLevel.has(topLevel);
});

if (failures.length || legacyRootViolations.length || bannedTrackedViolations.length || docsTopLevelViolations.length) {
  console.error(
    '\n[root-hygiene] Repository hygiene violations detected:\n' +
      [
        ...failures.map((f) => ` - root clutter file: ${f}`),
        ...legacyRootViolations.map((f) => ` - legacy root namespace file: ${f}`),
        ...bannedTrackedViolations.map((f) => ` - generated/bulk path tracked in git: ${f}`),
        ...docsTopLevelViolations.map((f) => ` - non-canonical docs taxonomy path: ${f}`),
      ].join('\n') +
      '\n\nMove files under authoritative namespaces (e.g. frontend/src/surfaces, frontend/src/products, frontend/src/shared).\n',
  );
  process.exit(1);
}

console.log('[root-hygiene] ok');

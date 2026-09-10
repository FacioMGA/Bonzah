#!/usr/bin/env node
import { execSync } from 'node:child_process';

const ROOT = process.cwd();

function trackedFiles() {
  const tracked = execSync('git ls-files -z', {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const deleted = execSync('git ls-files -z --deleted', {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'ignore'],
  });

  const deletedSet = new Set(
    deleted
      .toString('utf8')
      .split('\0')
      .map((x) => x.trim())
      .filter(Boolean),
  );

  return tracked
    .toString('utf8')
    .split('\0')
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((p) => !deletedSet.has(p));
}

const docsFiles = trackedFiles().filter((p) => p.startsWith('docs/'));
const duplicateSuffixRe = /(?:\s+\d+|[-_](copy|old|backup))\.md$/i;

const violations = docsFiles.filter((p) => duplicateSuffixRe.test(p));

if (violations.length > 0) {
  console.error(
    '\n[docs-duplicate-filenames] FAILED:\n' +
      violations.map((v) => ` - ${v}`).join('\n') +
      '\n\nRename/delete duplicate docs and keep a single canonical filename.\n',
  );
  process.exit(1);
}

console.log('[docs-duplicate-filenames] OK');

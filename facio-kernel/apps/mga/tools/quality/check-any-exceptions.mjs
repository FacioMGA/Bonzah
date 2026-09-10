#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = process.cwd();
const TICKET_TAG = /TODO\(FAC-\d+\):(?=.*\bowner=[^\s]+)(?=.*\bexpires=[^\s]+)(?=.*\bdeletionPR=[^\s]+).+/;
const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.vite',
  'coverage',
]);
// Self-exclude the quality tooling's own tests: by construction, those files
// contain literal strings that match the suppression patterns they test
// (e.g. `'// eslint-disable-next-line @typescript-eslint/no-explicit-any'` as
// a fixture inside an array of patterns SHOULD_MATCH). Mirrors the
// `SELF_PATHS` exclusion in `check-no-new-any.mjs`.
const SELF_PATHS = ['tools/quality/'];
const FILE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

function listFiles(dir) {
  const out = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.github') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      out.push(...listFiles(full));
      continue;
    }
    if (FILE_EXTS.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

function getTrackedFiles() {
  const raw = execSync('git ls-files', { encoding: 'utf8' }).trim();
  if (!raw) return [];
  return raw.split('\n').map((p) => path.resolve(ROOT, p));
}

function main() {
  const tracked = new Set(getTrackedFiles());
  const files = listFiles(ROOT).filter((f) => tracked.has(f));
  const offenders = [];

  for (const file of files) {
    const rel = path.relative(ROOT, file);
    if (SELF_PATHS.some((p) => rel.startsWith(p))) continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (!/@typescript-eslint\/no-explicit-any/.test(line)) continue;
      if (!/eslint-disable-next-line|eslint-disable-line/.test(line)) continue;

      let hasTicket = TICKET_TAG.test(line);
      if (!hasTicket && i > 0) hasTicket = TICKET_TAG.test(lines[i - 1] || '');
      if (!hasTicket && i > 1 && /^\s*$/.test(lines[i - 1] || '')) {
        hasTicket = TICKET_TAG.test(lines[i - 2] || '');
      }
      if (!hasTicket) {
        offenders.push(`${rel}:${i + 1} -> missing TODO(FAC-123): owner=<team> expires=<condition/date> deletionPR=<target> reason`);
      }
    }
  }

  if (offenders.length > 0) {
    console.error('Any-exception policy failed. Owner, expiry, and deletion PR target are required for each waiver.\n');
    offenders.forEach((x) => console.error(`- ${x}`));
    process.exit(1);
  }

  console.log('Any-exception policy passed.');
}

main();

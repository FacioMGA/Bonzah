#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SHARED_DIR = path.join(ROOT, 'frontend', 'src', 'shared');
const ALLOWLIST_FILE = path.join(ROOT, 'tools', 'quality', 'shared-purity-allowlist.json');

const BASE_ALLOWED_TOP_LEVEL = new Set([
  'api',
  'app',
  'components',
  'config',
  'core',
  'lib',
  'store',
  'styles',
  'test',
  'types',
  'ui',
]);

function readAllowlist() {
  if (!fs.existsSync(ALLOWLIST_FILE)) return new Set();
  const parsed = JSON.parse(fs.readFileSync(ALLOWLIST_FILE, 'utf8'));
  const entries = Array.isArray(parsed.allowTopLevelDirs) ? parsed.allowTopLevelDirs : [];
  return new Set(entries.map((entry) => String(entry || '').trim()).filter(Boolean));
}

function directoryHasFiles(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.DS_Store') continue;
    const full = path.join(dirPath, entry.name);
    if (entry.isFile()) return true;
    if (entry.isDirectory() && directoryHasFiles(full)) return true;
  }
  return false;
}

if (!fs.existsSync(SHARED_DIR)) {
  console.log('Shared purity guard passed (no src/shared directory found).');
  process.exit(0);
}

const allowExtra = readAllowlist();
const invalidDirs = fs
  .readdirSync(SHARED_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((dirName) => directoryHasFiles(path.join(SHARED_DIR, dirName)))
  .filter((dirName) => !BASE_ALLOWED_TOP_LEVEL.has(dirName) && !allowExtra.has(dirName))
  .sort();

if (invalidDirs.length > 0) {
  console.error('Shared purity guard failed. Unexpected top-level directories under src/shared:\n');
  for (const dir of invalidDirs) {
    console.error(`- src/shared/${dir}`);
  }
  console.error(
    '\nMove product/domain-specific folders under src/products/*, or temporarily ticket and add to tools/quality/shared-purity-allowlist.json.'
  );
  process.exit(1);
}

console.log('Shared purity guard passed.');

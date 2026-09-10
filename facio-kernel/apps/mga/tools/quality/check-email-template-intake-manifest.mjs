#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const INTAKE_DIR = path.join(ROOT, 'email-templates-temp');
const MANIFEST_PATH = path.join(INTAKE_DIR, 'MANIFEST.json');

function asPosix(p) {
  return p.replaceAll('\\', '/');
}

async function sha256(filePath) {
  const buf = await fs.readFile(filePath);
  return createHash('sha256').update(buf).digest('hex');
}

function fail(lines) {
  console.error(`\n[email-template-intake-manifest] validation failed:\n${lines.map((l) => ` - ${l}`).join('\n')}\n`);
  process.exit(1);
}

async function main() {
  const errors = [];

  try {
    await fs.access(INTAKE_DIR);
  } catch {
    fail(['Missing required folder: email-templates-temp']);
  }

  let manifestRaw = '';
  try {
    manifestRaw = await fs.readFile(MANIFEST_PATH, 'utf8');
  } catch {
    fail(['Missing required file: email-templates-temp/MANIFEST.json']);
  }

  let manifest;
  try {
    manifest = JSON.parse(manifestRaw);
  } catch {
    fail(['MANIFEST.json is not valid JSON']);
  }

  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    fail(['MANIFEST.json root must be an object']);
  }

  const entries = Array.isArray(manifest.entries) ? manifest.entries : null;
  if (!entries) {
    fail(['MANIFEST.json must contain an array field: entries']);
  }

  const requiredTopLevel = ['version', 'lastReviewedUtc', 'runtimeSourceOfTruth'];
  for (const key of requiredTopLevel) {
    if (!(key in manifest)) {
      errors.push(`MANIFEST.json missing top-level field: ${key}`);
    }
  }

  const seenFiles = new Set();
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    const ctx = `entries[${i}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`${ctx} must be an object`);
      continue;
    }

    const file = String(entry.file || '').trim();
    const sha = String(entry.sha256 || '').trim().toLowerCase();
    const maps = Array.isArray(entry.mapsToTemplateKeys) ? entry.mapsToTemplateKeys : null;
    const classification = String(entry.classification || '').trim();

    if (!file) errors.push(`${ctx}.file must be a non-empty string`);
    if (!/^[0-9a-f]{64}$/.test(sha)) errors.push(`${ctx}.sha256 must be a 64-char lowercase hex string`);
    if (!maps) errors.push(`${ctx}.mapsToTemplateKeys must be an array`);
    if (!classification) errors.push(`${ctx}.classification must be a non-empty string`);

    if (!file) continue;
    if (file.includes('/') || file.includes('\\')) {
      errors.push(`${ctx}.file must be a basename, not a path: ${file}`);
      continue;
    }
    if (seenFiles.has(file)) {
      errors.push(`${ctx}.file is duplicated in manifest: ${file}`);
      continue;
    }
    seenFiles.add(file);

    const diskPath = path.join(INTAKE_DIR, file);
    try {
      const stat = await fs.stat(diskPath);
      if (!stat.isFile()) {
        errors.push(`${ctx}.file is not a regular file: ${file}`);
        continue;
      }
      if (/\.md$/i.test(file) || /\.json$/i.test(file)) {
        errors.push(`${ctx}.file must reference source assets only, not control files: ${file}`);
      }
      if (/^[0-9a-f]{64}$/.test(sha)) {
        const actual = await sha256(diskPath);
        if (actual !== sha) {
          errors.push(`${ctx}.sha256 mismatch for ${file}; expected ${sha}, got ${actual}`);
        }
      }
    } catch {
      errors.push(`${ctx}.file does not exist on disk: ${file}`);
    }
  }

  const diskEntries = await fs.readdir(INTAKE_DIR, { withFileTypes: true });
  const sourceFiles = diskEntries
    .filter((d) => d.isFile())
    .map((d) => d.name)
    .filter((name) => name !== 'MANIFEST.json' && name !== 'README.md')
    .sort((a, b) => a.localeCompare(b));
  const manifestFiles = [...seenFiles].sort((a, b) => a.localeCompare(b));

  for (const file of sourceFiles) {
    if (!seenFiles.has(file)) {
      errors.push(`File present in intake folder but missing in manifest: ${file}`);
    }
  }
  for (const file of manifestFiles) {
    if (!sourceFiles.includes(file)) {
      errors.push(`Manifest references file that is not a source asset: ${file}`);
    }
  }

  if (errors.length) {
    fail(errors);
  }

  console.log(
    `[email-template-intake-manifest] ok (${sourceFiles.length} assets tracked, files=${asPosix(
      'email-templates-temp/*',
    )})`,
  );
}

main().catch((error) => {
  console.error('[email-template-intake-manifest] unexpected error');
  console.error(error);
  process.exit(1);
});

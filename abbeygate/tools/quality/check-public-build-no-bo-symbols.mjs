#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const publicDistCandidates = [
  path.resolve(root, 'dist/public'),
  path.resolve(root, 'frontend/dist/public'),
];

const BO_ONLY_MARKERS = [
  'X-Facio-Surface":"bo',
  "X-Facio-Surface':'bo",
  '/api/claims',
  '/api/binders',
  'BoLayout',
  'ClaimsDesk',
  'SettingsGlobalPage',
];

async function walk(dir) {
  const out = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(full)));
      continue;
    }
    if (/\.(js|mjs|cjs|html|css)$/i.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function rel(p) {
  return path.relative(root, p).replaceAll(path.sep, '/');
}

async function main() {
  let publicDist = null;
  for (const candidate of publicDistCandidates) {
    try {
      await fs.access(candidate);
      publicDist = candidate;
      break;
    } catch {
      // Try next candidate path.
    }
  }
  if (!publicDist) {
    const locations = publicDistCandidates.map(rel).join(', ');
    console.error(`[public-build-isolation] missing dist folder (checked: ${locations})`);
    process.exit(1);
  }

  const files = await walk(publicDist);
  const hits = [];
  for (const file of files) {
    const content = await fs.readFile(file, 'utf8');
    for (const marker of BO_ONLY_MARKERS) {
      if (content.includes(marker)) {
        hits.push({ file: rel(file), marker });
      }
    }
  }

  if (hits.length) {
    console.error('[public-build-isolation] BO-only markers found in public bundle');
    for (const hit of hits) {
      console.error(` - ${hit.file} :: ${hit.marker}`);
    }
    process.exit(1);
  }

  console.log(`[public-build-isolation] ok (no BO-only markers in ${rel(publicDist)})`);
}

main().catch((err) => {
  console.error('[public-build-isolation] failed:', err?.message || err);
  process.exit(1);
});

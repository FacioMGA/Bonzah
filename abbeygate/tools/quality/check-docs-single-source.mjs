#!/usr/bin/env node
// tools/quality/check-docs-single-source.mjs
// Guard: no two living docs claim authority over the same topic.
// Two failure modes:
//   1. Two `status: living` files share a `title:` (modulo case/whitespace).
//   2. Two `status: living` files share the same basename in different
//      directories — likely a fold-that-was-never-completed.
//   3. A file declares `supersedes:` but the superseded path still
//      exists as a `status: living` file (or has no `Frozen-on:`).
//
// Severity: error by default per ADR-0010. Bypass with DOCS_GUARDS_STRICT=0
// (local debug only — never set in CI).

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from '../docs/lib/frontmatter.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DOCS_ROOT = path.join(REPO_ROOT, 'docs');

// Strict by default per ADR-0010 (escalated from warn in this PR). Set
// DOCS_GUARDS_STRICT=0 to bypass (intended for local debugging only).
const STRICT = process.env.DOCS_GUARDS_STRICT !== '0';

const IGNORED_BASENAMES = new Set(['README.md']);

async function* walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      yield full;
    }
  }
}

function normaliseTitle(t) {
  return String(t || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

async function main() {
  const titleIndex = new Map();
  const basenameIndex = new Map();
  const supersedesEdges = [];
  const filesByRel = new Map();

  for await (const file of walk(DOCS_ROOT)) {
    const rel = path.relative(REPO_ROOT, file);
    const raw = await fs.readFile(file, 'utf8');
    const { frontmatter, body } = parseFrontmatter(raw);
    const fm = frontmatter || {};
    filesByRel.set(rel, { fm, body });

    if (fm.status !== 'living') continue;
    const baseName = path.basename(rel);
    if (IGNORED_BASENAMES.has(baseName)) continue;

    const titleKey = normaliseTitle(fm.title);
    if (titleKey) {
      const arr = titleIndex.get(titleKey) || [];
      arr.push(rel);
      titleIndex.set(titleKey, arr);
    }

    const arr = basenameIndex.get(baseName) || [];
    arr.push(rel);
    basenameIndex.set(baseName, arr);

    if (fm.supersedes) {
      const targets = String(fm.supersedes)
        .split(',')
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
      for (const target of targets) {
        supersedesEdges.push({ supersedingDoc: rel, supersededPath: target });
      }
    }
  }

  const failures = [];

  for (const [titleKey, paths] of titleIndex) {
    if (paths.length > 1 && titleKey) {
      failures.push({
        kind: 'title-collision',
        title: filesByRel.get(paths[0]).fm.title,
        paths,
      });
    }
  }

  for (const [baseName, paths] of basenameIndex) {
    if (paths.length > 1) {
      failures.push({ kind: 'basename-collision', baseName, paths });
    }
  }

  for (const edge of supersedesEdges) {
    const target = filesByRel.get(edge.supersededPath);
    if (!target) {
      // Path declared as superseded no longer exists — that's correct.
      continue;
    }
    const tfm = target.fm || {};
    if (tfm.status === 'living') {
      failures.push({
        kind: 'superseded-still-living',
        supersedingDoc: edge.supersedingDoc,
        supersededPath: edge.supersededPath,
      });
    } else if (tfm.status === 'archived' && !/Frozen-on\s*[:|]/i.test(target.body)) {
      failures.push({
        kind: 'superseded-missing-frozen-on',
        supersedingDoc: edge.supersedingDoc,
        supersededPath: edge.supersededPath,
      });
    }
  }

  if (failures.length === 0) {
    console.log('guard:docs-single-source: ok');
    return;
  }

  console.error(`guard:docs-single-source: ${failures.length} issue(s) found`);
  for (const f of failures) {
    if (f.kind === 'title-collision') {
      console.error(`  title collision: "${f.title}"`);
      for (const p of f.paths) console.error(`    - ${p}`);
    } else if (f.kind === 'basename-collision') {
      console.error(`  basename collision: ${f.baseName}`);
      for (const p of f.paths) console.error(`    - ${p}`);
    } else if (f.kind === 'superseded-still-living') {
      console.error(`  ${f.supersedingDoc} declares supersedes ${f.supersededPath} but that file is still status: living`);
    } else if (f.kind === 'superseded-missing-frozen-on') {
      console.error(`  ${f.supersedingDoc} supersedes ${f.supersededPath} but archive copy lacks Frozen-on header`);
    }
  }

  if (STRICT) process.exit(1);
  console.error('\n(bypassed via DOCS_GUARDS_STRICT=0 — local debug only; CI will fail)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

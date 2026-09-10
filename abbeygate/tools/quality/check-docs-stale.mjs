#!/usr/bin/env node
// tools/quality/check-docs-stale.mjs
// Guard: documentation freshness windows.
//   binding: true   -> reviewed within 90 days
//   binding: false  -> reviewed within 180 days
// Files under docs/archive/ are exempt.
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
const BINDING_WINDOW_DAYS = 90;
const NON_BINDING_WINDOW_DAYS = 180;

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

function daysBetween(then, now) {
  return Math.floor((now.getTime() - then.getTime()) / (24 * 60 * 60 * 1000));
}

async function main() {
  const now = new Date();
  const failures = [];
  for await (const file of walk(DOCS_ROOT)) {
    const rel = path.relative(REPO_ROOT, file);
    if (rel.startsWith('docs/archive/')) continue;
    const raw = await fs.readFile(file, 'utf8');
    const { frontmatter } = parseFrontmatter(raw);
    if (!frontmatter || !frontmatter.reviewed) continue;
    const reviewed = new Date(String(frontmatter.reviewed));
    if (Number.isNaN(reviewed.getTime())) continue;
    const age = daysBetween(reviewed, now);
    const window = frontmatter.binding ? BINDING_WINDOW_DAYS : NON_BINDING_WINDOW_DAYS;
    if (age > window) {
      failures.push({ rel, reviewed: frontmatter.reviewed, age, window, binding: !!frontmatter.binding });
    }
  }

  if (failures.length === 0) {
    console.log('guard:docs-stale: ok (all docs reviewed within their freshness window)');
    return;
  }

  console.error(`guard:docs-stale: ${failures.length} file(s) past freshness window`);
  for (const f of failures) {
    console.error(
      `  ${f.rel} reviewed=${f.reviewed} age=${f.age}d window=${f.window}d binding=${f.binding}`,
    );
  }

  if (STRICT) process.exit(1);
  console.error('\n(bypassed via DOCS_GUARDS_STRICT=0 — local debug only; CI will fail)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

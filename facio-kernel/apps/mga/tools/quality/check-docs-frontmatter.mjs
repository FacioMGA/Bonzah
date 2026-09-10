#!/usr/bin/env node
// tools/quality/check-docs-frontmatter.mjs
// Guard: every living markdown file under docs/ must declare YAML
// frontmatter with the keys required by ADR-0010:
//   title, audience, status, owner, reviewed, binding
// Files under docs/archive/ are exempt from `audience` / `reviewed`
// requirements but still need `status: archived` and a Frozen-on header.
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

const REQUIRED_LIVING = ['title', 'audience', 'status', 'owner', 'reviewed', 'binding'];
const ALLOWED_AUDIENCES = new Set(['developer', 'operator', 'agent', 'architect']);
// `reference` is allowed for stable reference pages (glossary, label catalogue,
// email matrix, etc.) that are neither binding-living nor frozen-archive.
const ALLOWED_STATUSES = new Set(['living', 'archived', 'draft', 'reference']);

// Strict by default per ADR-0010 (escalated from warn in this PR). Set
// DOCS_GUARDS_STRICT=0 to bypass (intended for local debugging only).
const STRICT = process.env.DOCS_GUARDS_STRICT !== '0';

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

async function checkFile(absolute) {
  const rel = path.relative(REPO_ROOT, absolute);
  const raw = await fs.readFile(absolute, 'utf8');
  const { frontmatter, body } = parseFrontmatter(raw);
  const issues = [];

  if (!frontmatter) {
    issues.push('missing YAML frontmatter');
    return { rel, issues };
  }

  const isArchive = rel.startsWith('docs/archive/');

  for (const key of REQUIRED_LIVING) {
    if (isArchive && (key === 'audience' || key === 'reviewed')) continue;
    if (frontmatter[key] === undefined || frontmatter[key] === '') {
      issues.push(`missing required frontmatter key: ${key}`);
    }
  }

  if (frontmatter.audience && !ALLOWED_AUDIENCES.has(frontmatter.audience)) {
    issues.push(
      `invalid audience: ${frontmatter.audience} (allowed: ${[...ALLOWED_AUDIENCES].join(', ')})`,
    );
  }
  if (frontmatter.status && !ALLOWED_STATUSES.has(frontmatter.status)) {
    issues.push(
      `invalid status: ${frontmatter.status} (allowed: ${[...ALLOWED_STATUSES].join(', ')})`,
    );
  }
  if (frontmatter.binding !== undefined && typeof frontmatter.binding !== 'boolean') {
    issues.push(`binding must be boolean, got: ${typeof frontmatter.binding}`);
  }
  if (frontmatter.reviewed && !/^\d{4}-\d{2}-\d{2}$/.test(String(frontmatter.reviewed))) {
    issues.push(`reviewed must be YYYY-MM-DD, got: ${frontmatter.reviewed}`);
  }

  // Frozen-on is required for actual archived content but NOT for the
  // navigation README.md inside an archive bucket (those describe the bucket).
  const isArchiveNavReadme = isArchive && path.basename(rel) === 'README.md';
  if (isArchive && frontmatter.status === 'archived' && !isArchiveNavReadme) {
    if (!/Frozen-on\s*[:|]/i.test(body)) {
      issues.push('archived file missing `Frozen-on:` header in body');
    }
  }

  return { rel, issues };
}

async function main() {
  const failures = [];
  for await (const file of walk(DOCS_ROOT)) {
    const result = await checkFile(file);
    if (result.issues.length > 0) failures.push(result);
  }

  if (failures.length === 0) {
    console.log('guard:docs-frontmatter: ok (all docs have valid frontmatter)');
    return;
  }

  console.error(`guard:docs-frontmatter: ${failures.length} file(s) failed`);
  for (const f of failures) {
    console.error(`  ${f.rel}`);
    for (const issue of f.issues) {
      console.error(`    - ${issue}`);
    }
  }

  if (STRICT) {
    process.exit(1);
  }
  console.error('\n(bypassed via DOCS_GUARDS_STRICT=0 — local debug only; CI will fail)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

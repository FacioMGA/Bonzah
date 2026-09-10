#!/usr/bin/env node
// tools/quality/check-docs-max-lines.mjs
// Guard: documentation discipline — every doc fits in a reviewable
// budget. Caps come from ADR-0010 ("docs as governance, not narrative"):
//
//   docs/architecture/contracts/*.md         <= 50 lines
//   docs/operate/*.md                        <= 60 lines  (executable runbooks)
//   docs/operate/reference/*.md              unlimited     (long-form ops reference)
//   docs/develop/*.md                        <= 80 lines
//   docs/start-here/*.md                     <= 100 lines
//   docs/product/*.md                        <= 100 lines
//   docs/architecture/decisions/ADR-*.md     unlimited (decision context)
//   docs/reference/*.md                      unlimited (generated)
//   docs/archive/**/*.md                     unlimited (frozen evidence)
//
// Severity: error by default per ADR-0010. Bypass with DOCS_GUARDS_STRICT=0
// (local debug only — never set in CI).

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DOCS_DIR = path.join(REPO_ROOT, 'docs');

// Strict by default per ADR-0010. Set DOCS_GUARDS_STRICT=0 to bypass.
const STRICT = process.env.DOCS_GUARDS_STRICT !== '0';

// Caps in source-of-truth order. The first matching entry wins.
const CAPS = [
  { match: /^architecture\/decisions\/ADR-/, cap: Infinity, label: 'ADR (decision context)' },
  { match: /^reference\//, cap: Infinity, label: 'reference (generated)' },
  { match: /^archive\//, cap: Infinity, label: 'archive (frozen)' },
  { match: /^architecture\/contracts\//, cap: 50, label: 'binding contract' },
  // operate/reference/ holds long-form ops reference (e.g. extended AKS env
  // walkthroughs) that complements the strict <=60-line executable runbooks.
  // Match BEFORE the broader /^operate\// rule.
  { match: /^operate\/reference\//, cap: Infinity, label: 'operate reference (long-form)' },
  { match: /^operate\//, cap: 60, label: 'operate runbook' },
  { match: /^develop\//, cap: 80, label: 'develop guide' },
  { match: /^start-here\//, cap: 100, label: 'start-here entrypoint' },
  { match: /^product\//, cap: 100, label: 'product reference' },
];

async function listMarkdown(dir, prefix = '') {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      const nested = await listMarkdown(full, rel);
      files.push(...nested);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push({ rel, full });
    }
  }
  return files;
}

function capFor(rel) {
  for (const entry of CAPS) {
    if (entry.match.test(rel)) return entry;
  }
  return null;
}

async function lineCount(absolute) {
  const content = await fs.readFile(absolute, 'utf8');
  // Count lines the same way wc -l does: number of \n separators in the
  // file body. A trailing newline is conventional and not counted as an
  // extra line.
  if (content.length === 0) return 0;
  let count = 1;
  for (let i = 0; i < content.length; i += 1) {
    if (content[i] === '\n' && i !== content.length - 1) count += 1;
  }
  return count;
}

async function main() {
  let docs;
  try {
    docs = await listMarkdown(DOCS_DIR);
  } catch {
    console.log('guard:docs-max-lines: no docs/ directory');
    return;
  }

  const violations = [];
  for (const doc of docs) {
    const cap = capFor(doc.rel);
    if (!cap || cap.cap === Infinity) continue;
    const lines = await lineCount(doc.full);
    if (lines > cap.cap) {
      violations.push({ rel: doc.rel, lines, cap: cap.cap, label: cap.label });
    }
  }

  if (violations.length === 0) {
    console.log(`guard:docs-max-lines: ok (${docs.length} docs within their caps)`);
    return;
  }

  console.error(`guard:docs-max-lines: ${violations.length} doc(s) over their cap`);
  violations
    .sort((a, b) => b.lines - a.lines)
    .forEach((v) => {
      console.error(`  - docs/${v.rel}  ${v.lines} lines  (cap: ${v.cap}, ${v.label})`);
    });
  console.error(
    '\nFix: tighten the doc to the allowed/forbidden/escalation shape, or move history into an ADR.',
  );

  if (STRICT) process.exit(1);
  console.error('\n(bypassed via DOCS_GUARDS_STRICT=0 — local debug only; CI will fail)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

#!/usr/bin/env node
// tools/quality/check-no-new-any.mjs
//
// Diff-scoped type-safety ratchet. Fails when a PR adds (`+` lines in the
// unified diff) any of the bypass shapes catalogued in
// lib/any-patterns.mjs::DIFF_ANY_PATTERNS — the literal `any` casts plus the
// laundering shapes LLMs reach for when a literal `any` is blocked
// (`as unknown` alone, `Record<string, unknown>`, index signatures with
// any/unknown, generic-constraint escapes, `keyof any`, `// @ts-ignore`,
// `// @ts-expect-error` without a FAC ticket, eslint-disable for
// no-explicit-any / no-unsafe-* / ban-types, etc.). The intentional escape
// hatch is a TODO(FAC-####): owner=… expires=… deletionPR=… annotation
// on the same line, which `check-any-exceptions.mjs` then policies
// separately.
import { readUnifiedDiff } from './lib/ci-diff-range.mjs';
import { DIFF_ANY_PATTERNS, findDiffAnyMatches, SCANNABLE_EXTENSIONS } from './lib/any-patterns.mjs';
const ALLOW_TAG = /TODO\(FAC-\d+\):(?=.*\bowner=[^\s]+)(?=.*\bexpires=[^\s]+)(?=.*\bdeletionPR=[^\s]+).+/;
const SELF_PATHS = ['tools/quality/'];

function main() {
  const diff = readUnifiedDiff();
  const lines = diff.split('\n');

  let file = '';
  const offenders = [];

  for (const line of lines) {
    if (line.startsWith('+++ b/')) {
      file = line.slice('+++ b/'.length);
      continue;
    }
    const ext = file ? file.slice(file.lastIndexOf('.')) : '';
    if (!SCANNABLE_EXTENSIONS.has(ext)) continue;
    if (SELF_PATHS.some((p) => file.startsWith(p))) continue;
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    if (ALLOW_TAG.test(line)) continue;
    const matched = findDiffAnyMatches(line);
    if (matched.length > 0) {
      offenders.push({ file, line: line.slice(1).trim(), matched });
    }
  }

  if (offenders.length > 0) {
    console.error(`Diff type-laundering guard failed: ${offenders.length} new laundering shape(s) introduced.\n`);
    for (const offender of offenders) {
      console.error(`- ${offender.file}: ${offender.line}`);
      console.error(`    matched: ${offender.matched.join(' | ')}`);
    }
    console.error(
      '\nThis guard is a DIFF TRIPWIRE, not the final truth — it scans only',
      '\nadded lines for the laundering shapes catalogued in',
      '\n`lib/any-patterns.mjs::DIFF_ANY_PATTERNS`. If unavoidable, annotate',
      '\nthe same line with:',
      '\n  TODO(FAC-123): owner=<team> expires=<condition/date> deletionPR=<target> <reason>',
      '\nand `check-any-exceptions` will accept it. The compiler-walk truth is',
      '\nin `check-any-resolved.mjs`; the regex baseline truth is in',
      '\n`check-any-baseline.mjs` (the "Any-pattern ratchet").',
    );
    process.exit(1);
  }

  console.log(`Diff type-laundering guard passed: no new laundering shapes in diff (${DIFF_ANY_PATTERNS.length} patterns checked).`);
}

main();

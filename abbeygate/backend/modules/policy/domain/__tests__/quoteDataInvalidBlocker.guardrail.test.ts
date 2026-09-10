/**
 * Guardrail — `QUOTE_DATA_INVALID` issue-readiness blocker has exactly
 * one producer.
 *
 * `evaluateIssueReadiness` is the canonical issue-readiness derivation
 * (`docs/architecture/contracts/canonical-ownership.md`,
 * `docs/architecture/contracts/products.md`). The blocker it emits for
 * adapter validation failures (`{ code: 'QUOTE_DATA_INVALID', group,
 * severity, message, details }`) is built exclusively by
 * `buildQuoteDataInvalidBlocker` in `quoteDataInvalidBlocker.ts`.
 *
 * The previous regression: a parallel orchestrator
 * (`evaluateIssueReadinessForQuoteData`) constructed the same blocker
 * code with a divergent group / message shape. This guardrail ensures
 * the duplication cannot quietly return — a second emitter anywhere in
 * the policy domain trips the test, and the author must either (a)
 * route through the canonical builder or (b) open an ADR to amend the
 * canonical-ownership contract.
 *
 * The grep is intentionally narrow: HTTP error envelopes that reuse
 * the literal `'QUOTE_DATA_INVALID'` as a status / error code (e.g.
 * `bindingRouter.ts`, `BindPolicy.ts`, `CreateFromQuote.ts`,
 * `policyCompliance.ts`) do not satisfy the readiness blocker shape
 * (no `group`/`severity` siblings) and are out of scope.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../../../..');
const POLICY_DOMAIN = path.join(ROOT, 'backend/modules/policy/domain');
const CANONICAL_BUILDER_PATH = path.join(POLICY_DOMAIN, 'quoteDataInvalidBlocker.ts');

function walk(dir: string, accumulator: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules' || entry.name === 'dist') continue;
      walk(path.join(dir, entry.name), accumulator);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.ts')) continue;
    accumulator.push(path.join(dir, entry.name));
  }
  return accumulator;
}

/**
 * Identify a "readiness blocker" object literal: one that carries the
 * blocker-shape sibling keys (`group:` AND `severity:`) within ~10
 * lines of the `code: 'QUOTE_DATA_INVALID'` token. HTTP error
 * envelopes don't carry these siblings.
 */
function fileEmitsReadinessBlocker(absPath: string): boolean {
  const source = fs.readFileSync(absPath, 'utf8');
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.includes("code: 'QUOTE_DATA_INVALID'") && !line.includes('code: "QUOTE_DATA_INVALID"')) continue;
    const window = lines.slice(Math.max(0, i - 10), Math.min(lines.length, i + 10)).join('\n');
    if (/\bgroup\s*:/.test(window) && /\bseverity\s*:/.test(window)) return true;
  }
  return false;
}

describe('QUOTE_DATA_INVALID readiness blocker — guardrail', () => {
  it('is emitted by exactly one source file in backend/modules/policy/domain (the canonical builder)', () => {
    const candidates = walk(POLICY_DOMAIN);
    const emitters = candidates.filter(fileEmitsReadinessBlocker);
    const relativeEmitters = emitters.map((p) => path.relative(ROOT, p)).sort();

    expect(
      relativeEmitters,
      `Found ${relativeEmitters.length} emitter(s) of the QUOTE_DATA_INVALID readiness blocker. ` +
        `Only quoteDataInvalidBlocker.ts is permitted to construct it. ` +
        `If a new producer is genuinely needed, route through buildQuoteDataInvalidBlocker(...) ` +
        `or open an ADR amending docs/architecture/contracts/canonical-ownership.md. ` +
        `Emitters: ${JSON.stringify(relativeEmitters)}`,
    ).toEqual([path.relative(ROOT, CANONICAL_BUILDER_PATH)]);
  });
});

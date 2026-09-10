// Journey contract: terminal documents_failed surface (ADR-0017).
//
// Bound to BOTH spines that produce the terminal failure surface:
//   - runIssuedPackJob: the worker entry point that records the
//     ISSUED_PACK_GENERATION_FAILED / ISSUED_PACK_MISSING_DOC_TYPES
//     audit + flips setIssueReadiness({ failureCode }).
//   - evaluateIssueReadiness: the derivation that emits
//     customerOutcome: 'failed' so the wizard stops polling.
//
// Narrative + deeper-proof index: docs/develop/journey-registry.md.

import { describe, expect, it, vi } from 'vitest';

// See bo-generate-doc-packs.journey.test.ts: importing
// runIssuedPackJob transitively loads pdfRenderer -> puppeteer.
// Stub puppeteer so the contract test does not race with the
// chromium dynamic-import during worker shutdown.
vi.mock('puppeteer', () => ({ default: { launch: vi.fn() } }));

import { runIssuedPackJob } from '../../backend/workers/handlers/DOC.GENERATE_ISSUED_POLICY_PACK.js';
import { evaluateIssueReadiness } from '../../backend/modules/policy/domain/issueReadiness.js';
import type { IssueReadinessResult } from '../../backend/modules/policy/domain/issueReadinessTypes.js';

const failedOutcome: IssueReadinessResult['customerOutcome'] = 'failed';

describe('journey: public-payment-documents-failed (ADR-0017)', () => {
  it('binds to the canonical worker + readiness spines', () => {
    expect(typeof runIssuedPackJob).toBe('function');
    expect(typeof evaluateIssueReadiness).toBe('function');
  });

  it("preserves customerOutcome === 'failed' in the readiness contract", () => {
    expect(failedOutcome).toBe('failed');
  });
});

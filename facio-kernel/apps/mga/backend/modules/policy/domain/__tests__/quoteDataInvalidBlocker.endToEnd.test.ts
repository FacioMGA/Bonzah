/**
 * End-to-end wiring — `evaluateIssueReadiness` (canonical orchestrator)
 * routes adapter validation failures through `buildQuoteDataInvalidBlocker`.
 *
 * Pins the BO Premium-tab user experience: when the operator leaves a
 * required canonical proposer field blank (here: `proposer.address.country`,
 * unset in the screenshot the user reported), the blocker that surfaces
 * names the operator-facing manifest label while preserving the exact path
 * in blocker details — not the useless `"proposer"` token the legacy
 * humanizer collapsed everything to.
 *
 * Sister files:
 *   - `quoteDataInvalidBlocker.test.ts` — pure builder + humanizer.
 *   - `quoteDataInvalidBlocker.guardrail.test.ts` — only one source
 *     file in `policy/domain` is permitted to construct this blocker.
 */

import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerAllProducts } from '../../../../products/registerProducts.js';
import { homeGoldenFixtures } from '../../../../products/home/goldenFixtures.js';

const mutatedHomeQuote = (() => {
  const data = structuredClone(homeGoldenFixtures.minimumValid) as Record<string, unknown>;
  const proposer = data.proposer as Record<string, unknown>;
  const address = proposer.address as Record<string, unknown>;
  delete address.country;
  return data;
})();

let quoteDataForReadiness: Prisma.JsonObject = mutatedHomeQuote as Prisma.JsonObject;
type RiskTransactionContextFixture = {
  status: 'BOUND';
  transactionType: 'ENDORSEMENT';
  snapshotFinal: {
    quoteData: Prisma.JsonObject;
    quoteResponse: Prisma.JsonObject;
  };
};
let riskTransactionContextForReadiness: RiskTransactionContextFixture | null = null;

vi.mock('../../app/read/issueReadinessRepository.js', () => ({
  findPolicyForIssueReadiness: vi.fn(async () => ({
    id: 'policy-1',
    policyNumber: 'Q-1',
    productType: 'HOME',
    status: 'QUOTED',
    isLocked: false,
    inceptionDate: new Date('2026-01-01T00:00:00.000Z'),
    expiryDate: new Date('2027-01-01T00:00:00.000Z'),
    payments: [],
    quoteData: quoteDataForReadiness,
    quoteResponse: { primaryOption: { annualPremium: 250 } },
    stateCurrent: {
      snapshot: {
        quoteData: quoteDataForReadiness,
        quoteResponse: { primaryOption: { annualPremium: 250 } },
        pricing: { snapshotHash: 'snapshot', pricingHash: 'pricing' },
        uw: { completedAt: '2026-01-01T00:00:00.000Z', validationResult: { isValid: true } },
      },
    },
  })),
  findBoundInceptionTransaction: vi.fn(async () => null),
  findGeneratedIssuedDocuments: vi.fn(async () => []),
  findLatestPaidPayment: vi.fn(async () => null),
  findLatestPaymentFailureEvent: vi.fn(async () => null),
  findPaymentEvent: vi.fn(async () => null),
  findRiskTransactionContext: vi.fn(async () => riskTransactionContextForReadiness),
  findAuthorityWindowContext: vi.fn(async () => null),
}));

describe('evaluateIssueReadiness — QUOTE_DATA_INVALID end-to-end (Home, BO channel)', () => {
  beforeEach(() => {
    quoteDataForReadiness = mutatedHomeQuote;
    riskTransactionContextForReadiness = null;
  });

  it('emits a single canonical blocker that names the exact failing proposer subpath', async () => {
    registerAllProducts();
    const { evaluateIssueReadiness } = await import('../../app/issueReadiness.js');

    const readiness = await evaluateIssueReadiness('policy-1', 'bo');

    const blocker = readiness.blockers.find((b) => b.code === 'QUOTE_DATA_INVALID');
    expect(
      blocker,
      `Expected a QUOTE_DATA_INVALID blocker. Got: ${JSON.stringify(readiness.blockers.map((b) => b.code))}`,
    ).toBeDefined();
    expect(blocker?.group).toBe('UNDERWRITING');
    expect(blocker?.severity).toBe('BLOCK');
    expect(blocker?.message).toContain('Country');
    expect(blocker?.details?.missingSlugs).toContain('proposer.address.country');
    // Regression guard: must not collapse to bare "proposer."
    expect(blocker?.message).not.toMatch(/Missing or invalid: proposer\.?$/);
    expect(blocker?.actions?.[0]?.actionId).toBe('BO.OPEN_CUSTOMER_QUOTE');
  });

  it('fails closed when the canonical quote snapshot is an empty object', async () => {
    quoteDataForReadiness = {};
    registerAllProducts();
    const { evaluateIssueReadiness } = await import('../../app/issueReadiness.js');

    const readiness = await evaluateIssueReadiness('policy-1', 'bo');
    const blocker = readiness.blockers.find((entry) => entry.code === 'QUOTE_DATA_INVALID');

    expect(readiness.derived.hasQuoteData).toBe(false);
    expect(blocker).toBeDefined();
    expect(readiness.canIssue).toBe(false);
  });

  it('does not let a bound endorsement replace an empty immutable snapshot with mutable policy data', async () => {
    riskTransactionContextForReadiness = {
      status: 'BOUND',
      transactionType: 'ENDORSEMENT',
      snapshotFinal: {
        quoteData: {},
        quoteResponse: { primaryOption: { annualPremium: 250 } },
      },
    };
    registerAllProducts();
    const { evaluateIssueReadiness } = await import('../../app/issueReadiness.js');

    const readiness = await evaluateIssueReadiness('policy-1', 'bo', { riskTransactionId: 'rt-1' });

    expect(readiness.canIssue).toBe(false);
    expect(readiness.blockers.some((entry) => (
      entry.code === 'QUOTE_DATA_INVALID' || entry.code === 'DOCUMENT_FIELDS_MISSING'
    ))).toBe(true);
  });
});

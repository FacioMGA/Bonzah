import { describe, expect, it, vi } from 'vitest';
import { registerAllProducts } from '../../../../products/registerProducts.js';

vi.mock('../../app/read/issueReadinessRepository.js', () => ({
  findPolicyForIssueReadiness: vi.fn(async () => ({
    id: 'policy-1',
    policyNumber: 'Q-1',
    productType: 'MOTOR',
    status: 'QUOTED',
    isLocked: false,
    inceptionDate: new Date('2026-01-01T00:00:00.000Z'),
    expiryDate: new Date('2027-01-01T00:00:00.000Z'),
    payments: [],
    quoteData: {},
    quoteResponse: null,
    stateCurrent: {
      snapshot: {
        quoteData: {},
        quoteResponse: { primaryOption: { annualPremium: 100 } },
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
  findRiskTransactionContext: vi.fn(async () => null),
  findAuthorityWindowContext: vi.fn(async () => null),
}));

describe('issue readiness diagnostics', () => {
  it('reports validator source and read path for product adapter blockers in non-production', async () => {
    registerAllProducts();
    const { evaluateIssueReadiness } = await import('../../app/issueReadiness.js');

    const readiness = await evaluateIssueReadiness('policy-1', 'customer');

    expect(readiness.diagnostics?.validation.length).toBeGreaterThan(0);
    expect(readiness.diagnostics?.validation[0]).toEqual(expect.objectContaining({
      productType: 'MOTOR',
      validator: expect.stringContaining('productAdapter'),
      readPath: expect.stringContaining('stateCurrent.snapshot.quoteData.'),
      blocking: true,
    }));
  });
});

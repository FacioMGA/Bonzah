import { beforeEach, describe, expect, it, vi } from 'vitest';

const txMock = {
  policyStateCurrent: { findUnique: vi.fn() },
  riskTransaction: { findFirst: vi.fn(), update: vi.fn() },
};

const prismaMock = {
  riskTransaction: { findFirst: vi.fn() },
  $transaction: vi.fn(),
};

const evaluateIssueReadiness = vi.fn();
const auditLog = vi.fn();

vi.mock('../../../../platform/db/connection.js', () => ({
  tenantScopedPrisma: prismaMock,
}));

vi.mock('../../../../platform/audit/logger.js', () => ({
  AuditLogger: { log: auditLog },
}));

vi.mock('../issueReadiness.js', () => ({
  evaluateIssueReadiness,
}));

describe('executeBindEndorsementDraft pricing finalisation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    prismaMock.riskTransaction.findFirst.mockResolvedValue({ transactionType: 'ENDORSEMENT' });
    prismaMock.$transaction.mockImplementation(async (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock));
    txMock.riskTransaction.findFirst.mockResolvedValue({ id: 'rt-1', status: 'DRAFT', transactionType: 'ENDORSEMENT' });
    evaluateIssueReadiness.mockResolvedValue({ canIssue: true, blockers: [] });
  });

  it('blocks binding when the draft snapshot has not been rated', async () => {
    const { executeBindEndorsementDraft } = await import('../BindEndorsementDraft.js');
    txMock.policyStateCurrent.findUnique.mockResolvedValue({
      snapshot: {
        quoteData: { risk: 'changed' },
      },
    });

    const result = await executeBindEndorsementDraft({
      policyId: 'policy-1',
      riskTransactionId: 'rt-1',
      actor: { id: 'user-1', name: 'Under Writer', email: 'u@example.com', role: 'UNDERWRITER' },
    });
    expect(result).toMatchObject({
      status: 'BLOCKED',
      error: { code: 'PRICING_REQUIRED' },
    });
    expect(txMock.riskTransaction.update).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('blocks binding when a rated draft has no quote data for the immutable issued snapshot', async () => {
    const { executeBindEndorsementDraft } = await import('../BindEndorsementDraft.js');
    txMock.policyStateCurrent.findUnique.mockResolvedValue({
      snapshot: {
        quoteResponse: {
          currency: 'EUR',
          primaryOption: {
            costDetails: {
              totalPremium: 123.45,
            },
          },
        },
        pricing: {
          snapshotHash: 'snapshot-hash',
          pricingHash: 'pricing-hash',
        },
      },
    });

    const result = await executeBindEndorsementDraft({
      policyId: 'policy-1',
      riskTransactionId: 'rt-1',
      actor: { id: 'user-1', name: 'Under Writer', email: 'u@example.com', role: 'UNDERWRITER' },
    });

    expect(result).toMatchObject({
      status: 'BLOCKED',
      error: { code: 'QUOTE_DATA_REQUIRED' },
    });
    expect(txMock.riskTransaction.update).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('persists pricingFinal from the explicit rated snapshot and integrity hashes', async () => {
    const { executeBindEndorsementDraft } = await import('../BindEndorsementDraft.js');
    txMock.policyStateCurrent.findUnique.mockResolvedValue({
      snapshot: {
        quoteData: { risk: 'changed' },
        quoteResponse: {
          currency: 'EUR',
          primaryOption: {
            costDetails: {
              totalPremium: 123.45,
            },
          },
        },
        pricing: {
          snapshotHash: 'snapshot-hash',
          pricingHash: 'pricing-hash',
        },
      },
    });
    txMock.riskTransaction.update.mockResolvedValue({
      id: 'rt-1',
      transactionNumber: 7,
      status: 'BOUND',
    });

    const result = await executeBindEndorsementDraft({
      policyId: 'policy-1',
      riskTransactionId: 'rt-1',
      actor: { id: 'user-1', name: 'Under Writer', email: 'u@example.com', role: 'UNDERWRITER' },
    });
    expect(result).toMatchObject({ status: 'SUCCESS' });
    const update = txMock.riskTransaction.update.mock.calls[0]?.[0];
    const pricingFinal = update.data.pricingFinal as Record<string, unknown>;
    expect(pricingFinal).toMatchObject({
      premium: 123.45,
      currency: 'EUR',
      pricing: {
        snapshotHash: 'snapshot-hash',
        pricingHash: 'pricing-hash',
      },
    });
    expect(auditLog).toHaveBeenCalledTimes(1);
  });

  it('rejects annualPremium-only snapshots instead of using the retired fallback', async () => {
    const { executeBindEndorsementDraft } = await import('../BindEndorsementDraft.js');
    txMock.policyStateCurrent.findUnique.mockResolvedValue({
      snapshot: {
        quoteData: { risk: 'changed' },
        quoteResponse: {
          currency: 'EUR',
          primaryOption: {
            annualPremium: 123.45,
          },
        },
        pricing: {
          snapshotHash: 'snapshot-hash',
          pricingHash: 'pricing-hash',
        },
      },
    });

    const result = await executeBindEndorsementDraft({
      policyId: 'policy-1',
      riskTransactionId: 'rt-1',
      actor: { id: 'user-1', name: 'Under Writer', email: 'u@example.com', role: 'UNDERWRITER' },
    });

    expect(result).toMatchObject({
      status: 'BLOCKED',
      error: { code: 'PRICING_REQUIRED' },
    });
    expect(txMock.riskTransaction.update).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseRecord } from '../../../../platform/json/parseRecord.js';

const mocks = vi.hoisted(() => ({
  screeningPolicyFindUnique: vi.fn(),
  transaction: vi.fn(),
  txPolicyFindUnique: vi.fn(),
  txPolicyUpdate: vi.fn(),
  txPolicyStateCurrentFindUnique: vi.fn(),
  txPolicyStateCurrentUpsert: vi.fn(),
  txRiskTransactionFindFirst: vi.fn(),
  txRiskTransactionCreate: vi.fn(),
  txInvoiceCreate: vi.fn(),
  txPaymentUpdate: vi.fn(),
  txBinderFindFirst: vi.fn(),
  txBinderFinancialsFindUnique: vi.fn(),
  txPremiumTransactionCreate: vi.fn(),
  txPolicySearchIndexUpsert: vi.fn(),
  transitionPolicyLifecycle: vi.fn(),
  enqueueIssuedPolicyPack: vi.fn(),
  enqueuePolicyListIndexUpdate: vi.fn(),
  enqueueAccounts360ProjectionUpdate: vi.fn(),
  enqueueAccountIntelligenceProjectionUpdate: vi.fn(),
  rebuildPolicyListIndexRow: vi.fn(),
  reserveNextCertificateNumber: vi.fn(),
  reserveNextPolicyId: vi.fn(),
  assertClearOrThrow: vi.fn(),
  resolveIndividualScreeningSubject: vi.fn(),
  derivePremiumFinancials: vi.fn(),
}));

const tx = {
  policy: { findUnique: mocks.txPolicyFindUnique, update: mocks.txPolicyUpdate },
  policyStateCurrent: { findUnique: mocks.txPolicyStateCurrentFindUnique, upsert: mocks.txPolicyStateCurrentUpsert },
  riskTransaction: { findFirst: mocks.txRiskTransactionFindFirst, create: mocks.txRiskTransactionCreate },
  invoice: { create: mocks.txInvoiceCreate },
  payment: { update: mocks.txPaymentUpdate },
  binder: { findFirst: mocks.txBinderFindFirst },
  binderFinancials: { findUnique: mocks.txBinderFinancialsFindUnique },
  premiumTransaction: { create: mocks.txPremiumTransactionCreate },
  policySearchIndex: { upsert: mocks.txPolicySearchIndexUpsert },
};

vi.mock('../../../../platform/db/connection.js', () => ({
  tenantScopedPrisma: {
    policy: { findUnique: mocks.screeningPolicyFindUnique },
    $transaction: mocks.transaction,
  },
}));

vi.mock('../../../policy/app/commands/policyLifecycleCommands.js', () => ({
  transitionPolicyLifecycle: mocks.transitionPolicyLifecycle,
}));

vi.mock('../../../policy/app/commands/issuedPackEnqueue.js', () => ({
  enqueueIssuedPolicyPack: mocks.enqueueIssuedPolicyPack,
}));

vi.mock('../../../policy/infra/projections/policyListIndex.js', () => ({
  enqueuePolicyListIndexUpdate: mocks.enqueuePolicyListIndexUpdate,
  rebuildPolicyListIndexRow: mocks.rebuildPolicyListIndexRow,
}));

vi.mock('../../../accounts360/infra/projections/accounts360Projection.js', () => ({
  enqueueAccounts360ProjectionUpdate: mocks.enqueueAccounts360ProjectionUpdate,
}));

vi.mock('../../../accounts360/infra/projections/accountIntelligenceProjection.js', () => ({
  enqueueAccountIntelligenceProjectionUpdate: mocks.enqueueAccountIntelligenceProjectionUpdate,
}));

vi.mock('../../../../platform/utils/platformIds.js', async (importOriginal) => ({
  // Preserve the real pure predicates (isReservedQuoteId / isReservedPolicyNumber, ADR-0047)
  // while overriding the reservation functions this suite asserts on.
  ...(await importOriginal<typeof import('../../../../platform/utils/platformIds.js')>()),
  reserveNextCertificateNumber: mocks.reserveNextCertificateNumber,
  reserveNextPolicyId: mocks.reserveNextPolicyId,
}));

vi.mock('../../../compliance/app/index.js', () => ({
  getSanctionsService: () => ({ assertClearOrThrow: mocks.assertClearOrThrow }),
  resolveIndividualScreeningSubject: mocks.resolveIndividualScreeningSubject,
  SanctionsBlockError: class SanctionsBlockError extends Error {},
}));

vi.mock('../../../policy/domain/premiumFinancials.js', () => ({
  derivePremiumFinancials: mocks.derivePremiumFinancials,
}));

vi.mock('../../../../platform/utils/logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

function buildQuoteResponse(productType: string) {
  return {
    status: 'QUOTED',
    currency: 'EUR',
    primaryOption: {
      name: `${productType} option`,
      annualPremium: 123.45,
      voluntaryExcess: 250,
      costDetails: { subtotalNetPremium: 123.45 },
    },
  };
}

function buildCandidate(productType: string) {
  return {
    id: `policy-${productType.toLowerCase()}`,
    productType,
    policyNumber: `ABQ-${productType}`,
    certificateNumber: null,
    binderId: `binder-${productType.toLowerCase()}`,
    binder: { id: `binder-${productType.toLowerCase()}`, defaultCurrency: 'EUR', umr: 'B176025EEA6153' },
    umr: null,
    issuedAt: null,
    policyHolderId: `holder-${productType.toLowerCase()}`,
    policyHolder: { name: `${productType} Customer` },
    quoteData: {
      proposer: { firstName: 'Ada', lastName: productType, email: `${productType.toLowerCase()}@example.com` },
      renewalDate: '2026-05-09',
    },
    quoteResponse: buildQuoteResponse(productType),
  };
}

describe('runCardcorpPaidIssuance product spine coverage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx));
    mocks.screeningPolicyFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({
      id: where.id,
      quoteData: { proposer: { firstName: 'Ada', lastName: 'Lovelace' } },
      policyHolder: { name: 'Ada Lovelace' },
    }));
    mocks.resolveIndividualScreeningSubject.mockReturnValue({ subjectName: 'Ada Lovelace', dateOfBirth: '1985-05-05' });
    mocks.assertClearOrThrow.mockResolvedValue(undefined);
    mocks.txPolicyStateCurrentFindUnique.mockResolvedValue({ snapshot: { coverageSelection: { selected: {} } } });
    mocks.txRiskTransactionFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ transactionNumber: 0 });
    mocks.txRiskTransactionCreate.mockResolvedValue({ id: 'rt-inception' });
    mocks.txPolicyUpdate.mockResolvedValue({});
    mocks.txPolicySearchIndexUpsert.mockResolvedValue({});
    mocks.txPolicyStateCurrentUpsert.mockResolvedValue({});
    mocks.txInvoiceCreate.mockResolvedValue({});
    mocks.txPaymentUpdate.mockResolvedValue({});
    mocks.txBinderFinancialsFindUnique.mockResolvedValue(null);
    mocks.txPremiumTransactionCreate.mockResolvedValue({});
    mocks.transitionPolicyLifecycle.mockResolvedValue(undefined);
    mocks.enqueuePolicyListIndexUpdate.mockResolvedValue(undefined);
    mocks.enqueueAccounts360ProjectionUpdate.mockResolvedValue(undefined);
    mocks.enqueueAccountIntelligenceProjectionUpdate.mockResolvedValue(undefined);
    mocks.enqueueIssuedPolicyPack.mockResolvedValue({ eventId: 'issued-pack-event' });
    mocks.rebuildPolicyListIndexRow.mockResolvedValue(undefined);
    mocks.reserveNextPolicyId.mockResolvedValue('ABOLV-ISSUED');
    mocks.reserveNextCertificateNumber.mockResolvedValue('CERT-1');
    mocks.derivePremiumFinancials.mockReturnValue({
      grossPremium: 123.45,
      commissionPercent: 0,
      commissionAmount: 0,
      taxesTotal: 0,
      feesTotal: 0,
      netToLondon: 123.45,
    });
  });

  it.each(['MOTOR', 'HOME', 'TRAVEL', 'HEALTH'])(
    'customer payment issuance for %s creates INCEPTION and enqueues the canonical issued-pack spine',
    async (productType) => {
      const candidate = buildCandidate(productType);
      mocks.txPolicyFindUnique.mockResolvedValueOnce(candidate);

      const { runCardcorpPaidIssuance } = await import('../cardcorpPolicyIssuanceService.js');
      const result = await runCardcorpPaidIssuance({
        policy: { id: candidate.id, policyNumber: candidate.policyNumber },
        updatedPayment: { id: 'payment-1' },
        status: { paymentId: 'gateway-payment-1', amount: '123.45', currency: 'EUR' },
        checkoutId: 'checkout-1',
        correlationId: `corr-${productType.toLowerCase()}`,
        baseUrl: '',
        parseRecord: (value) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {},
        jsonStringify: (value) => value,
        resolveInceptionDateFromRenewalDate: () => new Date('2026-05-09T00:00:00.000Z'),
      });

      expect(result).toEqual({ selectedBundleId: 'EX250_CP0_VIP0' });
      // UMR is the bound binder's Unique Market Reference — never fabricated.
      expect(mocks.txPolicyUpdate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ umr: 'B176025EEA6153' }),
      }));
      const riskTransactionPayload = mocks.txRiskTransactionCreate.mock.calls.at(-1)?.[0]?.data;
      const expiryDate = riskTransactionPayload?.expiryDate as Date;
      expect(expiryDate).toBeInstanceOf(Date);
      expect(expiryDate.getHours()).toBe(12);
      expect(Math.round((expiryDate.getTime() - new Date('2026-05-09T00:00:00.000Z').getTime()) / 86_400_000)).toBe(365);
      expect(mocks.txRiskTransactionCreate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          policyId: candidate.id,
          transactionType: 'INCEPTION',
          status: 'BOUND',
        }),
      }));
      expect(mocks.enqueueIssuedPolicyPack).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          policyId: candidate.id,
          riskTransactionId: 'rt-inception',
          source: 'SYSTEM',
          idempotencyKey: `issued-pack:${candidate.id}:rt-inception`,
          correlationId: `corr-${productType.toLowerCase()}`,
        }),
      );
      expect(mocks.txPaymentUpdate).toHaveBeenCalledWith({
        where: { id: 'payment-1' },
        data: { riskTransactionId: 'rt-inception' },
      });
    },
  );

  it.each([
    ['BUSINESS', 'manual-business', 'Business Insurance'],
    ['OPEN_MARKET', 'manual-open-market', 'Open Market'],
  ])(
    'customer payment issuance for manual product %s binds from the accepted proposal snapshot',
    async (productType, expectedBundleId, expectedSegment) => {
      const candidate = {
        ...buildCandidate(productType),
        quoteData: {
          proposer: { firstName: 'Ada', lastName: productType, email: `${productType.toLowerCase()}@example.com` },
          renewalDate: '2026-05-09',
          manualPremium: 123.45,
          proposal: {
            marketName: 'Open Market Binder / Business',
            coverageRows: [{ coverage: 'Public liability', limit: '1,000,000', excess: '500', premium: 123.45 }],
          },
        },
      };
      mocks.txPolicyFindUnique.mockResolvedValueOnce(candidate);

      const { runCardcorpPaidIssuance } = await import('../cardcorpPolicyIssuanceService.js');
      const result = await runCardcorpPaidIssuance({
        policy: { id: candidate.id, policyNumber: candidate.policyNumber },
        updatedPayment: { id: 'payment-1' },
        status: { paymentId: 'gateway-payment-1', amount: '123.45', currency: 'EUR' },
        checkoutId: 'checkout-1',
        correlationId: `corr-${productType.toLowerCase()}`,
        baseUrl: '',
        parseRecord: (value) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {},
        jsonStringify: (value) => value,
        resolveInceptionDateFromRenewalDate: () => new Date('2026-05-09T00:00:00.000Z'),
      });

      expect(result).toEqual({ selectedBundleId: expectedBundleId });
      const riskTransactionPayload = mocks.txRiskTransactionCreate.mock.calls.at(-1)?.[0]?.data;
      const snapshot = riskTransactionPayload?.snapshotFinal as Record<string, unknown>;
      expect(snapshot.acceptedManualProposal).toEqual(expect.objectContaining({
        source: 'customer_payment',
        manualPremium: 123.45,
        proposal: expect.objectContaining({ marketName: 'Open Market Binder / Business' }),
      }));
      expect(mocks.txPolicySearchIndexUpsert).toHaveBeenCalledWith(expect.objectContaining({
        create: expect.objectContaining({ segment: expectedSegment }),
        update: expect.objectContaining({ segment: expectedSegment }),
      }));
      expect(mocks.enqueueIssuedPolicyPack).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          policyId: candidate.id,
          riskTransactionId: 'rt-inception',
        }),
      );
    },
  );

  it('refuses payment issuance when the canonical policy product type is missing', async () => {
    const candidate = { ...buildCandidate('HOME'), productType: null };
    mocks.txPolicyFindUnique.mockResolvedValueOnce(candidate);

    const { runCardcorpPaidIssuance } = await import('../cardcorpPolicyIssuanceService.js');

    await expect(runCardcorpPaidIssuance({
      policy: { id: candidate.id, policyNumber: candidate.policyNumber },
      updatedPayment: { id: 'payment-1' },
      status: { paymentId: 'gateway-payment-1', amount: '123.45', currency: 'EUR' },
      checkoutId: 'checkout-1',
      baseUrl: '',
      parseRecord,
      jsonStringify: (value) => value,
      resolveInceptionDateFromRenewalDate: () => new Date('2026-05-09T00:00:00.000Z'),
    })).rejects.toThrow(/missing canonical productType/i);
    expect(mocks.reserveNextPolicyId).not.toHaveBeenCalled();
  });
});

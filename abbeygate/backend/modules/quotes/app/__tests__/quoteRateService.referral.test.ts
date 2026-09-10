import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * REFERRAL → EMAIL.UW_REFERRAL producer contract on the generic rating spine.
 *
 * Before this producer existed, only the motor rating chokepoint
 * (`backend/products/motor/quotes/service.ts`) enqueued the referral
 * notification. Home / Travel / Health quotes that landed in REFERRAL
 * (age, claims history, rate-table referral) notified nobody — the
 * jurisdiction's underwriting team had no signal to contact the client.
 * These tests pin the transactional-outbox enqueue (a canonical
 * DomainEventEnvelope, so BEHAVIOR.NORMALIZE can ingest the row) and the
 * reason normalization ({ code, message } → "CODE: message" strings).
 */

const outboxCreate = vi.fn();
const txPolicyUpdate = vi.fn();
const txStateUpsert = vi.fn();

const tx = {
  policy: { update: txPolicyUpdate },
  policyStateCurrent: { upsert: txStateUpsert },
  outbox: { create: outboxCreate },
};

const policyFindUnique = vi.fn();
const stateFindUnique = vi.fn();
const programFindUnique = vi.fn();
const findLatestActiveBinderLinkForProductMock = vi.fn();
const resolvePolicyPeriodForProductMock = vi.fn();

vi.mock('../../../../platform/db/connection.js', () => ({
  tenantScopedPrisma: {
    policy: { findUnique: (...args: unknown[]) => policyFindUnique(...args) },
    policyStateCurrent: { findUnique: (...args: unknown[]) => stateFindUnique(...args) },
    program: { findUnique: (...args: unknown[]) => programFindUnique(...args) },
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  },
}));

vi.mock('../../../compliance/app/index.js', () => ({
  assertSanctionsClearForQuote: vi.fn(async () => undefined),
  SanctionsBlockError: class SanctionsBlockError extends Error {},
}));

vi.mock('../../../policy/app/binders/binderAuthority.js', () => ({
  findLatestActiveBinderLinkForProduct: (...args: unknown[]) => findLatestActiveBinderLinkForProductMock(...args),
}));

const buildQuoteResponseMock = vi.fn();
const resolveEffectiveCoverageContractMock = vi.fn();

vi.mock('../../../policy/app/productRegistryService.js', () => ({
  buildQuoteResponseForProduct: (...args: unknown[]) => buildQuoteResponseMock(...args),
  productAdapterExists: vi.fn(() => true),
  resolvePolicyPeriodForProduct: (...args: unknown[]) => resolvePolicyPeriodForProductMock(...args),
  validateProductQuoteForRating: vi.fn(() => ({ ok: true })),
}));

vi.mock('../../../policy/app/coverageSelectionContract.js', () => ({
  resolveEffectiveCoverageContract: (...args: unknown[]) => resolveEffectiveCoverageContractMock(...args),
}));

vi.mock('../../../policy/app/mbeInterop.js', () => ({
  normalizeProgramMbeProductConfig: vi.fn(() => ({})),
}));

vi.mock('../../../policy/app/pricing/pricingIntegrityStamp.js', () => ({
  computePricingIntegrityStamp: vi.fn(() => ({})),
}));

const sendTravelQuoteEmailAfterRateMock = vi.fn();
vi.mock('../sendTravelQuoteEmailAfterRate.js', () => ({
  sendTravelQuoteEmailAfterRate: (...args: unknown[]) => sendTravelQuoteEmailAfterRateMock(...args),
}));

// appendDomainEvent resolves the operating tenant for the outbox row.
vi.mock('../../../../platform/tenant/tenantConfig.js', () => ({
  getTenantConfig: vi.fn(() => ({ id: 'tenant_test', countryCode: 'CY' })),
}));

const { ratePolicyAndPersist, referralReasonsFromQuoteResponse } = await import('../quoteRateService.js');

describe('ratePolicyAndPersist — REFERRAL notification producer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendTravelQuoteEmailAfterRateMock.mockResolvedValue(undefined);
    policyFindUnique.mockResolvedValue({
      id: 'pol_travel_1',
      policyNumber: 'ABQ5000123',
      programId: null,
      binderId: null,
      quoteData: {},
      policyHolder: null,
    });
    stateFindUnique.mockResolvedValue(null);
    programFindUnique.mockResolvedValue(null);
    resolveEffectiveCoverageContractMock.mockReturnValue({ resolvedCoverageSet: null });
    findLatestActiveBinderLinkForProductMock.mockResolvedValue(null);
    resolvePolicyPeriodForProductMock.mockReturnValue(null);
  });

  it('enqueues a canonical EMAIL.UW_REFERRAL envelope when rating lands in REFERRAL', async () => {
    buildQuoteResponseMock.mockResolvedValue({
      quoteResponse: {
        status: 'REFERRAL',
        uwDecision: {
          lane: 'referral',
          reasons: [{ code: 'AGE_REFERRAL', message: 'Traveller age 82 requires manual review' }],
        },
        primaryOption: null,
      },
      underwritingAnalysis: null,
    });

    const result = await ratePolicyAndPersist({ policyId: 'pol_travel_1', productType: 'TRAVEL' });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.status).toBe('REFERRAL');
    expect(outboxCreate).toHaveBeenCalledTimes(1);
    const created = outboxCreate.mock.calls[0]![0] as {
      data: {
        eventType: string;
        aggregateId: string;
        eventId: string;
        payload: {
          eventId: string;
          eventType: string;
          aggregateType: string;
          aggregateId: string;
          actorType: string;
          occurredAt: string;
          data: { policyId: string; policyNumber?: string; quoteReference?: string; reasons: string[] };
        };
      };
    };
    expect(created.data.eventType).toBe('EMAIL.UW_REFERRAL');
    expect(created.data.aggregateId).toBe('pol_travel_1');
    // Canonical DomainEventEnvelope — required so BEHAVIOR.NORMALIZE
    // accepts the row (a flat payload is skipped as INVALID_ENVELOPE).
    expect(created.data.payload.eventType).toBe('EMAIL.UW_REFERRAL');
    expect(created.data.payload.aggregateType).toBe('POLICY');
    expect(created.data.payload.aggregateId).toBe('pol_travel_1');
    expect(created.data.payload.eventId).toBeTruthy();
    expect(created.data.payload.occurredAt).toBeTruthy();
    // Referral payload rides under `data` (handler extracts either shape).
    expect(created.data.payload.data.policyId).toBe('pol_travel_1');
    expect(created.data.payload.data.policyNumber).toBe('ABQ5000123');
    expect(created.data.payload.data.reasons).toEqual([
      'AGE_REFERRAL: Traveller age 82 requires manual review',
    ]);
  });

  it('does NOT enqueue a referral notification for a QUOTED outcome', async () => {
    buildQuoteResponseMock.mockResolvedValue({
      quoteResponse: { status: 'QUOTED', primaryOption: { annualPremium: 120 } },
      underwritingAnalysis: null,
    });

    const result = await ratePolicyAndPersist({ policyId: 'pol_travel_1', productType: 'TRAVEL' });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.status).toBe('QUOTED');
    expect(outboxCreate).not.toHaveBeenCalled();
    expect(sendTravelQuoteEmailAfterRateMock).toHaveBeenCalledWith({
      policyId: 'pol_travel_1',
      productType: 'TRAVEL',
      previousStatus: '',
      finalStatus: 'QUOTED',
      correlationId: undefined,
    });
  });

  it('queues Home correspondence only when the public rate endpoint explicitly requests it (ABY-514)', async () => {
    policyFindUnique.mockResolvedValue({
      id: 'pol_home_1',
      policyNumber: 'ABQ5000999',
      publicSessionToken: 'tok_home_514',
      programId: 'program-home',
      binderId: 'binder-home',
      quoteData: { proposer: { email: 'peter@abbeygate.cy' } },
      policyHolder: null,
    });
    buildQuoteResponseMock.mockResolvedValue({
      quoteResponse: { status: 'QUOTED', primaryOption: { annualPremium: 420 } },
      underwritingAnalysis: null,
    });
    const result = await ratePolicyAndPersist({
      policyId: 'pol_home_1',
      productType: 'HOME',
      correlationId: 'corr-514',
      quoteEmailIntent: 'SEND_AFTER_QUOTED',
    });

    expect(result.ok).toBe(true);
    expect(outboxCreate).toHaveBeenCalledTimes(1);
    const payload = (outboxCreate.mock.calls[0]![0] as { data: { payload: { eventType: string; data: unknown } } }).data.payload;
    expect(payload).toMatchObject({
      eventType: 'EMAIL.PUBLIC_QUOTE',
      data: { policyId: 'pol_home_1', productCode: 'HOME', source: 'rate' },
    });
  });

  it('does not queue customer correspondence when a Home quote is re-rated by a non-public caller', async () => {
    policyFindUnique.mockResolvedValue({
      id: 'pol_home_bo_1',
      programId: 'program-home',
      binderId: 'binder-home',
      quoteData: { proposer: { email: 'peter@abbeygate.cy' } },
      policyHolder: null,
    });
    buildQuoteResponseMock.mockResolvedValue({
      quoteResponse: { status: 'QUOTED', primaryOption: { annualPremium: 420 } },
      underwritingAnalysis: null,
    });

    await ratePolicyAndPersist({ policyId: 'pol_home_bo_1', productType: 'HOME' });

    expect(outboxCreate).not.toHaveBeenCalled();
  });

  it('persists the effective program and binder together when rating re-resolves authority', async () => {
    policyFindUnique.mockResolvedValue({
      id: 'pol_motor_1',
      policyNumber: 'ABQ5000456',
      programId: 'program-home-stale',
      binderId: 'binder-home-stale',
      quoteData: {},
      policyHolder: null,
    });
    resolvePolicyPeriodForProductMock.mockReturnValue({
      inceptionDate: new Date('2026-08-27T00:00:00.000Z'),
      expiryDate: new Date('2027-08-26T00:00:00.000Z'),
    });
    findLatestActiveBinderLinkForProductMock.mockResolvedValue({
      programId: 'program-motor-current',
      binderId: 'binder-motor-current',
      program: { id: 'program-motor-current', name: 'Motor', productType: 'MOTOR', updatedAt: new Date() },
      binder: { id: 'binder-motor-current', agreementNumber: 'UMR-1', umr: 'UMR-1', startDate: null, endDate: null },
    });
    programFindUnique.mockResolvedValue({
      id: 'program-motor-current',
      metadata: { programCode: 'motor-current', mbeProductConfig: { source: 'current-program' } },
    });
    buildQuoteResponseMock.mockResolvedValue({
      quoteResponse: { status: 'QUOTED', primaryOption: { annualPremium: 120 } },
      underwritingAnalysis: null,
    });

    const result = await ratePolicyAndPersist({ policyId: 'pol_motor_1', productType: 'MOTOR' });

    expect(result.ok).toBe(true);
    expect(txPolicyUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'pol_motor_1' },
      data: expect.objectContaining({
        programId: 'program-motor-current',
        binderId: 'binder-motor-current',
      }),
    }));
    expect(programFindUnique).toHaveBeenCalledWith({ where: { id: 'program-motor-current' } });
    expect(resolveEffectiveCoverageContractMock).toHaveBeenCalledWith(expect.objectContaining({
      programId: 'program-motor-current',
    }));
    expect(buildQuoteResponseMock).toHaveBeenCalledWith(expect.objectContaining({
      programMeta: expect.objectContaining({ programCode: 'motor-current' }),
    }));
  });
});

describe('referralReasonsFromQuoteResponse', () => {
  it('passes through motor-style string reasons', () => {
    expect(
      referralReasonsFromQuoteResponse({
        uwDecision: { reasons: ['Proposer is under 25 — requires underwriter referral per scheme.'] },
      }),
    ).toEqual(['Proposer is under 25 — requires underwriter referral per scheme.']);
  });

  it('normalizes { code, message } reasons to "CODE: message" strings', () => {
    expect(
      referralReasonsFromQuoteResponse({
        uwDecision: {
          reasons: [
            { code: 'AGE_REFERRAL', message: 'Traveller age 82 requires manual review' },
            { code: 'RATE_REFERRAL' },
          ],
        },
      }),
    ).toEqual(['AGE_REFERRAL: Traveller age 82 requires manual review', 'RATE_REFERRAL']);
  });

  it('returns an empty array when the response carries no reasons', () => {
    expect(referralReasonsFromQuoteResponse({})).toEqual([]);
  });
});

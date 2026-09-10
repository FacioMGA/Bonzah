/* eslint-disable max-lines -- canonical quote-rate referral scenarios share one transaction fixture. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computeManualUwApprovedRiskHash } from '../../../policy/domain/manualUwApproval.js';

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
const txPolicyFindUnique = vi.fn();
const txStateUpsert = vi.fn();
const txStateUpdateMany = vi.fn(async (args: { data: { snapshot: unknown } }) => {
  txStateUpsert({ update: { snapshot: args.data.snapshot } });
  return { count: 1 };
});
const txStateCreate = vi.fn(async (args: { data: { snapshot: unknown } }) => {
  txStateUpsert({ update: { snapshot: args.data.snapshot }, create: args.data });
  return {};
});
const txPaymentFindMany = vi.fn();
const txPaymentFindUnique = vi.fn();
const txPaymentUpdate = vi.fn();
const txPaymentUpdateMany = vi.fn();
const transitionPolicyLifecycleMock = vi.hoisted(() => vi.fn());

const tx = {
  policy: { update: txPolicyUpdate, findUnique: txPolicyFindUnique },
  policyStateCurrent: {
    updateMany: txStateUpdateMany,
    create: txStateCreate,
  },
  payment: {
    findMany: txPaymentFindMany,
    findUnique: txPaymentFindUnique,
    update: txPaymentUpdate,
    updateMany: txPaymentUpdateMany,
  },
  outbox: { create: outboxCreate },
};

const policyFindUnique = vi.fn();
const stateFindUnique = vi.fn();
const programFindUnique = vi.fn();
const binderProductAuthorityFindUnique = vi.fn();
const findLatestActiveBinderLinkForProductMock = vi.fn();
const resolvePolicyPeriodForProductMock = vi.fn();
const resolveMappedProgramDefinitionMock = vi.fn();

vi.mock('../../../../platform/db/connection.js', () => ({
  runTenantScopedTransaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  tenantScopedPrisma: {
    policy: { findUnique: (...args: unknown[]) => policyFindUnique(...args) },
    policyStateCurrent: { findUnique: (...args: unknown[]) => stateFindUnique(...args) },
    program: { findUnique: (...args: unknown[]) => programFindUnique(...args) },
    binderProductAuthority: { findUnique: (...args: unknown[]) => binderProductAuthorityFindUnique(...args) },
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

vi.mock('../../../policy/app/productRegistryService.js', async (importOriginal) => ({
  retainProgramDefinition: (await importOriginal<typeof import('../../../policy/app/productRegistryService.js')>()).retainProgramDefinition,
  buildQuoteResponseForProduct: (...args: unknown[]) => buildQuoteResponseMock(...args),
  productAdapterExists: vi.fn(() => true),
  resolvePolicyPeriodForProduct: (...args: unknown[]) => resolvePolicyPeriodForProductMock(...args),
  validateProductQuoteForRating: vi.fn(() => ({ ok: true })),
  getManualUwApprovalCustomerCompletionPaths: vi.fn(() => [
    'eligibility.confirmation',
    'policy.startDate',
    'proposer.nif',
    'mortgage.hasMortgage',
    'mortgage.lenderName',
    'mortgage.lenderAddress',
    'mortgage.lenderReference',
  ]),
}));

vi.mock('../../../policy/app/commands/policyLifecycleCommands.js', () => ({
  transitionPolicyLifecycle: (...args: unknown[]) => transitionPolicyLifecycleMock(...args),
}));

vi.mock('../../../policy/domain/coverageSelectionContract.js', () => ({
  resolveEffectiveCoverageContract: (...args: unknown[]) => resolveEffectiveCoverageContractMock(...args),
}));

vi.mock('../../../policy/app/mbeInterop.js', () => ({
  normalizeProgramMbeProductConfig: vi.fn(() => ({})),
  parsePublishedProgramMbeProductConfig: vi.fn(() => ({ schemaVersion: 1, programCode: 'test', base: [], options: [] })),
}));

vi.mock('../../../programs/app/activeProgramDefinition.js', () => ({
  resolveMappedProgramDefinition: (...args: unknown[]) => resolveMappedProgramDefinitionMock(...args),
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
    binderProductAuthorityFindUnique.mockResolvedValue({ id: 'authority-test' });
    resolveMappedProgramDefinitionMock.mockResolvedValue({
      id: 'definition-test',
      programId: 'program-test',
      version: 1,
      pricingMode: 'AUTOMATED',
      binderProductAuthorityId: 'authority-test',
      underwriting: {},
      coverage: {},
      questionnaire: {},
      workflow: {},
      channels: {},
      documents: {},
      ratingModel: { id: 'rating-test', programId: 'program-test', version: 1, tables: {} },
    });
    resolveEffectiveCoverageContractMock.mockReturnValue({ resolvedCoverageSet: null });
    findLatestActiveBinderLinkForProductMock.mockResolvedValue(null);
    resolvePolicyPeriodForProductMock.mockReturnValue(null);
    transitionPolicyLifecycleMock.mockResolvedValue(undefined);
    txStateUpdateMany.mockImplementation(async (args: { data: { snapshot: unknown } }) => {
      txStateUpsert({ update: { snapshot: args.data.snapshot } });
      return { count: 1 };
    });
    txPaymentFindMany.mockResolvedValue([]);
    txPolicyFindUnique.mockResolvedValue({ policyHolderId: null });
    txPaymentFindUnique.mockResolvedValue({
      id: 'payment-1', status: 'PENDING', updatedAt: new Date(), policyId: 'pol_home_awaiting_payment_expired',
    });
    txPaymentUpdateMany.mockResolvedValue({ count: 1 });
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
    const savedSnapshot = txStateUpsert.mock.calls.at(-1)?.[0]?.update?.snapshot;
    expect(savedSnapshot.programDefinition).toEqual({
      id: 'definition-test', programId: 'program-test', version: 1, pricingMode: 'AUTOMATED',
      binderProductAuthorityId: 'authority-test', underwriting: {}, coverage: {}, questionnaire: {},
      workflow: {}, channels: {}, documents: {},
    });
    expect(savedSnapshot.programDefinition).not.toHaveProperty('ratingModel');
    expect(sendTravelQuoteEmailAfterRateMock).toHaveBeenCalledWith({
      policyId: 'pol_travel_1',
      productType: 'TRAVEL',
      previousStatus: '',
      finalStatus: 'QUOTED',
      correlationId: undefined,
    });
  });

  it('honours a current manual UW approval after the customer completes its outstanding declaration', async () => {
    const quoteData = {
      property: { woodenConstruction: true },
      eligibility: { confirmation: true },
      policy: { startDate: '2026-09-10' },
    };
    const customerCompletionPaths = [
      'eligibility.confirmation',
      'policy.startDate',
      'proposer.nif',
      'mortgage.hasMortgage',
      'mortgage.lenderName',
      'mortgage.lenderAddress',
      'mortgage.lenderReference',
    ];
    stateFindUnique.mockResolvedValue({
      snapshot: {
        quoteData,
        uw: {
          manualApproval: {
            approvedRiskHash: computeManualUwApprovedRiskHash({
              quoteData: {
                property: { woodenConstruction: true },
                eligibility: { confirmation: false },
                policy: { startDate: '' },
              },
              coverageSelection: undefined,
              authority: null,
              underwritingDecision: { outcome: 'referral' },
              customerCompletionPaths,
            }),
            customerCompletionPaths,
          },
        },
      },
    });
    buildQuoteResponseMock.mockResolvedValue({
      quoteResponse: {
        status: 'REFERRAL',
        uwDecision: { reasons: ['Combustible construction requires review'] },
        primaryOption: { annualPremium: 420 },
      },
      underwritingAnalysis: { outcome: 'referral' },
    });

    const result = await ratePolicyAndPersist({ policyId: 'pol_travel_1', productType: 'HOME' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe('QUOTED');
      expect(result.quoteResponse).toMatchObject({ status: 'QUOTED', manualUwApproval: true });
    }
    expect(txPolicyUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'QUOTED' }),
    }));
    expect(outboxCreate).not.toHaveBeenCalled();
  });

  it('persists a new manual approval with its fresh pricing stamp and lifecycle transition', async () => {
    const quoteData = {
      property: { woodenConstruction: true },
      eligibility: { confirmation: false },
      policy: { startDate: '' },
      proposer: { nif: '' },
      mortgage: { hasMortgage: false, lenderName: '', lenderAddress: '', lenderReference: '' },
    };
    policyFindUnique.mockResolvedValue({
      id: 'pol_home_referral',
      status: 'REFERRAL',
      policyNumber: 'ABQ/CY1000833',
      programId: null,
      binderId: null,
      quoteData,
      policyHolder: null,
    });
    stateFindUnique.mockResolvedValue({ snapshot: { quoteData, uw: { previous: 'value' } } });
    buildQuoteResponseMock.mockResolvedValue({
      quoteResponse: { status: 'REFERRAL', primaryOption: { annualPremium: 420 } },
      underwritingAnalysis: { outcome: 'referral' },
    });

    const result = await ratePolicyAndPersist({
      policyId: 'pol_home_referral',
      productType: 'HOME',
      manualUwApproval: {
        approvedBy: { id: 'underwriter-1', name: 'Underwriter', email: 'uw@example.test', role: 'UNDERWRITER' },
      },
    });

    expect(result).toMatchObject({ ok: true, status: 'QUOTED' });
    const stateUpsert = txStateUpsert.mock.calls[0]![0] as { update: { snapshot: { uw: { manualApproval: unknown } } } };
    expect(stateUpsert.update.snapshot.uw.manualApproval).toMatchObject({
      approvedBy: { id: 'underwriter-1' },
      customerCompletionPaths: expect.arrayContaining(['policy.startDate', 'proposer.nif']),
    });
    expect(transitionPolicyLifecycleMock).toHaveBeenCalledWith(expect.objectContaining({
      policyId: 'pol_home_referral',
      to: 'QUOTED',
      reasonCode: 'UW_MANUAL_APPROVAL',
    }));
    expect(txPolicyUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({ status: expect.anything() }),
    }));
  });

  it('fails closed when a customer saves quote state while an underwriter approves', async () => {
    const quoteData = {
      property: { woodenConstruction: true },
      eligibility: { confirmation: false },
      policy: { startDate: '' },
      proposer: { nif: '' },
      mortgage: { hasMortgage: false, lenderName: '', lenderAddress: '', lenderReference: '' },
    };
    policyFindUnique.mockResolvedValue({
      id: 'pol_home_concurrent_edit',
      status: 'REFERRAL',
      policyNumber: 'ABQ/CY1000833',
      programId: null,
      binderId: null,
      quoteData,
      policyHolder: null,
    });
    stateFindUnique.mockResolvedValue({
      updatedAt: new Date('2026-09-04T08:00:00.000Z'),
      snapshot: { quoteData },
    });
    buildQuoteResponseMock.mockResolvedValue({
      quoteResponse: { status: 'REFERRAL', primaryOption: { annualPremium: 420 } },
      underwritingAnalysis: { outcome: 'referral' },
    });
    txStateUpdateMany.mockResolvedValue({ count: 0 });

    const result = await ratePolicyAndPersist({
      policyId: 'pol_home_concurrent_edit',
      productType: 'HOME',
      manualUwApproval: {
        approvedBy: { id: 'underwriter-1', name: 'Underwriter', email: 'uw@example.test', role: 'UNDERWRITER' },
      },
    });

    expect(result).toMatchObject({ ok: false, status: 409, code: 'QUOTE_STATE_CHANGED_DURING_RATING' });
    expect(txStateUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { policyId: 'pol_home_concurrent_edit', updatedAt: new Date('2026-09-04T08:00:00.000Z') },
    }));
    expect(txPolicyUpdate).not.toHaveBeenCalled();
    expect(transitionPolicyLifecycleMock).not.toHaveBeenCalled();
  });

  it('scopes approval to the policy authority before inception is completed', async () => {
    const quoteData = {
      property: { woodenConstruction: true },
      eligibility: { confirmation: false },
      policy: { startDate: '' },
      proposer: { nif: '' },
      mortgage: { hasMortgage: false, lenderName: '', lenderAddress: '', lenderReference: '' },
    };
    policyFindUnique.mockResolvedValue({
      id: 'pol_home_authority',
      status: 'REFERRAL',
      policyNumber: 'ABQ/CY1000834',
      programId: 'program-home',
      binderId: 'binder-home',
      quoteData,
      policyHolder: null,
    });
    stateFindUnique.mockResolvedValue({ snapshot: { quoteData } });
    programFindUnique.mockResolvedValue({
      id: 'program-home',
      metadata: {},
      updatedAt: new Date('2026-09-03T00:00:00.000Z'),
    });
    buildQuoteResponseMock.mockResolvedValue({
      quoteResponse: { status: 'REFERRAL', primaryOption: { annualPremium: 420 } },
      underwritingAnalysis: { outcome: 'referral' },
    });

    await ratePolicyAndPersist({
      policyId: 'pol_home_authority',
      productType: 'HOME',
      manualUwApproval: {
        approvedBy: { id: 'underwriter-1', name: 'Underwriter', email: 'uw@example.test', role: 'UNDERWRITER' },
      },
    });

    const stateUpsert = txStateUpsert.mock.calls[0]![0] as {
      update: { snapshot: { uw: { manualApproval: { approvedRiskHash: string; customerCompletionPaths: string[] } } } };
    };
    const approval = stateUpsert.update.snapshot.uw.manualApproval;
    expect(approval.approvedRiskHash).toBe(computeManualUwApprovedRiskHash({
      quoteData,
      coverageSelection: undefined,
      authority: {
        binderId: 'binder-home',
        programId: 'program-home',
        underwritingAuthority: {
          underwriting: {}, workflow: {},
          mbeProductConfig: { schemaVersion: 1, programCode: 'test', base: [], options: [] },
        },
      },
      underwritingDecision: { outcome: 'referral' },
      customerCompletionPaths: approval.customerCompletionPaths,
    }));
  });

  it('expires approval when a completed inception has no active authority link', async () => {
    const quoteData = {
      property: { woodenConstruction: true },
      policy: { startDate: '2026-09-10' },
    };
    const customerCompletionPaths = ['policy.startDate'];
    policyFindUnique.mockResolvedValue({
      id: 'pol_home_authority_expired',
      status: 'QUOTED',
      policyNumber: 'ABQ/CY1000836',
      programId: 'program-home',
      binderId: 'binder-home',
      quoteData,
      policyHolder: null,
    });
    resolvePolicyPeriodForProductMock.mockReturnValue({
      inceptionDate: new Date('2026-09-10T00:00:00.000Z'),
      expiryDate: new Date('2027-09-09T00:00:00.000Z'),
    });
    stateFindUnique.mockResolvedValue({
      snapshot: {
        quoteData,
        uw: {
          manualApproval: {
            approvedRiskHash: computeManualUwApprovedRiskHash({
              quoteData: { property: { woodenConstruction: true }, policy: { startDate: '' } },
              coverageSelection: undefined,
              authority: { binderId: 'binder-home', programId: 'program-home', underwritingAuthority: {} },
              customerCompletionPaths,
            }),
            customerCompletionPaths,
          },
        },
      },
    });
    buildQuoteResponseMock.mockResolvedValue({
      quoteResponse: { status: 'REFERRAL', primaryOption: { annualPremium: 420 } },
      underwritingAnalysis: { outcome: 'referral' },
    });

    await ratePolicyAndPersist({ policyId: 'pol_home_authority_expired', productType: 'HOME' });

    expect(transitionPolicyLifecycleMock).toHaveBeenCalledWith(expect.objectContaining({
      to: 'REFERRAL',
      reasonCode: 'UW_MANUAL_APPROVAL_EXPIRED',
    }));
  });

  it('uses the lifecycle path when a stale manual approval returns a quote to referral', async () => {
    const quoteData = { property: { woodenConstruction: false } };
    policyFindUnique.mockResolvedValue({
      id: 'pol_home_expired',
      status: 'QUOTED',
      policyNumber: 'ABQ/CY1000835',
      programId: 'program-home',
      binderId: 'binder-home',
      quoteData,
      policyHolder: null,
    });
    stateFindUnique.mockResolvedValue({
      snapshot: {
        quoteData,
        uw: {
          manualApproval: {
            approvedRiskHash: 'stale-approval',
            customerCompletionPaths: [],
          },
        },
      },
    });
    buildQuoteResponseMock.mockResolvedValue({
      quoteResponse: { status: 'REFERRAL', primaryOption: { annualPremium: 420 } },
      underwritingAnalysis: { outcome: 'referral' },
    });

    await ratePolicyAndPersist({ policyId: 'pol_home_expired', productType: 'HOME' });

    expect(transitionPolicyLifecycleMock).toHaveBeenCalledWith(expect.objectContaining({
      policyId: 'pol_home_expired',
      to: 'REFERRAL',
      reasonCode: 'UW_MANUAL_APPROVAL_EXPIRED',
    }));
    expect(txPolicyUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({ status: expect.anything() }),
    }));
  });

  it('projects a hashless historic manual approval when it expires to referral', async () => {
    policyFindUnique.mockResolvedValue({
      id: 'pol_home_legacy_approval',
      status: 'QUOTED',
      policyNumber: 'ABQ/CY1000837',
      programId: 'program-home',
      binderId: 'binder-home',
      quoteData: { property: { woodenConstruction: true } },
      policyHolder: null,
    });
    stateFindUnique.mockResolvedValue({
      snapshot: {
        quoteData: { property: { woodenConstruction: true } },
        uw: { manualApproval: { approvedAt: '2026-09-03T00:00:00.000Z' } },
      },
    });
    buildQuoteResponseMock.mockResolvedValue({
      quoteResponse: { status: 'REFERRAL', primaryOption: { annualPremium: 420 } },
      underwritingAnalysis: { outcome: 'referral' },
    });

    await ratePolicyAndPersist({ policyId: 'pol_home_legacy_approval', productType: 'HOME' });

    expect(transitionPolicyLifecycleMock).toHaveBeenCalledWith(expect.objectContaining({
      to: 'REFERRAL',
      reasonCode: 'UW_MANUAL_APPROVAL_EXPIRED',
    }));
  });

  it('projects approval expiry when an awaiting-payment customer changes a reviewed risk', async () => {
    policyFindUnique.mockResolvedValue({
      id: 'pol_home_awaiting_payment_expired',
      status: 'AWAITING_PAYMENT',
      policyNumber: 'ABQ/CY1000840',
      programId: 'program-home',
      binderId: 'binder-home',
      quoteData: { property: { woodenConstruction: true } },
      policyHolder: null,
    });
    stateFindUnique.mockResolvedValue({
      snapshot: {
        quoteData: { property: { woodenConstruction: true } },
        uw: { manualApproval: { approvedRiskHash: 'stale-approval' } },
      },
    });
    buildQuoteResponseMock.mockResolvedValue({
      quoteResponse: { status: 'REFERRAL', primaryOption: { annualPremium: 420 } },
      underwritingAnalysis: { outcome: 'referral' },
    });
    txPaymentFindMany.mockResolvedValue([{ id: 'payment-1' }]);

    await ratePolicyAndPersist({ policyId: 'pol_home_awaiting_payment_expired', productType: 'HOME' });

    expect(transitionPolicyLifecycleMock).toHaveBeenCalledWith(expect.objectContaining({
      policyId: 'pol_home_awaiting_payment_expired',
      to: 'REFERRAL',
      reasonCode: 'UW_MANUAL_APPROVAL_EXPIRED',
    }));
    expect(txPaymentUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'payment-1', status: 'PENDING' },
      data: { status: 'CANCELLED' },
    }));
    expect(txPolicyUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ isLocked: false, paymentStatus: 'NOT_REQUIRED' }),
    }));
  });

  it('cancels the pending checkout when a reviewed risk is declined after approval', async () => {
    policyFindUnique.mockResolvedValue({
      id: 'pol_home_awaiting_payment_declined',
      status: 'AWAITING_PAYMENT',
      policyNumber: 'ABQ/CY1000843',
      programId: 'program-home',
      binderId: 'binder-home',
      quoteData: { property: { woodenConstruction: true } },
      policyHolder: null,
    });
    stateFindUnique.mockResolvedValue({
      snapshot: {
        quoteData: { property: { woodenConstruction: true } },
        uw: { manualApproval: { approvedRiskHash: 'stale-approval' } },
      },
    });
    buildQuoteResponseMock.mockResolvedValue({
      quoteResponse: { status: 'DECLINED', primaryOption: null },
      underwritingAnalysis: { outcome: 'declined' },
    });
    txPaymentFindMany.mockResolvedValue([{ id: 'payment-declined-1' }]);

    await ratePolicyAndPersist({ policyId: 'pol_home_awaiting_payment_declined', productType: 'HOME' });

    expect(transitionPolicyLifecycleMock).toHaveBeenCalledWith(expect.objectContaining({
      policyId: 'pol_home_awaiting_payment_declined',
      to: 'DECLINED',
      reasonCode: 'UW_MANUAL_APPROVAL_EXPIRED',
    }));
    expect(txPaymentUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'payment-declined-1', status: 'PENDING' },
      data: { status: 'CANCELLED' },
    }));
  });

  it('preserves the canonical stored excess override when a referred motor risk is manually approved', async () => {
    policyFindUnique.mockResolvedValue({
      id: 'pol_motor_override',
      status: 'REFERRAL',
      policyNumber: 'ABQ/CY1000841',
      programId: null,
      binderId: null,
      quoteData: { vehicle: { make: 'Test' } },
      policyHolder: null,
    });
    stateFindUnique.mockResolvedValue({
      snapshot: {
        quoteData: { vehicle: { make: 'Test' } },
        pricing: { boOverrideApproval: { required: true, requestedOverrideExcess: 250 } },
      },
    });
    buildQuoteResponseMock.mockResolvedValue({
      quoteResponse: { status: 'REFERRAL', primaryOption: { annualPremium: 420 } },
      underwritingAnalysis: { outcome: 'referral' },
    });

    const result = await ratePolicyAndPersist({
      policyId: 'pol_motor_override',
      productType: 'MOTOR',
      manualUwApproval: {
        approvedBy: { id: 'underwriter-1', name: 'Underwriter', email: 'uw@example.test', role: 'UNDERWRITER' },
      },
    });

    expect(result).toMatchObject({ ok: true, status: 'QUOTED' });
    expect(buildQuoteResponseMock).toHaveBeenCalledWith(expect.objectContaining({ overrideExcess: 250 }));
  });

  it('rejects a manual approval when the policy is no longer referred', async () => {
    policyFindUnique.mockResolvedValue({
      id: 'pol_issued',
      status: 'ISSUED',
      policyNumber: 'BZ/CY5000001',
      programId: null,
      binderId: null,
      quoteData: {},
      policyHolder: null,
    });

    const result = await ratePolicyAndPersist({
      policyId: 'pol_issued',
      productType: 'HOME',
      manualUwApproval: {
        approvedBy: { id: 'underwriter-1', name: 'Underwriter', email: 'uw@example.test', role: 'UNDERWRITER' },
      },
    });

    expect(result).toMatchObject({
      ok: false,
      status: 409,
      code: 'MANUAL_UW_APPROVAL_STATUS_INVALID',
    });
    expect(txPolicyUpdate).not.toHaveBeenCalled();
  });

  it('permits a reapproval only when BO has identified a stale quoted approval', async () => {
    policyFindUnique.mockResolvedValue({
      id: 'pol_stale_quoted_approval',
      status: 'QUOTED',
      policyNumber: 'ABQ/CY1000839',
      programId: null,
      binderId: null,
      quoteData: {},
      policyHolder: null,
    });
    stateFindUnique.mockResolvedValue({ snapshot: { quoteData: {} } });
    buildQuoteResponseMock.mockResolvedValue({
      quoteResponse: { status: 'REFERRAL', primaryOption: { annualPremium: 420 } },
      underwritingAnalysis: { outcome: 'referral' },
    });

    const result = await ratePolicyAndPersist({
      policyId: 'pol_stale_quoted_approval',
      productType: 'HOME',
      manualUwApproval: {
        approvedBy: { id: 'underwriter-1', name: 'Underwriter', email: 'uw@example.test', role: 'UNDERWRITER' },
        reapprovalForStaleQuotedPolicy: true,
      },
    });

    expect(result).toMatchObject({ ok: true, status: 'QUOTED' });
    expect(transitionPolicyLifecycleMock).toHaveBeenCalledWith(expect.objectContaining({
      policyId: 'pol_stale_quoted_approval',
      to: 'QUOTED',
      reasonCode: 'UW_MANUAL_APPROVAL',
    }));
  });

  it('rejects manual approval when the fresh rate no longer refers', async () => {
    policyFindUnique.mockResolvedValue({
      id: 'pol_referred_now_quoted',
      status: 'REFERRAL',
      policyNumber: 'ABQ/CY1000842',
      programId: null,
      binderId: null,
      quoteData: {},
      policyHolder: null,
    });
    stateFindUnique.mockResolvedValue({ snapshot: { quoteData: {} } });
    buildQuoteResponseMock.mockResolvedValue({
      quoteResponse: { status: 'QUOTED', primaryOption: { annualPremium: 420 } },
      underwritingAnalysis: null,
    });

    const result = await ratePolicyAndPersist({
      policyId: 'pol_referred_now_quoted',
      productType: 'HOME',
      manualUwApproval: {
        approvedBy: { id: 'underwriter-1', name: 'Underwriter', email: 'uw@example.test', role: 'UNDERWRITER' },
      },
    });

    expect(result).toMatchObject({ ok: false, code: 'MANUAL_UW_APPROVAL_NOT_APPLICABLE' });
    expect(txPolicyUpdate).not.toHaveBeenCalled();
  });

  it('rejects a manual approval when the completed inception has no active authority', async () => {
    const quoteData = { policy: { startDate: '2026-09-10' } };
    policyFindUnique.mockResolvedValue({
      id: 'pol_home_authority_gap',
      status: 'REFERRAL',
      policyNumber: 'ABQ/CY1000838',
      programId: 'program-home',
      binderId: 'binder-home',
      quoteData,
      policyHolder: null,
    });
    stateFindUnique.mockResolvedValue({ snapshot: { quoteData } });
    resolvePolicyPeriodForProductMock.mockReturnValue({
      inceptionDate: new Date('2026-09-10T00:00:00.000Z'),
      expiryDate: new Date('2027-09-09T00:00:00.000Z'),
    });
    findLatestActiveBinderLinkForProductMock.mockResolvedValue(null);

    const result = await ratePolicyAndPersist({
      policyId: 'pol_home_authority_gap',
      productType: 'HOME',
      manualUwApproval: {
        approvedBy: { id: 'underwriter-1', name: 'Underwriter', email: 'uw@example.test', role: 'UNDERWRITER' },
      },
    });

    expect(result).toMatchObject({
      ok: false,
      status: 409,
      code: 'MANUAL_UW_APPROVAL_AUTHORITY_UNRESOLVED',
    });
    expect(buildQuoteResponseMock).not.toHaveBeenCalled();
    expect(txPolicyUpdate).not.toHaveBeenCalled();
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
      binderProductAuthority: { id: 'authority-motor-current' },
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
    expect(resolveMappedProgramDefinitionMock).toHaveBeenCalledWith({ programId: 'program-motor-current', binderProductAuthorityId: 'authority-motor-current' });
    expect(programFindUnique).not.toHaveBeenCalled();
    expect(resolveEffectiveCoverageContractMock).toHaveBeenCalledWith(expect.objectContaining({
      programId: 'program-motor-current',
    }));
    expect(buildQuoteResponseMock).toHaveBeenCalledWith(expect.objectContaining({
      programDefinition: expect.objectContaining({ id: 'definition-test' }),
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

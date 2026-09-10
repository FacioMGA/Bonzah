/**
 * ADR-0017 — `customerOutcome: 'failed'` terminal outcome contract.
 *
 * The bug this test pins (ABY-97 + 9 duplicates):
 *
 *   The wizard polled `/issue-readiness` after payment and waited for
 *   `customerOutcome === 'issued'`. When the doc-pack worker
 *   permanently failed (template missing, PDF render error, missing
 *   doc types), `customerOutcome` stayed `'pending'` forever and the
 *   wizard either timed out or — worse — silently bounced the user
 *   back to the payment step (ABY-98). This test asserts that
 *   `evaluateIssueReadiness`:
 *
 *     1. Returns `customerOutcome: 'failed'` when the latest
 *        `ISSUED_PACK_*` payment event is newer than the latest
 *        GENERATED `ISSUED_POLICY_PACK` document AND no docs are
 *        present.
 *     2. Emits a BLOCK-severity `DOCUMENTS_GENERATION_FAILED` blocker
 *        with the audit reason + timestamp, NOT the WARN-severity
 *        `DOCUMENTS_PENDING_GENERATION` we used to emit.
 *     3. Recovers automatically: when a later worker retry produces
 *        all required docs (i.e. a Document timestamp newer than the
 *        failure), the outcome flips back to `'pending'` (or
 *        `'issued'` once docs + inception are both present).
 *     4. Stays `'pending'` while the worker is still retrying (no
 *        failure event recorded yet).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fixtureProductKit, fixtureProgrammeDefinition } from '../../../../products/programDefinitionFixtures.js';

const findPolicyForIssueReadinessMock = vi.fn();
const findAuthorityWindowContextMock = vi.fn(async () => null);
const findBoundInceptionTransactionMock = vi.fn();
const findGeneratedIssuedDocumentsMock = vi.fn();
const findLatestPaidPaymentMock = vi.fn();
const findPaymentEventMock = vi.fn();
const findLatestPaymentFailureEventMock = vi.fn();
const findRiskTransactionContextMock = vi.fn();
const findLatestGeneratedIssuedDocumentTimestampMock = vi.fn();
const findLatestIssuedPackFailureEventMock = vi.fn();

vi.mock('../../app/read/issueReadinessRepository.js', () => ({
  findAuthorityWindowContext: (...a: unknown[]) =>
    findAuthorityWindowContextMock(...(a as [string, string | null])),
  findBoundInceptionTransaction: (...a: unknown[]) =>
    findBoundInceptionTransactionMock(...(a as [string])),
  findGeneratedIssuedDocuments: (...a: unknown[]) =>
    findGeneratedIssuedDocumentsMock(...(a as [string, string[]])),
  findLatestGeneratedIssuedDocumentTimestamp: (...a: unknown[]) =>
    findLatestGeneratedIssuedDocumentTimestampMock(...(a as [string])),
  findLatestIssuedPackFailureEvent: (...a: unknown[]) =>
    findLatestIssuedPackFailureEventMock(...(a as [string])),
  findLatestPaidPayment: (...a: unknown[]) =>
    findLatestPaidPaymentMock(...(a as [string])),
  findLatestPaymentFailureEvent: (...a: unknown[]) =>
    findLatestPaymentFailureEventMock(...(a as [string, string])),
  findPaymentEvent: (...a: unknown[]) =>
    findPaymentEventMock(...(a as [string, string])),
  findPolicyForIssueReadiness: (...a: unknown[]) =>
    findPolicyForIssueReadinessMock(...(a as [string])),
  findRiskTransactionContext: (...a: unknown[]) =>
    findRiskTransactionContextMock(...(a as [string, string])),
}));

const adapterMock = {
  productType: 'HOME',
  hasValidQuoteResponse: vi.fn(() => true),
  validateForIssuance: vi.fn(async () => ({
    valid: true,
    schemaIssues: [],
    missingSlugs: [],
    missingForQuotePack: [],
    missingForIssuedPack: [],
    conditionalRequirements: [],
  })),
  isUwComplete: vi.fn(() => true),
  getRequiredIssuedDocTypes: () => ['HOME_SCHEDULE_PDF', 'HOME_STATEMENT_OF_FACT_PDF'],
  getDocumentTypes: () => ({
    HOME_SCHEDULE_PDF: {},
    HOME_STATEMENT_OF_FACT_PDF: {},
  }),
  getQuoteReadyFieldKeys: () => [],
  getEndorsementCatalog: () => [{
    id: 'home-buildings',
    program_code: 'abbeygate_home',
    code: 'HOME-BUILDINGS',
  }],
  getEndorsementTemplate: () => null,
  getEndorsementGroups: () => [],
  getCustomerJourneyMeta: () => ({}),
  getRuntimeDefinition: () => ({ customerJourney: {} }),
  getManualUwApprovalCustomerCompletionPaths: () => [],
  buildQuoteResponse: vi.fn(async () => ({
    quoteResponse: { status: 'REFERRAL', primaryOption: { annualPremium: 100 } },
    underwritingAnalysis: { outcome: 'referral', lane: 'yellow', triggers: [] },
  })),
};

vi.mock('../ProductRegistry.js', () => ({
  ProductRegistry: {
    getInstance: () => ({
      getAdapter: () => adapterMock,
    }),
  },
}));

vi.mock('../pricingIntegrityStamp.js', () => ({
  computePricingIntegrityStamp: () => ({ snapshotHash: 'h1', pricingHash: 'h2' }),
}));

import { evaluateIssueReadiness } from '../../app/issueReadiness.js';

const PAID_AT = new Date('2026-05-10T10:00:00.000Z');
const POLICY_ID = '11111111-1111-1111-1111-111111111111';

function homePublishedDefinition() {
  return {
    id: 'definition-home',
    programId: 'program-home',
    version: 1,
    pricingMode: 'AUTOMATED',
    underwriting: {},
    coverage: { schemaVersion: 1, programCode: 'abbeygate_home', base: [], options: [] },
    questionnaire: {},
    workflow: {},
    channels: {},
    documents: {
      sources: fixtureProgrammeDefinition('HOME').documents.sources.filter((source) => ['HOME_SCHEDULE_PDF', 'HOME_STATEMENT_OF_FACT_PDF'].includes(source.documentType)),
      productKit: fixtureProductKit('abbeygate_home'),
      issuedPack: { requiredTypes: ['HOME_SCHEDULE_PDF', 'HOME_STATEMENT_OF_FACT_PDF'] },
    },
  };
}

function manualPublishedDefinition() {
  return {
    ...homePublishedDefinition(),
    id: 'definition-business-manual',
    programId: 'program-business-manual',
    pricingMode: 'MANUAL',
    coverage: { mode: 'MANUAL' },
  };
}

function basePolicy(overrides: Record<string, unknown> = {}) {
  return {
    id: POLICY_ID,
    productType: 'HOME',
    status: 'BOUND',
    inceptionDate: PAID_AT,
    expiryDate: new Date('2027-05-10T10:00:00.000Z'),
    isLocked: false,
    payments: [{ status: 'PAID', createdAt: PAID_AT }],
    quoteData: { proposer: { firstName: 'A', lastName: 'B' } },
    quoteResponse: {
      status: 'QUOTED',
      primaryOption: { annualPremium: 100 },
    },
    stateCurrent: {
      snapshot: {
        pricing: {
          snapshotHash: 'h1',
          pricingHash: 'h2',
          binderVersion: 'default',
        },
        uw: { completedAt: '2026-05-09T00:00:00.000Z', validationResult: { isValid: true } },
      },
    },
    ...overrides,
  };
}

describe('evaluateIssueReadiness — ADR-0017 customerOutcome: failed', () => {
  beforeEach(() => {
    findPolicyForIssueReadinessMock.mockReset();
    findBoundInceptionTransactionMock.mockReset();
    findGeneratedIssuedDocumentsMock.mockReset();
    findLatestPaidPaymentMock.mockReset();
    findPaymentEventMock.mockReset();
    findLatestPaymentFailureEventMock.mockReset();
    findLatestGeneratedIssuedDocumentTimestampMock.mockReset();
    findLatestIssuedPackFailureEventMock.mockReset();
    adapterMock.buildQuoteResponse.mockClear();

    findPolicyForIssueReadinessMock.mockResolvedValue(basePolicy());
    findBoundInceptionTransactionMock.mockResolvedValue({ id: 'rt-bound' });
    findGeneratedIssuedDocumentsMock.mockResolvedValue([]); // no docs yet
    findLatestPaidPaymentMock.mockResolvedValue({ id: 'pay-1', createdAt: PAID_AT });
    findPaymentEventMock.mockResolvedValue(null);
    findLatestPaymentFailureEventMock.mockResolvedValue(null);
    findLatestGeneratedIssuedDocumentTimestampMock.mockResolvedValue(null);
    findLatestIssuedPackFailureEventMock.mockResolvedValue(null);
    findAuthorityWindowContextMock.mockResolvedValue({
      policy: { id: POLICY_ID, inceptionDate: PAID_AT },
      binderAuthority: { id: 'authority-home' },
      programDefinition: homePublishedDefinition(),
    });
  });

  it('refuses binding a priced record without its retained definition and document authority', async () => {
    findPolicyForIssueReadinessMock.mockResolvedValue(basePolicy({ status: 'QUOTED', programId: 'program-home' }));
    findBoundInceptionTransactionMock.mockResolvedValue(null);
    const result = await evaluateIssueReadiness(POLICY_ID, 'bo');
    expect(result.canIssue).toBe(false);
    expect(result.blockers).toEqual(expect.arrayContaining([expect.objectContaining({ severity: 'BLOCK', message: expect.stringContaining('Re-rate before binding') })]));
  });

  it('returns customerOutcome: "failed" when failure event is newer than any generated doc', async () => {
    findLatestIssuedPackFailureEventMock.mockResolvedValue({
      eventType: 'ISSUED_PACK_GENERATION_FAILED',
      receivedAt: new Date('2026-05-10T10:05:00.000Z'),
      payload: { reason: 'puppeteer launch failed: chrome not found' },
    });

    const result = await evaluateIssueReadiness(POLICY_ID, 'customer');

    expect(result.customerOutcome).toBe('failed');
    const failedBlocker = result.blockers.find((b) => b.code === 'DOCUMENTS_GENERATION_FAILED');
    expect(failedBlocker).toBeDefined();
    expect(failedBlocker?.severity).toBe('BLOCK');
    expect(failedBlocker?.group).toBe('DOCUMENTS');
    expect(failedBlocker?.details?.failureEventType).toBe('ISSUED_PACK_GENERATION_FAILED');
    expect(failedBlocker?.details?.failureReason).toBe('puppeteer launch failed: chrome not found');
    // Critically: we do NOT also emit the WARN pending-generation
    // blocker (would confuse the UI into showing both a fatal error
    // and a "still working on it" message).
    expect(result.blockers.find((b) => b.code === 'DOCUMENTS_PENDING_GENERATION')).toBeUndefined();
  });

  it('does not require an automated coverage component for a manual programme', async () => {
    findAuthorityWindowContextMock.mockResolvedValue({
      policy: { id: POLICY_ID, inceptionDate: PAID_AT },
      binderAuthority: { id: 'authority-business-manual' },
      programDefinition: manualPublishedDefinition(),
    });

    const result = await evaluateIssueReadiness(POLICY_ID, 'customer');

    expect(result.blockers.some((blocker) =>
      blocker.message === 'No automated published coverage component is available for this policy.'
    )).toBe(false);
  });

  it('returns customerOutcome: "failed" when no docs have ever been generated and a failure exists', async () => {
    findLatestIssuedPackFailureEventMock.mockResolvedValue({
      eventType: 'ISSUED_PACK_MISSING_DOC_TYPES',
      receivedAt: new Date('2026-05-10T10:05:00.000Z'),
      payload: { reason: 'missing_required_doc_types: HOME_STATEMENT_OF_FACT_PDF' },
    });
    findLatestGeneratedIssuedDocumentTimestampMock.mockResolvedValue(null);

    const result = await evaluateIssueReadiness(POLICY_ID, 'customer');

    expect(result.customerOutcome).toBe('failed');
    expect(result.blockers.find((b) => b.code === 'DOCUMENTS_GENERATION_FAILED')?.details?.failureEventType)
      .toBe('ISSUED_PACK_MISSING_DOC_TYPES');
  });

  it('recovers to "pending" when a later worker retry produced docs newer than the failure', async () => {
    // Failure recorded at 10:05, but a later attempt produced a doc at
    // 10:07. The customer should NOT be stuck on `failed`.
    findLatestIssuedPackFailureEventMock.mockResolvedValue({
      eventType: 'ISSUED_PACK_GENERATION_FAILED',
      receivedAt: new Date('2026-05-10T10:05:00.000Z'),
      payload: { reason: 'transient' },
    });
    findLatestGeneratedIssuedDocumentTimestampMock.mockResolvedValue(
      new Date('2026-05-10T10:07:00.000Z'),
    );
    // Still missing the OTHER required doc type, so docs are not complete.
    findGeneratedIssuedDocumentsMock.mockResolvedValue([
      { type: 'HOME_SCHEDULE_PDF' },
    ]);

    const result = await evaluateIssueReadiness(POLICY_ID, 'customer');

    expect(result.customerOutcome).toBe('pending');
    // WARN-level pending generation blocker is fine here; failure is stale.
    expect(result.blockers.find((b) => b.code === 'DOCUMENTS_GENERATION_FAILED')).toBeUndefined();
    expect(result.blockers.find((b) => b.code === 'DOCUMENTS_PENDING_GENERATION')).toBeDefined();
  });

  it('returns "pending" while the worker is still retrying (no failure event recorded)', async () => {
    findLatestIssuedPackFailureEventMock.mockResolvedValue(null);

    const result = await evaluateIssueReadiness(POLICY_ID, 'customer');

    expect(result.customerOutcome).toBe('pending');
    expect(result.blockers.find((b) => b.code === 'DOCUMENTS_GENERATION_FAILED')).toBeUndefined();
    expect(result.blockers.find((b) => b.code === 'DOCUMENTS_PENDING_GENERATION')?.severity).toBe('WARN');
  });

  it('returns "issued" once all docs are present and inception is bound (failure event becomes irrelevant)', async () => {
    findLatestIssuedPackFailureEventMock.mockResolvedValue({
      eventType: 'ISSUED_PACK_GENERATION_FAILED',
      receivedAt: new Date('2026-05-10T10:05:00.000Z'),
      payload: { reason: 'old transient failure' },
    });
    findGeneratedIssuedDocumentsMock.mockResolvedValue([
      { type: 'HOME_SCHEDULE_PDF' },
      { type: 'HOME_STATEMENT_OF_FACT_PDF' },
    ]);
    findLatestGeneratedIssuedDocumentTimestampMock.mockResolvedValue(
      new Date('2026-05-10T10:07:00.000Z'),
    );

    const result = await evaluateIssueReadiness(POLICY_ID, 'customer');

    expect(result.customerOutcome).toBe('issued');
    expect(result.blockers.find((b) => b.code === 'DOCUMENTS_GENERATION_FAILED')).toBeUndefined();
  });

  it('does NOT query failure events when payment is not confirmed (no customer-facing failure surface pre-payment)', async () => {
    const noPaymentPolicy = basePolicy({ payments: [] });
    findPolicyForIssueReadinessMock.mockResolvedValue(noPaymentPolicy);
    findLatestPaidPaymentMock.mockResolvedValue(null);

    const result = await evaluateIssueReadiness(POLICY_ID, 'customer');

    expect(findLatestIssuedPackFailureEventMock).not.toHaveBeenCalled();
    expect(result.customerOutcome).toBe('pending');
  });

  it('does not apply an inception manual approval to a renewal draft', async () => {
    const policy = basePolicy({
      status: 'ISSUED',
      stateCurrent: {
        snapshot: {
          pricing: { snapshotHash: 'h1', pricingHash: 'h2', binderVersion: 'default' },
          uw: {
            completedAt: '2026-05-09T00:00:00.000Z',
            validationResult: { isValid: true },
            manualApproval: { approvedAt: '2026-05-09T00:00:00.000Z', approvedRiskHash: 'inception-only' },
          },
        },
      },
    });
    findPolicyForIssueReadinessMock.mockResolvedValue(policy);
    findRiskTransactionContextMock.mockResolvedValue({
      transactionType: 'RENEWAL',
      status: 'DRAFT',
      snapshotDraft: {
        quoteData: policy.quoteData,
        quoteResponse: policy.quoteResponse,
        pricing: { snapshotHash: 'h1', pricingHash: 'h2', binderVersion: 'default' },
      },
    });

    const result = await evaluateIssueReadiness(POLICY_ID, 'bo', { riskTransactionId: 'renewal-draft-1' });

    expect(result.blockers.some((blocker) => blocker.code === 'MANUAL_UW_APPROVAL_STALE')).toBe(false);
  });

  it('re-rates a stored approval using the mapped published definition and model', async () => {
    const policy = basePolicy({
      binderId: 'binder-1',
      programId: 'program-1',
      stateCurrent: {
        snapshot: {
          pricing: { snapshotHash: 'h1', pricingHash: 'h2', binderVersion: 'default' },
          uw: {
            completedAt: '2026-05-09T00:00:00.000Z',
            validationResult: { isValid: true },
            manualApproval: { approvedAt: '2026-05-09T00:00:00.000Z', approvedRiskHash: 'stale-on-purpose' },
          },
        },
      },
    });
    findPolicyForIssueReadinessMock.mockResolvedValue(policy);
    findAuthorityWindowContextMock.mockResolvedValue({
      policy: { id: POLICY_ID, inceptionDate: PAID_AT },
      binderAuthority: { id: 'authority-1' },
      programDefinition: {
        id: 'definition-1', programId: 'program-1', version: 2, pricingMode: 'AUTOMATED',
        underwriting: {},
        coverage: {
          schemaVersion: 1,
          programCode: 'abbeygate_home',
          base: [{ code: 'HOME-BUILDINGS', enabled: true, params: {} }],
          options: [],
        },
        questionnaire: {}, workflow: {}, channels: {},
        documents: homePublishedDefinition().documents,
        ratingModel: { id: 'model-1', programId: 'program-1', version: 3, tables: {} },
      },
    });

    await evaluateIssueReadiness(POLICY_ID, 'bo');

    expect(adapterMock.buildQuoteResponse).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        programDefinition: expect.objectContaining({
          id: 'definition-1', version: 2, binderProductAuthorityId: 'authority-1',
        }),
        ratingModel: expect.objectContaining({
          id: 'model-1', version: 3, binderProductAuthorityId: 'authority-1',
        }),
      }),
    );
  });
});

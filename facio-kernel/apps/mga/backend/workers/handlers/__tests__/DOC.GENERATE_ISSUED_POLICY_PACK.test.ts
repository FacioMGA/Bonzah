import { describe, expect, it, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────
// Tenant ALS and Prisma are stubbed because the handler reads policy/product
// metadata to pick an adapter. The test focuses on the spine contract: the
// handler must read from envelope.data.* and reject any payload shape that
// is not a canonical DomainEventEnvelope. No fallback flat-payload path is
// permitted (ADR-0013).

const policyFindUniqueMock = vi.fn();
const transactionMock = vi.fn();
const advisoryLockMock = vi.fn(async () => 1);
vi.mock('../../../platform/db/connection.js', () => ({
  tenantScopedPrisma: {
    policy: { findUnique: policyFindUniqueMock },
  },
  runTenantScopedTransaction: transactionMock,
}));

const generateDocPackMock = vi.fn();
const REQUIRED_DOC_TYPES: Record<string, string[]> = {
  MOTOR: ['MOTOR_CERTIFICATE_PDF'],
  HOME: [
    'HOME_SCHEDULE_PDF',
    'HOME_STATEMENT_OF_FACT_PDF',
    'HOME_IPID_PDF',
    'HOME_POLICY_WORDING_PDF',
    'HOME_EUROP_ASSISTANCE_PDF',
  ],
  TRAVEL: [
    'TRAVEL_CERTIFICATE_PDF',
    'TRAVEL_SCHEDULE_PDF',
    'TRAVEL_IPID_PDF',
    'TRAVEL_POLICY_WORDING_PDF',
    'TRAVEL_MEDICAL_CARD_PDF',
  ],
};
const getRequiredIssuedDocTypesMock = vi.fn((productType: string) => REQUIRED_DOC_TYPES[productType] || []);
const resolveImmutablePolicyDocumentConfigurationMock = vi.fn(async () => ({
  requiredIssuedDocTypes: REQUIRED_DOC_TYPES.MOTOR,
  documentSources: [],
}));
vi.mock('../../../modules/policy/domain/ProductRegistry.js', () => ({
  ProductRegistry: {
    getInstance: () => ({
      getAdapter: (productType: string) =>
        REQUIRED_DOC_TYPES[productType]
          ? {
              generateDocPack: generateDocPackMock,
              getRequiredIssuedDocTypes: () => getRequiredIssuedDocTypesMock(productType),
            }
          : null,
    }),
  },
}));

vi.mock('../../../modules/policy/app/productRegistryService.js', () => ({
  resolveImmutablePolicyDocumentConfiguration: (...args: unknown[]) =>
    resolveImmutablePolicyDocumentConfigurationMock(...args),
}));

const missingIssuedDocTypesMock = vi.fn(() => [] as string[]);
const maybeSendWelcomeEmailForIssuedPackMock = vi.fn(async () => true);
const promoteIssuedLifecycleMock = vi.fn(async () => undefined);
const recordIssuedPackFailurePaymentEventMock = vi.fn(async () => undefined);

vi.mock('../../../platform/events/queue.js', () => ({
  missingIssuedDocTypes: (...args: unknown[]) => missingIssuedDocTypesMock(...(args as [unknown, unknown])),
  maybeSendWelcomeEmailForIssuedPack: (...args: unknown[]) =>
    maybeSendWelcomeEmailForIssuedPackMock(...(args as [unknown])),
  promoteIssuedLifecycle: (...args: unknown[]) => promoteIssuedLifecycleMock(...(args as [unknown])),
  recordIssuedPackFailurePaymentEvent: (...args: unknown[]) =>
    recordIssuedPackFailurePaymentEventMock(...(args as [unknown])),
}));

const setIssueReadinessMock = vi.fn(async () => undefined);
vi.mock('../../../modules/policy/app/setIssueReadiness.js', () => ({
  setIssueReadiness: (...args: unknown[]) => setIssueReadinessMock(...(args as [string, unknown])),
}));

vi.mock('../../../platform/tenant/tenantJobContext.js', () => ({
  runWithPolicyOperatingTenant: (_policyId: string, fn: () => Promise<unknown>) => fn(),
}));

vi.mock('../../../platform/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// We import the pure body (`runIssuedPackJob`) directly: the handler's
// canonical contract is "envelope in → side effects out". Wrapping it
// in a fake BullMQ `Job` adds nothing the spine cares about and would
// force a forbidden type-coercion at the seam (the type-safety
// ratchet rejects unknown→Job coercions). The `JobHandler` shim is
// one line, exercised by the handler-registration smoke check
// elsewhere.
const { runIssuedPackJob } = await import('../DOC.GENERATE_ISSUED_POLICY_PACK.js');

describe('DOC.GENERATE_ISSUED_POLICY_PACK handler (ADR-0013 canonical envelope)', () => {
  beforeEach(() => {
    policyFindUniqueMock.mockReset();
    transactionMock.mockReset();
    advisoryLockMock.mockReset();
    advisoryLockMock.mockResolvedValue(1);
    transactionMock.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => (
      fn({ $executeRaw: advisoryLockMock })
    ));
    generateDocPackMock.mockReset();
    getRequiredIssuedDocTypesMock.mockClear();
    resolveImmutablePolicyDocumentConfigurationMock.mockClear();
    missingIssuedDocTypesMock.mockReset();
    missingIssuedDocTypesMock.mockReturnValue([]);
    maybeSendWelcomeEmailForIssuedPackMock.mockReset();
    maybeSendWelcomeEmailForIssuedPackMock.mockResolvedValue(true);
    promoteIssuedLifecycleMock.mockReset();
    promoteIssuedLifecycleMock.mockResolvedValue(undefined);
    recordIssuedPackFailurePaymentEventMock.mockReset();
    recordIssuedPackFailurePaymentEventMock.mockResolvedValue(undefined);
    setIssueReadinessMock.mockReset();
    setIssueReadinessMock.mockResolvedValue(undefined);

    policyFindUniqueMock.mockResolvedValue({ productType: 'MOTOR' });
    resolveImmutablePolicyDocumentConfigurationMock.mockResolvedValue({
      requiredIssuedDocTypes: REQUIRED_DOC_TYPES.MOTOR,
      documentSources: [],
    });
    generateDocPackMock.mockResolvedValue({ documents: [{ type: 'MOTOR_CERTIFICATE_PDF' }] });
  });

  it('document-only recovery generates the retained pack without email or lifecycle side effects', async () => {
    await runIssuedPackJob({ data: { policyId: 'policy-a', riskTransactionId: 'original-risk', source: 'BO', documentsOnly: true } });
    expect(resolveImmutablePolicyDocumentConfigurationMock).toHaveBeenCalledWith({ policyId: 'policy-a', riskTransactionId: 'original-risk' });
    expect(generateDocPackMock).toHaveBeenCalledWith(expect.objectContaining({ riskTransactionId: 'original-risk', docPack: 'ISSUED_POLICY_PACK' }));
    expect(maybeSendWelcomeEmailForIssuedPackMock).not.toHaveBeenCalled();
    expect(promoteIssuedLifecycleMock).not.toHaveBeenCalled();
  });

  it.each([
    ['MOTOR', 'MOTOR_CERTIFICATE_PDF'],
    ['HOME', 'HOME_SCHEDULE_PDF'],
    ['TRAVEL', 'TRAVEL_CERTIFICATE_PDF'],
  ])('dispatches issued-pack generation through the %s product adapter', async (productType, firstDocType) => {
    policyFindUniqueMock.mockResolvedValueOnce({ productType });
    resolveImmutablePolicyDocumentConfigurationMock.mockResolvedValueOnce({
      requiredIssuedDocTypes: REQUIRED_DOC_TYPES[productType],
      documentSources: [],
    });
    generateDocPackMock.mockResolvedValueOnce({ documents: [{ type: firstDocType }] });
    const envelope = {
      eventType: 'DOC.GENERATE_ISSUED_POLICY_PACK',
      data: {
        policyId: `policy-${productType.toLowerCase()}`,
        riskTransactionId: `rt-${productType.toLowerCase()}`,
        source: 'SYSTEM',
        generatedByUserId: null,
      },
    };

    await runIssuedPackJob(envelope);

    expect(generateDocPackMock).toHaveBeenCalledWith(
      expect.objectContaining({
        policyId: `policy-${productType.toLowerCase()}`,
        riskTransactionId: `rt-${productType.toLowerCase()}`,
        docPack: 'ISSUED_POLICY_PACK',
      }),
    );
    expect(missingIssuedDocTypesMock).toHaveBeenCalledWith(
      { documents: [{ type: firstDocType }] },
      REQUIRED_DOC_TYPES[productType],
    );
    expect(advisoryLockMock).toHaveBeenCalledTimes(1);
  });

  it('reads policyId / riskTransactionId from envelope.data.* (canonical shape)', async () => {
    const envelope = {
      eventType: 'DOC.GENERATE_ISSUED_POLICY_PACK',
      data: {
        policyId: 'policy-1',
        riskTransactionId: 'rt-1',
        source: 'SYSTEM',
        generatedByUserId: null,
      },
    };
    await runIssuedPackJob(envelope);
    expect(generateDocPackMock).toHaveBeenCalledWith(
      expect.objectContaining({
        policyId: 'policy-1',
        riskTransactionId: 'rt-1',
        docPack: 'ISSUED_POLICY_PACK',
        source: 'SYSTEM',
      }),
    );
  });

  it('rejects flat payloads — only the canonical envelope is accepted', async () => {
    const flatPayload = {
      policyId: 'policy-1',
      riskTransactionId: 'rt-1',
      source: 'SYSTEM',
      generatedByUserId: null,
    };
    await expect(runIssuedPackJob(flatPayload)).rejects.toThrow(
      /payload is not a canonical DomainEventEnvelope/,
    );
    expect(generateDocPackMock).not.toHaveBeenCalled();
  });

  it('rejects empty job.data', async () => {
    await expect(runIssuedPackJob(null)).rejects.toThrow(
      /job.data is missing/,
    );
  });

  it('records a paymentEvent and re-throws when required doc types are missing', async () => {
    missingIssuedDocTypesMock.mockReturnValue(['MOTOR_CERTIFICATE_PDF']);
    const envelope = {
      eventType: 'DOC.GENERATE_ISSUED_POLICY_PACK',
      data: { policyId: 'policy-9', riskTransactionId: 'rt-9', source: 'SYSTEM' },
    };
    await expect(runIssuedPackJob(envelope)).rejects.toThrow(
      /missing required documents/,
    );
    expect(recordIssuedPackFailurePaymentEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        policyId: 'policy-9',
        eventType: 'ISSUED_PACK_MISSING_DOC_TYPES',
        riskTransactionId: 'rt-9',
        missingDocTypes: ['MOTOR_CERTIFICATE_PDF'],
      }),
    );
    // ADR-0017 — projection mirror so cheap polling sees `failed` immediately.
    expect(setIssueReadinessMock).toHaveBeenCalledWith('policy-9', { failureCode: 'MISSING_DOC_TYPES' });
    // BullMQ retry semantics handle the retry — no inline retry here.
    expect(maybeSendWelcomeEmailForIssuedPackMock).not.toHaveBeenCalled();
    expect(promoteIssuedLifecycleMock).not.toHaveBeenCalled();
  });

  // ADR-0017 — runtime failures inside `adapter.generateDocPack` (template
  // missing, PDF render error, storage upload failure) used to surface
  // only as opaque BullMQ retries with no operator audit + no terminal
  // signal for `evaluateIssueReadiness`. The handler now records a
  // structured `ISSUED_PACK_GENERATION_FAILED` event AND mirrors the
  // failure into the readiness projection BEFORE re-throwing for backoff,
  // so the wizard's `pending_issuance` polling resolves to a terminal
  // `customerOutcome: 'failed'` instead of looping forever.
  it('records ISSUED_PACK_GENERATION_FAILED + projection mirror when the adapter throws', async () => {
    const renderError = new Error('puppeteer launch failed: chrome not found');
    generateDocPackMock.mockRejectedValueOnce(renderError);
    const envelope = {
      eventType: 'DOC.GENERATE_ISSUED_POLICY_PACK',
      data: { policyId: 'policy-runtime-fail', riskTransactionId: 'rt-rf', source: 'SYSTEM' },
    };

    await expect(runIssuedPackJob(envelope)).rejects.toThrow(/puppeteer launch failed/);

    expect(recordIssuedPackFailurePaymentEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        policyId: 'policy-runtime-fail',
        eventType: 'ISSUED_PACK_GENERATION_FAILED',
        reason: 'puppeteer launch failed: chrome not found',
        riskTransactionId: 'rt-rf',
      }),
    );
    expect(setIssueReadinessMock).toHaveBeenCalledWith('policy-runtime-fail', {
      failureCode: 'GENERATION_FAILED',
    });
    // We never reached the missing-types check or the welcome email.
    expect(missingIssuedDocTypesMock).not.toHaveBeenCalled();
    expect(maybeSendWelcomeEmailForIssuedPackMock).not.toHaveBeenCalled();
    expect(promoteIssuedLifecycleMock).not.toHaveBeenCalled();
  });

  it('promotes lifecycle and triggers welcome email after a successful generation', async () => {
    const envelope = {
      eventType: 'DOC.GENERATE_ISSUED_POLICY_PACK',
      correlationId: 'corr-10',
      data: { policyId: 'policy-10', riskTransactionId: 'rt-10', source: 'SYSTEM' },
    };
    await runIssuedPackJob(envelope);
    // The top-level envelope correlationId must flow through to the welcome
    // orchestrator so the staff sale notification carries the real request id
    // (distinct from riskTransactionId).
    expect(maybeSendWelcomeEmailForIssuedPackMock).toHaveBeenCalledWith({
      policyId: 'policy-10',
      riskTransactionId: 'rt-10',
      requiredIssuedDocTypes: ['MOTOR_CERTIFICATE_PDF'],
      source: 'SYSTEM',
      correlationId: 'corr-10',
    });
    expect(promoteIssuedLifecycleMock).toHaveBeenCalledWith({
      policyId: 'policy-10',
      riskTransactionId: 'rt-10',
    });
  });

  // ADR-0067 follow-up (synthetic email safety): the issued-pack worker must
  // forward the issuance `source` to the welcome orchestrator so a synthetic
  // health-canary run (`ISSUANCE_PROOF`) can suppress the internal staff copy.
  // Without this thread-through the canary emailed a fake "policy issued" to
  // the staff mailbox every few minutes.
  it('forwards source=ISSUANCE_PROOF to the welcome orchestrator (synthetic suppression wiring)', async () => {
    const envelope = {
      eventType: 'DOC.GENERATE_ISSUED_POLICY_PACK',
      data: { policyId: 'policy-proof', riskTransactionId: 'rt-proof', source: 'ISSUANCE_PROOF' },
    };
    await runIssuedPackJob(envelope);
    expect(maybeSendWelcomeEmailForIssuedPackMock).toHaveBeenCalledWith({
      policyId: 'policy-proof',
      riskTransactionId: 'rt-proof',
      requiredIssuedDocTypes: ['MOTOR_CERTIFICATE_PDF'],
      source: 'ISSUANCE_PROOF',
      correlationId: null,
    });
  });

  it('retries instead of promoting lifecycle when welcome email dispatch fails', async () => {
    maybeSendWelcomeEmailForIssuedPackMock.mockRejectedValueOnce(
      new Error('ISSUANCE_PROOF_WELCOME_TO is required for issuance-proof welcome email dispatch'),
    );
    const envelope = {
      eventType: 'DOC.GENERATE_ISSUED_POLICY_PACK',
      data: { policyId: 'policy-welcome-fail', riskTransactionId: 'rt-wf', source: 'SYSTEM' },
    };

    await expect(runIssuedPackJob(envelope)).rejects.toThrow(
      /welcome email was not queued: ISSUANCE_PROOF_WELCOME_TO is required/,
    );

    expect(maybeSendWelcomeEmailForIssuedPackMock).toHaveBeenCalledWith({
      policyId: 'policy-welcome-fail',
      riskTransactionId: 'rt-wf',
      requiredIssuedDocTypes: ['MOTOR_CERTIFICATE_PDF'],
      source: 'SYSTEM',
      correlationId: null,
    });
    expect(promoteIssuedLifecycleMock).not.toHaveBeenCalled();
  });
});

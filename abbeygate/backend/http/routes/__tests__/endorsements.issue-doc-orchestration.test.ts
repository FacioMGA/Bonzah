import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerPolicyEndorsementRoutes } from '../../../modules/policy/http/endorsementsRouter.js';
import { prisma, tenantScopedPrisma } from '../../../platform/db/connection.js';
import { DocumentService } from '../../../modules/documents/app/documentService.js';
import { evaluateEndorsementDocumentActions } from '../../../modules/documents/app/endorsementDocumentRules.js';
import { sendEndorsementIssueEmailWithAttachments } from '../../../platform/events/queue.js';

vi.mock('../../../platform/db/connection.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../platform/db/connection.js')>();
  const mockPrisma = {
    ...actual.prisma,
    riskTransaction: { findFirst: vi.fn(), update: vi.fn() },
    document: { findMany: vi.fn() },
    policy: { findUnique: vi.fn(), update: vi.fn() },
    policyStateCurrent: { upsert: vi.fn() },
    premiumTransaction: { create: vi.fn() },
    $transaction: vi.fn(),
  };
  return {
    ...actual,
    prisma: mockPrisma,
    tenantScopedPrisma: {
      ...actual.tenantScopedPrisma,
      $transaction: mockPrisma.$transaction,
      riskTransaction: mockPrisma.riskTransaction,
      policy: mockPrisma.policy,
      policyStateCurrent: mockPrisma.policyStateCurrent,
      premiumTransaction: mockPrisma.premiumTransaction,
      document: mockPrisma.document,
    },
  };
});

vi.mock('../../../modules/policy/infra/projections/policyListIndex.js', () => ({
  enqueuePolicyListIndexUpdate: vi.fn(async () => undefined),
}));

vi.mock('../../../modules/documents/app/documentService.js', () => ({
  DocumentService: { generate: vi.fn() },
}));

vi.mock('../../../modules/documents/app/endorsementDocumentRules.js', () => ({
  evaluateEndorsementDocumentActions: vi.fn(),
}));

// ADR-0013 — `routeEventToQueue` is no longer the spine for issued-pack
// regeneration; the canonical helper writes an outbox row inside the
// issuance transaction. We mock the helper directly to assert the
// spine fires (or doesn't) on the expected paths.
vi.mock('../../../platform/events/queue.js', () => ({
  sendEndorsementIssueEmailWithAttachments: vi.fn(async () => ({
    sent: true,
    missingTypes: [],
    fallbackTypes: [],
    attachmentTypes: ['MOTOR_ENDORSEMENT_SCHEDULE_PDF'],
  })),
}));

const enqueueIssuedPolicyPackMock = vi.fn(async () => ({ eventId: 'evt-issued-pack-1' }));
vi.mock('../../../modules/policy/app/commands/issuedPackEnqueue.js', () => ({
  enqueueIssuedPolicyPack: (...args: unknown[]) => enqueueIssuedPolicyPackMock(...args),
}));

vi.mock('../../../platform/audit/logger.js', () => ({
  AuditLogger: { log: vi.fn() },
}));

function mockRes() {
  const res: { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> } = {
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

function buildRouter() {
  const routes: Record<string, unknown> = {};
  return {
    routes,
    get: vi.fn(),
    patch: vi.fn(),
    post: vi.fn((path: string, ...handlers: unknown[]) => {
      routes[`POST ${path}`] = handlers[handlers.length - 1];
    }),
  };
}

describe('endorsement issue doc orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(DocumentService.generate).mockResolvedValue({
      version: 1,
      documents: [],
    });
    vi.mocked(tenantScopedPrisma.policy.findUnique).mockImplementation(async () => ({
      id: 'policy-1',
      quoteData: {},
    }));
    vi.mocked(tenantScopedPrisma.policy.update).mockResolvedValue(null as never);
    vi.mocked(tenantScopedPrisma.policyStateCurrent.upsert).mockResolvedValue(null as never);
    vi.mocked(prisma.premiumTransaction.create).mockResolvedValue(null as never);
    vi.mocked(tenantScopedPrisma.riskTransaction.update).mockResolvedValue(null as never);
    vi.mocked(tenantScopedPrisma.document.findMany).mockResolvedValue([
      { type: 'MOTOR_CERTIFICATE_PDF' },
      { type: 'MOTOR_GREEN_CARD_PDF' },
      { type: 'MOTOR_SCHEDULE_PDF' },
      { type: 'MOTOR_STATEMENT_OF_FACT_PDF' },
    ] as never);
    vi.mocked(tenantScopedPrisma.riskTransaction.findFirst).mockImplementation(async (args: unknown) => {
      const where = (args as { where?: Record<string, unknown> })?.where || {};
      if (where.id) {
        return {
          id: 'rt-1',
          policyId: 'policy-1',
          transactionType: 'ENDORSEMENT',
          status: 'BOUND',
          transactionNumber: 3,
          snapshotDraft: { endorsementWorkspace: { reasonCode: 'CHANGE' } },
          snapshotFinal: { quoteData: {} },
          pricingFinal: { premium: 120 },
          effectiveDate: new Date('2026-02-01'),
          changeReason: 'CHANGE',
        };
      }
      return {
        id: 'rt-0',
        transactionNumber: 2,
        snapshotFinal: { quoteData: {} },
        pricingFinal: { premium: 100 },
      };
    });
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: (tx: typeof prisma) => unknown) => cb(prisma));
  });

  it('material endorsement: generates ENDORSEMENT_PACK inline + enqueues ISSUED_POLICY_PACK via the spine; email is deferred (ASYNC_DOCS_PENDING)', async () => {
    vi.mocked(evaluateEndorsementDocumentActions).mockReturnValue({
      alwaysGenerateDelta: true,
      requiresEvidencePack: true,
      reasons: ['certificate_fields_changed'],
      flags: {
        certificateChanged: true,
        scheduleChanged: false,
        greenCardChanged: false,
        sofChanged: false,
        materialCoverChanged: false,
      },
      changedFields: ['expiryDate'],
      unknownCriticalDiff: false,
    });

    const router = buildRouter();
    registerPolicyEndorsementRoutes(router as never);
    const handler = router.routes['POST /:id/endorsements/:riskTransactionId/issue'] as (req: unknown, res: unknown) => Promise<void>;
    const req = {
      params: { id: 'policy-1', riskTransactionId: 'rt-1' },
      body: {},
      user: { id: 'uw-1', name: 'UW' },
      correlationId: 'corr-1',
    };
    const res = mockRes();
    await handler(req, res);

    // ENDORSEMENT_PACK is generated synchronously (delta doc, not lifecycle-bound).
    expect(DocumentService.generate).toHaveBeenCalledWith(expect.objectContaining({ docPack: 'ENDORSEMENT_PACK' }));
    // ADR-0013 — ISSUED_POLICY_PACK is NOT generated inline. The spine
    // owns the regeneration. There must be no `DocumentService.generate`
    // call with `docPack: 'ISSUED_POLICY_PACK'` from this path.
    const inlineIssuedPackCalls = vi.mocked(DocumentService.generate).mock.calls.filter(
      (c) => String((c[0] as { docPack?: string }).docPack || '') === 'ISSUED_POLICY_PACK',
    );
    expect(inlineIssuedPackCalls).toHaveLength(0);
    expect(enqueueIssuedPolicyPackMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        policyId: 'policy-1',
        riskTransactionId: 'rt-1',
        source: 'BO',
        idempotencyKey: 'issued-pack:policy-1:rt-1',
      }),
    );
    // Inline endorsement email is deferred — the spine handler is the
    // canonical follow-up sender once the issued pack regen completes.
    expect(sendEndorsementIssueEmailWithAttachments).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('delta-only endorsement: generates ENDORSEMENT_PACK inline, does NOT enqueue spine, sends endorsement email inline', async () => {
    vi.mocked(evaluateEndorsementDocumentActions).mockReturnValue({
      alwaysGenerateDelta: true,
      requiresEvidencePack: false,
      reasons: [],
      flags: {
        certificateChanged: false,
        scheduleChanged: false,
        greenCardChanged: false,
        sofChanged: false,
        materialCoverChanged: false,
      },
      changedFields: [],
      unknownCriticalDiff: false,
    });

    const router = buildRouter();
    registerPolicyEndorsementRoutes(router as never);
    const handler = router.routes['POST /:id/endorsements/:riskTransactionId/issue'] as (req: unknown, res: unknown) => Promise<void>;
    const req = {
      params: { id: 'policy-1', riskTransactionId: 'rt-1' },
      body: {},
      user: { id: 'uw-1', name: 'UW' },
      correlationId: 'corr-2',
    };
    const res = mockRes();
    await handler(req, res);

    const packs = vi.mocked(DocumentService.generate).mock.calls.map((c) => String((c[0] as { docPack?: string }).docPack || ''));
    expect(packs.filter((p) => p === 'ISSUED_POLICY_PACK')).toHaveLength(0);
    expect(enqueueIssuedPolicyPackMock).not.toHaveBeenCalled();
    expect(sendEndorsementIssueEmailWithAttachments).toHaveBeenCalledWith(expect.objectContaining({
      includeEvidencePack: false,
    }));
  });
});

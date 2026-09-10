import { beforeEach, describe, expect, it, vi } from 'vitest';

const executeIssuePolicyMock = vi.fn();
const retryIssuedDocumentsMock = vi.fn();
const captured: Record<string, (req: unknown, res: unknown) => Promise<unknown>> = {};

vi.mock('../../../modules/policy/app/IssuePolicy.js', () => ({
  executeIssuePolicy: (...args: unknown[]) => executeIssuePolicyMock(...args),
}));
vi.mock('../../../modules/policy/app/retryIssuedPolicyDocuments.js', async (original) => ({
  ...await original<typeof import('../../../modules/policy/app/retryIssuedPolicyDocuments.js')>(),
  retryIssuedPolicyDocuments: (...args: unknown[]) => retryIssuedDocumentsMock(...args),
}));

vi.mock('../../../platform/db/connection.js', () => ({
  prisma: {},
}));

vi.mock('../../middleware/audit.js', () => ({
  auditLog: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../../../platform/audit/logger.js', () => ({
  AuditLogger: { log: vi.fn() },
}));

vi.mock('../../../platform/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../platform/utils/platformIds.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../platform/utils/platformIds.js')>()),
  reserveNextCertificateNumber: vi.fn(),
  reserveNextPolicyId: vi.fn(),
}));
vi.mock('../../../modules/documents/app/documentService.js', () => ({ DocumentService: { generate: vi.fn() } }));
vi.mock('../../../platform/events/queue.js', () => ({ routeEventToQueue: vi.fn() }));
vi.mock('../../../modules/policy/domain/issueReadiness.js', () => ({ evaluateIssueReadiness: vi.fn() }));
vi.mock('../../../modules/policy/domain/issueReadinessUpdater.js', () => ({ setIssueReadiness: vi.fn() }));
vi.mock('../../../modules/policy/infra/projections/policyListIndex.js', () => ({ enqueuePolicyListIndexUpdate: vi.fn() }));
vi.mock('../../../modules/quotes/app/validator.js', () => ({ validateDraftQuote: vi.fn() }));
vi.mock('../../../platform/types/autoInsurance.js', () => ({}));
vi.mock('../../../modules/policy/app/commands/policyLifecycleCommands.js', () => ({ transitionPolicyLifecycle: vi.fn() }));
vi.mock('../../../modules/policy/app/commands/riskPaymentDocCommands.js', () => ({ transitionRiskTransactionStatus: vi.fn() }));
vi.mock('../../../modules/policy/app/BindCoverage.js', () => ({ executeBindCoverage: vi.fn() }));
vi.mock('../../../modules/policy/app/BindPolicy.js', () => ({ executeBindPolicy: vi.fn() }));
vi.mock('../../../modules/policy/app/CreateFromQuote.js', () => ({ executeCreateFromQuote: vi.fn() }));
vi.mock('../../../modules/policy/app/shared.js', () => ({
  jsonParse: vi.fn((x: unknown) => x),
  jsonStringify: vi.fn((x: unknown) => JSON.stringify(x)),
  isIssuedLifecycleStatus: vi.fn(),
  newPublicSessionToken: vi.fn(),
}));
vi.mock('../../../platform/utils/mappingHelpers.js', () => ({
  parseRecord: vi.fn((x: unknown) => (x && typeof x === 'object' ? x : {})),
  parseSnapshot: vi.fn((x: unknown) => (x && typeof x === 'object' ? x : {})),
  quoteCurrency: vi.fn(),
  quotePrimaryAnnualPremium: vi.fn(),
  resolveInceptionDateFromRenewalDate: vi.fn(),
  normalizeOverrideExcess: vi.fn(),
  getMethod: vi.fn(),
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

describe('IssuePolicy route spine', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    Object.keys(captured).forEach((k) => delete captured[k]);
    const { registerPolicyBindingRoutes } = await import('../../../modules/policy/http/bindingRouter.js');
    const router = {
      get: vi.fn(),
      post: vi.fn((path: string, ...handlers: unknown[]) => {
        captured[`POST ${path}`] = handlers[handlers.length - 1] as (req: unknown, res: unknown) => Promise<unknown>;
      }),
    };
    registerPolicyBindingRoutes(router as Parameters<typeof registerPolicyBindingRoutes>[0]);
  });

  it('maps IssuePolicy INVALID_STATUS to stable 400 error contract', async () => {
    const handler = captured['POST /:id/issue-policy'];
    expect(handler).toBeTruthy();
    executeIssuePolicyMock.mockResolvedValueOnce({
      status: 'INVALID_STATUS',
      error: { code: 'INVALID_STATUS', message: 'Cannot issue from QUOTED' },
    });
    const req = {
      params: { id: 'pol-1' },
      user: { id: 'u1', name: 'Tester', email: 't@example.com', role: 'UNDERWRITER' },
      correlationId: 'corr-1',
      protocol: 'https',
      headers: {},
      get: vi.fn(() => 'example.test'),
    };
    const res = mockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: 'INVALID_STATUS' }),
      }),
    );
  });

  it('returns accepted recovery evidence using only the trusted request identity', async () => {
    const data = { status: 'queued', eventId: 'event-a', riskTransactionId: 'bound-risk-a', replayed: true };
    retryIssuedDocumentsMock.mockResolvedValue(data);
    const res = mockRes();
    await captured['POST /:id/documents/retry-issued-pack']({
      params: { id: '2d2eb643-7466-4698-9aa1-800b390d1e97' }, body: {},
      user: { id: 'operator-a', role: 'ADMIN' }, correlationId: 'correlation-a',
      resolvedPermissions: [{ key: 'policies.view' }, { key: 'documents.generate' }],
    }, res);
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith({ success: true, data });
    expect(retryIssuedDocumentsMock).toHaveBeenCalledWith({ policyId: '2d2eb643-7466-4698-9aa1-800b390d1e97' }, {
      id: 'operator-a', role: 'ADMIN', permissions: ['policies.view', 'documents.generate'], correlationId: 'correlation-a',
    });
  });

  it('rejects caller-supplied actor, risk snapshot or side-effect options before the command', async () => {
    const res = mockRes();
    await captured['POST /:id/documents/retry-issued-pack']({ params: { id: '2d2eb643-7466-4698-9aa1-800b390d1e97' }, body: { generatedByUserId: 'other-user', documentsOnly: false, riskTransactionId: 'other-risk' } }, res);
    expect(res.status).toHaveBeenCalledWith(400); expect(retryIssuedDocumentsMock).not.toHaveBeenCalled();
  });
});

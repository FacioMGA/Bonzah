import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withoutOperatingTenantForTest } from '../../../platform/tenant/tenantAls.js';

// ADR-0019: vitest setup installs a default CY tenant ALS for the test
// worker. This route test asserts the URL fallback to the request host
// (`app.example.com`), which only fires when no ALS tenant is bound —
// so we wrap the bodies in withoutOperatingTenantForTest.
const itNoTenant = (name: string, fn: () => void | Promise<void>) =>
  it(name, () => withoutOperatingTenantForTest(fn));

const captured: Record<string, (req: unknown, res: unknown) => Promise<unknown>> = {};
const dispatchQuoteEmailMock = vi.fn();
const transitionPolicyLifecycleMock = vi.fn();
const enqueuePolicyListIndexUpdateMock = vi.fn();
const auditLogMock = vi.fn();
const loggerInfoMock = vi.fn();
const loggerWarnMock = vi.fn();
const loggerErrorMock = vi.fn();

vi.mock('../../../platform/db/connection.js', () => {
  const mockPrisma = {
    policy: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(mockPrisma)),
  };
  return {
    prisma: mockPrisma,
    tenantScopedPrisma: mockPrisma,
  };
});

vi.mock('../../../platform/audit/logger.js', () => ({
  AuditLogger: { log: auditLogMock },
}));

vi.mock('../../../platform/utils/logger.js', () => ({
  logger: { info: loggerInfoMock, warn: loggerWarnMock, error: loggerErrorMock },
}));

vi.mock('../../../modules/documents/app/documentService.js', () => ({
  DocumentService: {
    generate: vi.fn(async () => ({
      documents: [
        {
          type: 'MOTOR_QUOTE_PDF',
          filename: 'quote.pdf',
          storageUri: '',
        },
      ],
    })),
  },
}));

vi.mock('../../../modules/policy/app/communicationsInterop.js', () => ({
  dispatchQuoteEmail: dispatchQuoteEmailMock,
}));

vi.mock('../../../modules/policy/app/commands/policyLifecycleCommands.js', () => ({
  transitionPolicyLifecycle: transitionPolicyLifecycleMock,
}));

vi.mock('../../../modules/policy/app/policyListIndex.js', () => ({
  enqueuePolicyListIndexUpdate: enqueuePolicyListIndexUpdateMock,
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

function quoteSendRequest() {
  return {
    params: { id: 'policy-1' },
    user: { id: 'user-1', name: 'Ops User', role: 'UNDERWRITER' },
    headers: {},
    correlationId: 'corr-1',
    protocol: 'https',
    get: vi.fn((name: string) => (name.toLowerCase() === 'host' ? 'app.example.com' : undefined)),
  };
}

function policyAssignment(productType: string) {
  return {
    productType,
    binderId: `binder-${productType.toLowerCase()}-1`,
    programId: `program-${productType.toLowerCase()}-1`,
  };
}

describe('BO quote send route', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    Object.keys(captured).forEach((key) => delete captured[key]);
    dispatchQuoteEmailMock.mockResolvedValue({ queued: true, messageId: 'msg-quote-1' });
    transitionPolicyLifecycleMock.mockResolvedValue({ from: 'DRAFT', to: 'QUOTED' });
    enqueuePolicyListIndexUpdateMock.mockResolvedValue(undefined);

    const { registerPolicyQuoteRoutes } = await import('../../../modules/policy/http/quoteRouter.js');
    const router = {
      get: vi.fn(),
      post: vi.fn((path: string, ...handlers: unknown[]) => {
        captured[`POST ${path}`] = handlers[handlers.length - 1] as (req: unknown, res: unknown) => Promise<unknown>;
      }),
    };
    registerPolicyQuoteRoutes(router as Parameters<typeof registerPolicyQuoteRoutes>[0]);
  });

  itNoTenant('queues a quote email through communications core, records lifecycle, and audits the message id', async () => {
    const { tenantScopedPrisma } = await import('../../../platform/db/connection.js');
    vi.mocked(tenantScopedPrisma.policy.findUnique).mockResolvedValue({
      id: 'policy-1',
      policyNumber: 'ABQ-1',
      ...policyAssignment('MOTOR'),
      publicSessionToken: 'public-token',
      status: 'DRAFT',
      quoteData: {},
      stateCurrent: {
        snapshot: {
          quoteData: {
            proposer: {
              firstName: 'Ada',
              lastName: 'Lovelace',
              email: 'ada@example.com',
            },
          },
        },
      },
    });

    const handler = captured['POST /:id/quote/send'];
    expect(handler).toBeTruthy();
    const res = mockRes();
    await handler(quoteSendRequest(), res);

    expect(dispatchQuoteEmailMock).toHaveBeenCalledWith(
      'ada@example.com',
      'Ada Lovelace',
      'https://app.example.com/quote/public-token?product=motor&step=your-quote',
      undefined,
      'quote.pdf',
      expect.objectContaining({
        policyId: 'policy-1',
        idempotencySeed: 'quote-send:policy-1:corr-1',
      }),
    );
    expect(transitionPolicyLifecycleMock).toHaveBeenCalledWith(expect.objectContaining({
      policyId: 'policy-1',
      to: 'QUOTED',
      reasonCode: 'QUOTE_SENT',
      data: expect.objectContaining({ recipient: 'ada@example.com', messageId: 'msg-quote-1' }),
    }));
    expect(auditLogMock).toHaveBeenCalledWith(
      'policy-1',
      'POLICY',
      'QUOTE.SENT',
      'user-1',
      'USER',
      expect.objectContaining({ recipient: 'ada@example.com', messageId: 'msg-quote-1' }),
      'Ops User',
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({
        status: 'queued',
        recipient: 'ada@example.com',
        messageId: 'msg-quote-1',
        lifecycleRecorded: true,
      }),
    }));
  });

  itNoTenant('re-sends an already quoted policy without duplicating a QUOTED lifecycle transition', async () => {
    const { tenantScopedPrisma } = await import('../../../platform/db/connection.js');
    vi.mocked(tenantScopedPrisma.policy.findUnique).mockResolvedValue({
      id: 'policy-1',
      policyNumber: 'ABQ-1',
      ...policyAssignment('MOTOR'),
      publicSessionToken: 'public-token',
      status: 'QUOTED',
      quoteData: { proposer: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' } },
      stateCurrent: null,
    });

    const res = mockRes();
    await captured['POST /:id/quote/send'](quoteSendRequest(), res);

    expect(dispatchQuoteEmailMock).toHaveBeenCalledWith(
      'ada@example.com',
      'Ada Lovelace',
      'https://app.example.com/quote/public-token?product=motor&step=your-quote',
      undefined,
      'quote.pdf',
      expect.objectContaining({
        policyId: 'policy-1',
        idempotencySeed: 'quote-send:policy-1:corr-1',
      }),
    );
    expect(transitionPolicyLifecycleMock).not.toHaveBeenCalled();
    expect(enqueuePolicyListIndexUpdateMock).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ lifecycleRecorded: true }),
    }));
  });

  itNoTenant('does not generate or send a stale quote for a terminal policy', async () => {
    const { tenantScopedPrisma } = await import('../../../platform/db/connection.js');
    vi.mocked(tenantScopedPrisma.policy.findUnique).mockResolvedValue({
      id: 'policy-1',
      policyNumber: 'ABOLV/CY1000001',
      ...policyAssignment('HOME'),
      publicSessionToken: 'public-token',
      status: 'CANCELLED',
      quoteData: { proposer: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' } },
      stateCurrent: null,
    });

    const res = mockRes();
    await captured['POST /:id/quote/send'](quoteSendRequest(), res);

    expect(dispatchQuoteEmailMock).not.toHaveBeenCalled();
    expect(transitionPolicyLifecycleMock).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: 'INVALID_STATUS',
        message: 'Cannot send a quote while the policy status is CANCELLED',
      },
    });
  });

  itNoTenant('sends manual Business proposals without requiring a generated quote PDF pack', async () => {
    const { tenantScopedPrisma } = await import('../../../platform/db/connection.js');
    const { DocumentService } = await import('../../../modules/documents/app/documentService.js');
    vi.mocked(tenantScopedPrisma.policy.findUnique).mockResolvedValue({
      id: 'policy-1',
      policyNumber: 'ABQ-1',
      ...policyAssignment('BUSINESS'),
      publicSessionToken: 'public-token',
      status: 'DRAFT',
      quoteData: {
        proposer: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
        manualPremium: 250,
        proposal: {
          coverageRows: [{ coverage: 'Public liability', premium: 250, excess: '500', limit: '1,000,000' }],
        },
      },
      quoteResponse: {
        pricingMode: 'manual',
        primaryOption: { annualPremium: 250 },
      },
      stateCurrent: null,
    });

    const res = mockRes();
    await captured['POST /:id/quote/send'](quoteSendRequest(), res);

    expect(DocumentService.generate).not.toHaveBeenCalled();
    expect(dispatchQuoteEmailMock).toHaveBeenCalledWith(
      'ada@example.com',
      'Ada Lovelace',
      'https://app.example.com/quote/public-token?product=business&step=your-quote',
      undefined,
      'Quote-ABQ-1.pdf',
      expect.objectContaining({
        policyId: 'policy-1',
        idempotencySeed: 'quote-send:policy-1:corr-1',
      }),
    );
    expect(transitionPolicyLifecycleMock).toHaveBeenCalledWith(expect.objectContaining({
      policyId: 'policy-1',
      to: 'QUOTED',
      reasonCode: 'QUOTE_SENT',
    }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ status: 'queued', recipient: 'ada@example.com' }),
    }));
  });

  itNoTenant('uses the open-market product slug in manual Open Market quote links', async () => {
    const { tenantScopedPrisma } = await import('../../../platform/db/connection.js');
    const { DocumentService } = await import('../../../modules/documents/app/documentService.js');
    vi.mocked(tenantScopedPrisma.policy.findUnique).mockResolvedValue({
      id: 'policy-1',
      policyNumber: 'ABQ-1',
      ...policyAssignment('OPEN_MARKET'),
      publicSessionToken: 'public-token',
      status: 'DRAFT',
      quoteData: {
        proposer: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
        manualPremium: 250,
        proposal: {
          coverageRows: [{ coverage: 'Marine liability', premium: 250, excess: '500', limit: '1,000,000' }],
        },
      },
      quoteResponse: {
        pricingMode: 'manual',
        primaryOption: { annualPremium: 250 },
      },
      stateCurrent: null,
    });

    const res = mockRes();
    await captured['POST /:id/quote/send'](quoteSendRequest(), res);

    expect(DocumentService.generate).not.toHaveBeenCalled();
    expect(dispatchQuoteEmailMock).toHaveBeenCalledWith(
      'ada@example.com',
      'Ada Lovelace',
      'https://app.example.com/quote/public-token?product=open-market&step=your-quote',
      undefined,
      'Quote-ABQ-1.pdf',
      expect.objectContaining({
        policyId: 'policy-1',
        idempotencySeed: 'quote-send:policy-1:corr-1',
      }),
    );
  });

  // ABY-84 / ABY-87: when the policy has no proposer email, the route
  // must reject with a 422 + actionable `MISSING_EMAIL` message so
  // the BO toast can show "Customer email is missing from quote
  // data" instead of the legacy "Unknown error". The lifecycle must
  // not transition and no audit/log should claim QUOTE.SENT.
  it('returns 422 MISSING_EMAIL with an actionable message when proposer.email is empty', async () => {
    const { tenantScopedPrisma } = await import('../../../platform/db/connection.js');
    vi.mocked(tenantScopedPrisma.policy.findUnique).mockResolvedValue({
      id: 'policy-1',
      policyNumber: 'ABQ-1',
      ...policyAssignment('MOTOR'),
      publicSessionToken: 'public-token',
      quoteData: { proposer: { firstName: 'Ada', lastName: 'Lovelace' } },
      stateCurrent: null,
    });

    const res = mockRes();
    await captured['POST /:id/quote/send'](quoteSendRequest(), res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: expect.objectContaining({
        code: 'MISSING_EMAIL',
        message: 'Customer email is missing from quote data',
      }),
    }));
    expect(dispatchQuoteEmailMock).not.toHaveBeenCalled();
    expect(transitionPolicyLifecycleMock).not.toHaveBeenCalled();
    expect(auditLogMock).not.toHaveBeenCalled();
  });

  it('refuses to send a customer-facing quote when its canonical assignment is absent', async () => {
    const { tenantScopedPrisma } = await import('../../../platform/db/connection.js');
    vi.mocked(tenantScopedPrisma.policy.findUnique).mockResolvedValue({
      id: 'policy-1',
      policyNumber: 'ABQ-1',
      productType: 'HOME',
      publicSessionToken: 'public-token',
      status: 'DRAFT',
      quoteData: { proposer: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' } },
      stateCurrent: null,
    });

    const res = mockRes();
    await captured['POST /:id/quote/send'](quoteSendRequest(), res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: expect.objectContaining({ code: 'PRODUCT_ASSIGNMENT_REQUIRED' }),
    }));
    expect(dispatchQuoteEmailMock).not.toHaveBeenCalled();
  });

  it('returns a clear error when the quote email cannot be queued', async () => {
    const { tenantScopedPrisma } = await import('../../../platform/db/connection.js');
    vi.mocked(tenantScopedPrisma.policy.findUnique).mockResolvedValue({
      id: 'policy-1',
      policyNumber: 'ABQ-1',
      ...policyAssignment('MOTOR'),
      publicSessionToken: 'public-token',
      status: 'DRAFT',
      quoteData: { proposer: { email: 'ada@example.com' } },
      stateCurrent: null,
    });
    dispatchQuoteEmailMock.mockResolvedValueOnce({ queued: false, skippedReason: 'Missing template mapping' });

    const res = mockRes();
    await captured['POST /:id/quote/send'](quoteSendRequest(), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: expect.objectContaining({
        code: 'EMAIL_FAILED',
        message: 'Failed to send quote email (Missing template mapping)',
      }),
    }));
    expect(transitionPolicyLifecycleMock).not.toHaveBeenCalled();
    expect(auditLogMock).not.toHaveBeenCalled();
  });
});

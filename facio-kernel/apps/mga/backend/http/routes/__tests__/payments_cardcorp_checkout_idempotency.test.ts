/**
 * CardCorp public-checkout HTTP boundary.
 *
 * Two things this test pins down:
 *
 * 1. **Idempotency.** When the same `x-idempotency-key` is replayed, we must
 *    return the existing Payment row's checkoutId verbatim and MUST NOT call
 *    the upstream gateway nor insert a duplicate Payment row.
 *
 * 2. **Tenant-scoped redirect URL.** The `shopperResultUrl` (where the user
 *    lands after CardCorp completes) must use the *operating tenant's*
 *    publicBaseUrl — not the globally-configured `PUBLIC_APP_BASE_URL`, and
 *    not the Origin header from the request. Pre-2026-05 a single env value
 *    leaked across tenants and PT customers were redirected to the CY
 *    domain.
 */
import type { Router } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runWithOperatingTenant } from '../../../platform/tenant/tenantAls.js';
import type { TenantConfig } from '../../../platform/tenant/tenantConfig.js';

// ─── Strongly-typed test fixtures ─────────────────────────────────

type CheckoutResponse = {
  success: boolean;
  data?: {
    paymentId?: string;
    checkoutId?: string;
    integrity?: string | null;
    shopperResultUrl?: string;
    idempotent?: boolean;
  };
  error?: { code: string; message: string };
};

// The route handler reads only a tiny slice of Express's Request/Response
// surface. We type the extracted handler against `unknown` parameters
// (matching the existing `auth.otp.test.ts` convention) so the test can
// pass narrow mock objects directly without coercing them to a full
// Request/Response.
type RouteHandler = (req: unknown, res: unknown) => Promise<void>;

type MockedResponse = {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn<(body: CheckoutResponse) => MockedResponse>>;
};

const prismaMock = {
  policy: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  payment: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  // ADR-0067 — checkout screens the real subject before opening OPPWA. This
  // test is not about screening, so the lookup returns null and the mocked
  // compliance spine below clears.
  policyHolder: {
    findFirst: vi.fn(),
  },
};

const cardcorpCreateCheckoutMock = vi.fn();
const enqueuePolicyListIndexUpdateMock = vi.fn();
const evaluateIssueReadinessMock = vi.fn();
// ABY-261 — the checkout handler now always re-rates at the boundary
// (`ratePolicyAndPersist`) before computing the amount. This integration
// test isn't about the rate pipeline (the pipeline has its own
// `quoteRateService` unit tests); it cares about idempotency replay and
// tenant-scoped redirect URLs. We stub the rate spine so it returns a
// clean `QUOTED` with the same premium the legacy fixture carries.
const ratePolicyAndPersistMock = vi.fn();

// `prisma` and `tenantScopedPrisma` share the same shape in tests — every
// route call site uses tenantScopedPrisma in production now, but a few
// helpers still hold `prisma` references. Aliasing keeps both code paths
// in sync regardless of which one the route currently happens to call.
vi.mock('../../../platform/db/connection.js', () => ({
  prisma: prismaMock,
  tenantScopedPrisma: prismaMock,
}));

vi.mock('../../../modules/payments/infra/cardcorpGateway.js', () => ({
  cardcorpCreateCheckout: cardcorpCreateCheckoutMock,
  cardcorpGetPaymentStatus: vi.fn(),
  cardcorpGetPaymentStatusByResourcePath: vi.fn(),
  formatAmountEUR: (value: number) => value.toFixed(2),
  safeMerchantTxId: (seed: string) => `tx-${seed}`,
}));

vi.mock('../../../modules/policy/infra/projections/policyListIndex.js', () => ({
  enqueuePolicyListIndexUpdate: enqueuePolicyListIndexUpdateMock,
}));

vi.mock('../../../platform/audit/logger.js', () => ({
  AuditLogger: { log: vi.fn() },
}));

vi.mock('../../../modules/documents/app/documentService.js', () => ({
  DocumentService: { generate: vi.fn() },
}));

vi.mock('../../../platform/storage/service.js', () => ({
  storageService: { getFileStream: vi.fn() },
}));

vi.mock('../../../modules/communications/domain/notifications/email.js', () => ({
  sendPolicyWelcomeEmail: vi.fn(),
}));

vi.mock('../../../platform/events/queue.js', () => ({
  routeEventToQueue: vi.fn(),
}));

vi.mock('../../../modules/recommendations/app/bandit.js', () => ({
  updateBanditFromEvent: vi.fn(),
}));

vi.mock('../../../modules/quotes/app/quoteRateService.js', () => ({
  ratePolicyAndPersist: (args: { policyId: string; productType: string }) => ratePolicyAndPersistMock(args),
}));

// ADR-0067 — checkout screens before opening OPPWA. Screening has its own unit
// tests (`cardcorpCheckoutService.test.ts`); here we clear it so we exercise the
// idempotency / tenant-redirect path under test.
vi.mock('../../../modules/compliance/app/index.js', () => ({
  getSanctionsService: () => ({ assertClearOrThrow: vi.fn(async () => ({})) }),
  resolveIndividualScreeningSubject: (args: { policyHolderName?: string | null; quoteData?: unknown }) => {
    const proposer =
      (args.quoteData as { proposer?: { firstName?: string; lastName?: string } } | undefined)?.proposer ?? {};
    const name =
      [proposer.firstName, proposer.lastName].filter(Boolean).join(' ').trim() ||
      String(args.policyHolderName ?? '').trim();
    return name ? { subjectName: name } : null;
  },
  SanctionsBlockError: class SanctionsBlockError extends Error {},
}));

// Issue-readiness short-circuits the checkout endpoint with 422 when there
// are missing fields. We force a clean readiness so we exercise the actual
// checkout path.
vi.mock('../../../modules/policy/app/issueReadiness.js', () => ({
  evaluateIssueReadiness: (policyId: string, actor: string) =>
    evaluateIssueReadinessMock(policyId, actor),
}));

vi.mock('../../../modules/programs/app/policyProgrammeChannelPermissions.js', () => ({
  resolvePolicyProgrammeChannelPermissions: vi.fn(async () => ({
    binderProductAuthorityId: 'authority-1',
    permissions: { questions: true, quote: true, payment: true },
  })),
}));

const PT_TENANT: TenantConfig = {
  id: '00000000-0000-4000-8000-000000000002',
  tenantSlug: 'abbeygate-pt',
  countryCode: 'PT',
  country: 'Portugal',
  currency: 'EUR',
  ipt: { rate: 0.09 },
  adminFee: 18,
  legalPack: 'pt',
  publicBaseUrl: 'https://abbeygate-pt.facio.io',
  fromEmail: 'no-reply@abbeygate.pt',
  brandLogo: { white: '', blue: '' },
};

// Default tenant for the non-routing tests. The checkout service reads
// `getTenantConfig().countryCode` for billing country, so every test that
// invokes the handler must run inside `runWithOperatingTenant(...)` per
// ADR-0019 (tenancy + authority fail-closed).
const CY_TENANT: TenantConfig = {
  id: '00000000-0000-4000-8000-000000000001',
  tenantSlug: 'abbeygate-cy',
  countryCode: 'CY',
  country: 'Cyprus',
  currency: 'EUR',
  ipt: { flatFee: 0 },
  adminFee: 18,
  legalPack: 'cy',
  publicBaseUrl: 'https://abbeygate-cy.facio.io',
  fromEmail: 'no-reply@facio.io',
  brandLogo: { white: '', blue: '' },
};

// Express's runtime `Router` is shaped as `{ stack: Layer[] }`, but the
// public type does not expose the stack. We narrow to exactly the keys
// we read below — never reaching for the full `Layer` shape.
type RouterStack = {
  stack: Array<{
    route?: {
      path?: string;
      methods?: Record<string, boolean>;
      stack?: Array<{ handle: RouteHandler }>;
    };
  }>;
};

function isRouterStack(value: unknown): value is RouterStack {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return false;
  const candidate = value as { stack?: unknown };
  return Array.isArray(candidate.stack);
}

function getCheckoutHandler(router: Router): RouteHandler {
  if (!isRouterStack(router)) throw new Error('Router does not expose a stack');
  const layer = router.stack.find(
    (entry) => entry.route?.path === '/auto/:policyId/checkout' && entry.route?.methods?.post,
  );
  const handlers = layer?.route?.stack;
  if (!handlers || handlers.length === 0) throw new Error('Checkout route handler not found');
  const last = handlers[handlers.length - 1];
  if (!last) throw new Error('Checkout route handler stack is empty');
  return last.handle;
}

const BASE_POLICY = {
  id: 'pol-1',
  publicSessionToken: 'pub-1',
  policyNumber: 'ABQ1001',
  productType: 'MOTOR',
  paymentStatus: 'PENDING',
  status: 'QUOTED',
  quoteData: {
    proposer: {
      firstName: 'John',
      lastName: 'Doe',
      email: 'john@example.com',
      address: { line1: '1 Main', city: 'Nicosia', postcode: '1000' },
    },
  },
  quoteResponse: { primaryOption: { annualPremium: 120 } },
};

type TestRequest = {
  params: { policyId: string };
  headers: { origin: string };
  get: (header: string) => string;
  ip: string;
  protocol: string;
};

type ReqOverrides = { origin?: string; idempotency?: string };

function makeReq(overrides: ReqOverrides = {}): TestRequest {
  const idempotency = overrides.idempotency ?? 'idem-123';
  return {
    params: { policyId: 'pub-1' },
    headers: { origin: overrides.origin ?? 'https://app.example.com' },
    get: (header: string) => (header.toLowerCase() === 'x-idempotency-key' ? idempotency : ''),
    ip: '127.0.0.1',
    protocol: 'https',
  };
}

function makeRes(): MockedResponse {
  const mocked: MockedResponse = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn<(body: CheckoutResponse) => MockedResponse>().mockReturnThis(),
  };
  return mocked;
}

const EXISTING_PAYMENT_ROW = {
  id: 'pay-1',
  checkoutId: 'chk-1',
  integrity: 'sha-1',
};

describe('paymentsCardcorp checkout idempotency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // ADR-0049 — per-country entity ids (this test exercises CY and PT tenants).
    process.env.CARDCORP_ENV = 'test';
    process.env.CARDCORP_ENTITY_ID_CY = 'ent-cy';
    process.env.CARDCORP_ENTITY_ID_PT = 'ent-pt';
    process.env.CARDCORP_BEARER_TOKEN = 'tok-1';
    process.env.CARDCORP_BASE_URL = 'https://eu-test.oppwa.com';
    process.env.CARDCORP_TEST_MODE = 'EXTERNAL';
    process.env.PUBLIC_APP_BASE_URL = 'https://abbeygate-cy.facio.io';
    evaluateIssueReadinessMock.mockResolvedValue({ blockers: [] });
    prismaMock.policy.findUnique.mockImplementation(async ({ where }: { where: Record<string, string> }) => {
      if (where.publicSessionToken === 'pub-1') return BASE_POLICY;
      return null;
    });
    prismaMock.policyHolder.findFirst.mockResolvedValue(null);
    prismaMock.payment.findFirst.mockResolvedValue(EXISTING_PAYMENT_ROW);
    ratePolicyAndPersistMock.mockResolvedValue({
      ok: true,
      status: 'QUOTED',
      quoteData: BASE_POLICY.quoteData,
      quoteResponse: { primaryOption: { annualPremium: 120 } },
      underwritingAnalysis: null,
    });
  });

  it('returns existing checkout for same x-idempotency-key (no gateway call, no duplicate Payment row)', async () => {
    const { default: router } = await import('../paymentsCardcorp.js');
    const handler = getCheckoutHandler(router);
    const req = makeReq();
    const res = makeRes();

    await runWithOperatingTenant(CY_TENANT, async () => {
      await handler(req, res);
    });

    expect(prismaMock.payment.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        policyId: 'pol-1',
        provider: 'CARDCORP',
        idempotencyKey: 'idem-123',
      }),
    }));
    expect(cardcorpCreateCheckoutMock).not.toHaveBeenCalled();
    expect(prismaMock.payment.create).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          paymentId: 'pay-1',
          checkoutId: 'chk-1',
          idempotent: true,
        }),
      }),
    );
  }, 15_000);

  it('builds shopperResultUrl from the operating tenant publicBaseUrl, not from PUBLIC_APP_BASE_URL or Origin (multi-tenant link safety)', async () => {
    const { default: router } = await import('../paymentsCardcorp.js');
    const handler = getCheckoutHandler(router);
    // Hostile request: env, origin, AND host all point to CY. The only
    // PT signal is the ALS-bound operating tenant.
    const req = makeReq({ origin: 'https://abbeygate-cy.facio.io' });
    const res = makeRes();

    await runWithOperatingTenant(PT_TENANT, async () => {
      await handler(req, res);
    });

    expect(res.json).toHaveBeenCalledTimes(1);
    const [payload] = res.json.mock.calls[0];
    expect(payload.success).toBe(true);
    const shopperResultUrl = payload.data?.shopperResultUrl ?? '';
    expect(shopperResultUrl).toMatch(/^https:\/\/abbeygate-pt\.facio\.io\/quote\//);
    expect(shopperResultUrl).not.toMatch(/abbeygate-cy/);
  }, 15_000);
});

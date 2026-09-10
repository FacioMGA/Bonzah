import { describe, expect, it, vi } from 'vitest';

// Mocks at the platform / module boundary — the route factory pulls
// in Prisma, tenant config, and the product registry at import time.
// Per docs/develop/test.md mock policy: mock at the platform-utility
// boundary, not at the router under test.

vi.mock('../../../platform/db/connection.js', () => ({
  prisma: {},
  tenantScopedPrisma: {},
}));
vi.mock('../../../platform/storage/service.js', () => ({
  storageService: { getFileStream: vi.fn() },
}));
vi.mock('../../../modules/compliance/app/index.js', () => ({
  assertSanctionsClearForQuote: vi.fn(async () => undefined),
  SanctionsBlockError: class SanctionsBlockError extends Error {},
}));
vi.mock('../../../platform/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../../platform/tenant/tenantConfig.js', () => ({
  getTenantConfig: () => ({ id: 'tenant_test' }),
}));
vi.mock('../../../modules/policy/app/productRegistryService.js', () => ({
  productAdapterExists: (code: string) => ['MOTOR', 'HOME', 'TRAVEL', 'HEALTH'].includes(code.toUpperCase()),
  getProductSegmentLabel: (code: string) => code,
  resolvePolicyPeriodForProduct: () => ({ inception: new Date(), expiry: new Date() }),
}));
vi.mock('../../../modules/quotes/app/publicQuoteEmailService.js', () => ({
  sendPublicQuoteEmailForSession: vi.fn(),
}));

const { createGenericPublicQuoteRouter } = await import(
  '../../../modules/quotes/http/genericPublicQuoteRouter.js'
);
const { shouldMaterializeCustomerAccountForSession } = await import(
  '../../../modules/quotes/http/genericPublicQuoteRouter.js'
);

type RouteSpec = { method: string; path: string };

// Express's runtime `Router` is shaped as `{ stack: Layer[] }`, but the
// public type does not expose the stack. We narrow to exactly the keys
// we read below via a typed guard — never reaching for the full Layer
// shape, and never laundering the cast through `unknown`.
type RouterStack = {
  stack: Array<{
    route?: { path: string; methods: Record<string, boolean> };
  }>;
};

function isRouterStack(value: unknown): value is RouterStack {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return false;
  const candidate = value as { stack?: unknown };
  return Array.isArray(candidate.stack);
}

function collectRoutes(router: ReturnType<typeof createGenericPublicQuoteRouter>): RouteSpec[] {
  const routes: RouteSpec[] = [];
  if (!isRouterStack(router)) return routes;
  for (const layer of router.stack) {
    if (!layer.route) continue;
    for (const method of Object.keys(layer.route.methods)) {
      if (layer.route.methods[method]) routes.push({ method: method.toUpperCase(), path: layer.route.path });
    }
  }
  return routes;
}

describe('genericPublicQuoteRouter — surface contract', () => {
  it('exposes a router factory for every production product code', () => {
    expect(typeof createGenericPublicQuoteRouter).toBe('function');
    for (const code of ['motor', 'home', 'travel', 'health', 'business', 'open_market']) {
      const router = createGenericPublicQuoteRouter(code);
      expect(router).toBeDefined();
      expect(typeof router).toBe('function');
    }
  });

  it('registers the cross-product resume-link endpoint for every product', () => {
    for (const code of ['motor', 'home', 'travel', 'health', 'business', 'open_market']) {
      const routes = collectRoutes(createGenericPublicQuoteRouter(code));
      const resumeLink = routes.find((r) => r.path === '/:token/resume-link' && r.method === 'POST');
      expect(resumeLink, `${code} must register POST /:token/resume-link`).toBeDefined();
    }
  });

  it('motor route surface registers the full :policyId-keyed session API', () => {
    const motor = collectRoutes(createGenericPublicQuoteRouter('motor'));
    const motorPaths = motor.map((r) => `${r.method} ${r.path}`);
    expect(motorPaths).toContain('POST /');
    expect(motorPaths).toContain('GET /:policyId');
    expect(motorPaths).toContain('PATCH /:policyId');
    expect(motorPaths).toContain('POST /:policyId/rate');
    expect(motorPaths).toContain('POST /:policyId/fork');
    expect(motorPaths).toContain('POST /:policyId/unlock');
    expect(motorPaths).toContain('GET /:policyId/issue-readiness');
    expect(motorPaths).toContain('GET /:policyId/recommendations');
    expect(motorPaths).toContain('POST /:policyId/recommendations/events');
    expect(motorPaths).toContain('POST /:policyId/documents/generate');
    expect(motorPaths).toContain('POST /:policyId/documents/issued-pack');
    expect(motorPaths).toContain('POST /:policyId/request-callback');
    expect(motorPaths).toContain('POST /:policyId/quote/send');
  });

  it('non-motor surfaces register a token-keyed session API (parallel to motor but :token-keyed)', () => {
    for (const code of ['home', 'travel', 'health']) {
      const paths = collectRoutes(createGenericPublicQuoteRouter(code)).map(
        (r) => `${r.method} ${r.path}`,
      );
      expect(paths, `${code} must expose POST /`).toContain('POST /');
      expect(paths, `${code} must expose POST /:token/quote/send`).toContain('POST /:token/quote/send');
      const tokenKeyed = paths.filter((p) => p.includes(':token'));
      expect(tokenKeyed.length, `${code} must expose at least one :token-keyed route`).toBeGreaterThan(0);
    }
  });

  it('does not materialize customer accounts from incomplete Step 5 autosaves', () => {
    const incompleteYourDetails = {
      proposer: {
        firstName: 'Yuval',
        lastName: 'Smoke',
        email: '',
        phone: '',
        occupation: 'student',
      },
    };

    expect(shouldMaterializeCustomerAccountForSession({
      quoteData: incompleteYourDetails,
      requestedMaterialize: true,
      step: 'your-details',
    })).toBe(false);

    expect(shouldMaterializeCustomerAccountForSession({
      quoteData: {
        proposer: {
          firstName: 'Yuval',
          lastName: 'Smoke',
          email: 'yuval@example.test',
          phone: '+35722000000',
          occupation: 'student',
        },
      },
      requestedMaterialize: true,
      step: 'your-details',
    })).toBe(true);
  });
});

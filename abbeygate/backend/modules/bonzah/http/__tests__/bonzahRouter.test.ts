import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type RouteHandler = (req: unknown, res: unknown, next?: unknown) => Promise<void> | void;

const { routes, middleware } = vi.hoisted(() => {
  const routes: Record<string, RouteHandler> = {};
  const middleware: RouteHandler[] = [];
  return { routes, middleware };
});

vi.mock('express', () => ({
  Router: () => ({
    use: vi.fn((handler: RouteHandler) => { middleware.push(handler); }),
    get: vi.fn((path: string, ...handlers: unknown[]) => { routes[`GET ${path}`] = handlers[handlers.length - 1] as RouteHandler; }),
    post: vi.fn((path: string, ...handlers: unknown[]) => { routes[`POST ${path}`] = handlers[handlers.length - 1] as RouteHandler; }),
  }),
}));

const { createBonzahPartnerRouter } = await import('../bonzahRouter.js');
const { registerAllProducts } = await import('../../../../products/registerProducts.js');
const { goldenRentalQuote } = await import('../../../../products/rental/goldenFixtures.js');
const { createRentalQuote } = await import('../../app/quoteService.js');
const { demoQuoteStore } = await import('../../app/quoteStore.js');
const { InsillionClient, setInsillionClientForTests } = await import('../../infra/insillionClient.js');

registerAllProducts();

type Captured = { status: number; body: unknown; headers: Record<string, string>; payload?: Buffer };
const makeRes = () => {
  const captured: Captured = { status: 200, body: undefined, headers: {} };
  const res = {
    status: (code: number) => { captured.status = code; return res; },
    json: (body: unknown) => { captured.body = body; return res; },
    setHeader: (key: string, value: string) => { captured.headers[key.toLowerCase()] = value; },
    send: (payload: Buffer) => { captured.payload = payload; return res; },
  };
  return { res, captured };
};

const PARTNER = 'summit';
const authHeaders = { authorization: 'Bearer bonzah-demo-local-token', 'x-partner-id': PARTNER };

const call = async (route: string, req: Record<string, unknown>) => {
  const { res, captured } = makeRes();
  await routes[route]({ params: {}, body: {}, query: {}, headers: authHeaders, ...req }, res, () => undefined);
  return captured;
};

beforeEach(() => { demoQuoteStore.reset(); createBonzahPartnerRouter(); });
afterEach(() => { delete process.env.BONZAH_EXECUTION_MODE; setInsillionClientForTests(null); });

const script = (responses: unknown[], pdf?: { body: string; contentType: string }) => {
  const fetcher = async (input: string | URL | Request) => {
    if (pdf && String(input).includes('/api/v1/policy/data/')) {
      return new Response(pdf.body, { status: 200, headers: { 'content-type': pdf.contentType, 'content-disposition': 'attachment; filename="cdw.pdf"' } });
    }
    return new Response(JSON.stringify(responses.shift()), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  setInsillionClientForTests(new InsillionClient({ baseUrl: 'https://bonzah.sb.insillion.com', username: 'user', password: 'super-secret-password', timeoutMs: 1000 }, fetcher));
  process.env.BONZAH_EXECUTION_MODE = 'insillion';
};

const issuePolicy = async () => {
  script([
    { status: 0, data: { token: 'provider-token' } },
    { status: 0, data: { country: ['United States'] } },
    { status: 0, data: [{ state: 'Colorado' }] },
    { status: 0, data: { total_premium: 100, cdw_rate: '$10 / 24 hours', rcli_rate: '$8 / 24 hours', sli_rate: '$5 / 24 hours', pai_rate: '$2 / 24 hours' } },
  ]);
  const quote = await createRentalQuote({ request: goldenRentalQuote, partnerId: PARTNER, idempotencyKey: 'router-quote' });
  demoQuoteStore.savePolicy({
    policyId: 'P1', policyNumber: 'POL1', quoteId: quote.quoteId, paymentStatus: 'VERIFIED', executionMode: 'INSILLION',
    coverages: ['CDW'], documents: [{ coverage: 'CDW', href: '/api/v1/bonzah/policies/P1/documents/CDW' }],
    providerReferences: { quoteId: 'Q1', paymentId: 'PY1', policyId: 'P1', policyNumber: 'POL1' },
    partnerId: PARTNER, documentIds: { CDW: '11' },
  });
};

describe('Bonzah partner policy routes', () => {
  it('does not return synthetic preview prices in provider mode', async () => {
    process.env.BONZAH_EXECUTION_MODE = 'insillion';
    const result = await call('POST /price-preview', { body: { pickup: goldenRentalQuote.risk.pickup, rentalStart: goldenRentalQuote.risk.rentalStart, rentalEnd: goldenRentalQuote.risk.rentalEnd, vehicle: goldenRentalQuote.risk.vehicle, coverages: goldenRentalQuote.coverages } });
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ success: false, error: { code: 'PROVIDER_PREVIEW_REQUIRES_QUOTE' } });
  });

  it('does not allow demo reset to erase provider retry protection', async () => {
    process.env.BONZAH_EXECUTION_MODE = 'insillion';
    demoQuoteStore.recordProviderOperation(PARTNER, 'Q1', { paymentId: 'PY1' });
    const result = await call('POST /demo/reset', { headers: { ...authHeaders, 'x-demo-reset-token': 'bonzah-demo-reset-local' } });
    expect(result.status).toBe(403);
    expect(demoQuoteStore.getProviderOperation(PARTNER, 'Q1')).toEqual({ paymentId: 'PY1' });
  });
  it('requires a partner bearer token', async () => {
    const { res, captured } = makeRes();
    const next = vi.fn();
    middleware[0]({ headers: { 'x-partner-id': PARTNER } }, res, next);
    expect(captured.status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns the normalized issued policy without provider credentials', async () => {
    await issuePolicy();
    const result = await call('GET /policies/:policyId', { params: { policyId: 'P1' } });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ success: true, data: { policyId: 'P1', policyNumber: 'POL1', executionMode: 'INSILLION' } });
    const serialised = JSON.stringify(result.body);
    expect(serialised).not.toContain('provider-token');
    expect(serialised).not.toContain('super-secret-password');
    expect(serialised).not.toContain('documentIds');
  });

  it('refuses to disclose a policy belonging to another partner', async () => {
    await issuePolicy();
    const { res, captured } = makeRes();
    await routes['GET /policies/:policyId']({ params: { policyId: 'P1' }, headers: { ...authHeaders, 'x-partner-id': 'other-partner' } }, res, () => undefined);
    expect(captured.status).toBe(403);
    expect(captured.body).toMatchObject({ success: false, error: { code: 'PARTNER_MISMATCH' } });
  });

  it('returns 404 for an unknown policy', async () => {
    const result = await call('GET /policies/:policyId', { params: { policyId: 'missing' } });
    expect(result.status).toBe(404);
    expect(result.body).toMatchObject({ success: false, error: { code: 'POLICY_NOT_FOUND' } });
  });

  it('streams the provider PDF without exposing the provider token', async () => {
    await issuePolicy();
    script([{ status: 0, data: { token: 'provider-token' } }], { body: '%PDF-1.4 fake', contentType: 'application/pdf' });
    const result = await call('GET /policies/:policyId/documents/:coverage', { params: { policyId: 'P1', coverage: 'CDW' } });
    expect(result.status).toBe(200);
    expect(result.headers['content-type']).toBe('application/pdf');
    expect(result.headers['content-disposition']).toContain('cdw.pdf');
    expect(result.payload?.toString()).toBe('%PDF-1.4 fake');
    expect(JSON.stringify(result.headers)).not.toContain('provider-token');
  });

  it('returns 404 for a coverage the policy has no document for', async () => {
    await issuePolicy();
    const result = await call('GET /policies/:policyId/documents/:coverage', { params: { policyId: 'P1', coverage: 'SLI' } });
    expect(result.status).toBe(404);
    expect(result.body).toMatchObject({ success: false, error: { code: 'POLICY_DOCUMENT_NOT_FOUND' } });
  });

  it('requires an idempotency key on partner quote creation', async () => {
    const result = await call('POST /quotes', { body: goldenRentalQuote, headers: authHeaders });
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ success: false, error: { code: 'IDEMPOTENCY_KEY_REQUIRED' } });
  });
});

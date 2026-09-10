/**
 * publicVehiclesRouter — merge contract tests.
 *
 * Pins the regressions that triggered ABY-28 (Dodge Durango), ABY-31
 * (MG S6 EV Trophy Long Range), ABY-35 (Daihatsu Terios), and ABY-229
 * (Mazda Demio):
 *   - The curated catalog (`backend/platform/data/vehicles/euPopular.ts`)
 *     contains the customer-reported makes and models.
 *   - The default `/makes` and `/models/:make` responses merge curated +
 *     vPIC, with curated pinned at the top in declaration order.
 *   - `?strict=1` returns curated-only.
 *   - vPIC failures degrade to curated-only with a warning rather than
 *     5xx-ing the wizard.
 *
 * Test pattern (matches `endorsements.issue-doc-orchestration.test.ts`
 * and `cancellations.test.ts`): inject a fake router into
 * `registerPublicVehiclesRoutes(router, deps)`. The fake captures
 * each route handler in a `routes` map keyed by `METHOD path`.
 * Handlers are stored as `unknown` and called via a typed callable
 * adapter at the call site — there is no need to introspect
 * Express's internal `router.stack`, and there is no need to coerce
 * partial req/res stubs to full `express.Request`/`express.Response`
 * (the captured handler's parameter type at the seam is `unknown`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  registerPublicVehiclesRoutes,
} from '../publicVehiclesRouter.js';
import { EU_POPULAR_MAKES, EU_POPULAR_MODELS } from '../../../../platform/data/vehicles/euPopular.js';

type CapturedHandler = (req: unknown, res: unknown, next?: unknown) => Promise<unknown> | unknown;

type MockResponseTrace = {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
};

function makeMockRes(): { res: unknown; trace: MockResponseTrace } {
  const trace: MockResponseTrace = { statusCode: 200, body: undefined, headers: {} };
  const res = {
    status(code: number) { trace.statusCode = code; return res; },
    json(body: unknown) { trace.body = body; return res; },
    setHeader(name: string, value: string) { trace.headers[name] = value; return res; },
  };
  return { res, trace };
}

function buildRouter() {
  const routes: Record<string, CapturedHandler> = {};
  const noop = vi.fn();
  return {
    routes,
    get: vi.fn((path: string, handler: CapturedHandler) => { routes[`GET ${path}`] = handler; }),
    post: vi.fn((path: string, handler: CapturedHandler) => { routes[`POST ${path}`] = handler; }),
    put: noop,
    delete: noop,
    use: noop,
    patch: noop,
  };
}

const passthrough = (_req: unknown, _res: unknown, next: () => void) => next();

function registerForTest() {
  const router = buildRouter();
  // The registrar's signature is `express.Router`; the captured
  // shape is structurally identical for the methods the production
  // code calls (`get` / `post`). `as never` lets the test inject
  // the fake without loosening the production type.
  registerPublicVehiclesRoutes(router as never, {
    authenticate: passthrough as never,
    requireBO: passthrough as never,
  });
  return router;
}

describe('publicVehiclesRouter — curated catalog data', () => {
  it('contains Dodge in EU_POPULAR_MAKES (ABY-28)', () => {
    expect(EU_POPULAR_MAKES.some((m) => m.value === 'Dodge')).toBe(true);
  });

  it('contains Daihatsu in EU_POPULAR_MAKES (ABY-35)', () => {
    expect(EU_POPULAR_MAKES.some((m) => m.value === 'Daihatsu')).toBe(true);
  });

  it('contains Durango in DODGE models (ABY-28)', () => {
    expect(EU_POPULAR_MODELS.DODGE?.some((m) => m.value === 'Durango')).toBe(true);
  });

  it('contains Terios in DAIHATSU models (ABY-35)', () => {
    expect(EU_POPULAR_MODELS.DAIHATSU?.some((m) => m.value === 'Terios')).toBe(true);
  });

  it('contains S6 EV in MG models (ABY-31)', () => {
    expect(EU_POPULAR_MODELS.MG?.some((m) => m.value === 'S6 EV')).toBe(true);
  });

  it('contains Demio in MAZDA models (ABY-229)', () => {
    expect(EU_POPULAR_MODELS.MAZDA?.some((m) => m.value === 'Demio')).toBe(true);
  });
});

describe('publicVehiclesRouter — /makes default merge contract', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('merges curated + vPIC by default with curated pinned at the top', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        Results: [
          { Make_Name: 'Tesla' },
          { Make_Name: 'Aston Martin' },
          { Make_Name: 'Bugatti' },
        ],
      }),
    });
    const router = registerForTest();
    const handler = router.routes['GET /makes'];
    const { res, trace } = makeMockRes();
    await handler({ query: {} }, res);
    expect(trace.statusCode).toBe(200);
    const body = trace.body as { success: boolean; data: Array<{ value: string; label: string }> };
    expect(body.success).toBe(true);
    const declOrder = EU_POPULAR_MAKES.map((m) => m.value);
    const dataValues = body.data.map((m) => m.value);
    for (let i = 0; i < declOrder.length; i++) {
      expect(dataValues[i]).toBe(declOrder[i]);
    }
    const upstreamPart = dataValues.slice(declOrder.length);
    expect(upstreamPart).toContain('Aston Martin');
    expect(upstreamPart).toContain('Bugatti');
    const teslaCount = dataValues.filter((v) => v.toUpperCase() === 'TESLA').length;
    expect(teslaCount).toBe(1);
  });

  it('returns curated-only when ?strict=1', async () => {
    const router = registerForTest();
    const handler = router.routes['GET /makes'];
    const { res, trace } = makeMockRes();
    await handler({ query: { strict: '1' } }, res);
    expect(trace.statusCode).toBe(200);
    const body = trace.body as { success: boolean; data: Array<{ value: string }> };
    expect(body.success).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    const dataValues = body.data.map((m) => m.value);
    expect(dataValues).toContain('Dodge');
    expect(dataValues).toContain('Daihatsu');
  });

  it('falls back to curated-only with warning when vPIC errors', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) });
    const router = registerForTest();
    const handler = router.routes['GET /makes'];
    const { res, trace } = makeMockRes();
    await handler({ query: {} }, res);
    expect(trace.statusCode).toBe(200);
    const body = trace.body as { success: boolean; data: unknown[]; warning?: { code: string } };
    expect(body.success).toBe(true);
    expect(body.warning?.code).toBe('UPSTREAM_ERROR');
    expect(body.data.length).toBeGreaterThanOrEqual(EU_POPULAR_MAKES.length);
  });
});

describe('publicVehiclesRouter — /models/:make default merge contract', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns Durango for /models/DODGE without ?strict (ABY-28)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ Results: [{ Model_Name: 'Avenger' }] }),
    });
    const router = registerForTest();
    const handler = router.routes['GET /models/:make'];
    const { res, trace } = makeMockRes();
    await handler({ query: {}, params: { make: 'DODGE' } }, res);
    const body = trace.body as { success: boolean; data: Array<{ value: string }> };
    const values = body.data.map((m) => m.value);
    expect(values).toContain('Durango');
  });

  it('returns Terios for /models/DAIHATSU (ABY-35)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ Results: [] }),
    });
    const router = registerForTest();
    const handler = router.routes['GET /models/:make'];
    const { res, trace } = makeMockRes();
    await handler({ query: {}, params: { make: 'DAIHATSU' } }, res);
    const body = trace.body as { success: boolean; data: Array<{ value: string }> };
    const values = body.data.map((m) => m.value);
    expect(values).toContain('Terios');
  });

  it('returns S6 EV for /models/MG even when curated has entries (ABY-31)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ Results: [{ Model_Name: 'TF' }, { Model_Name: 'S6 EV' }] }),
    });
    const router = registerForTest();
    const handler = router.routes['GET /models/:make'];
    const { res, trace } = makeMockRes();
    await handler({ query: {}, params: { make: 'MG' } }, res);
    const body = trace.body as { success: boolean; data: Array<{ value: string }> };
    const values = body.data.map((m) => m.value);
    expect(values).toContain('S6 EV');
    expect(values.filter((v) => v.toUpperCase() === 'S6 EV').length).toBe(1);
    expect(values).toContain('TF');
  });

  it('returns Demio for /models/Mazda without ?strict (ABY-229)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ Results: [{ Model_Name: 'Mazda2' }] }),
    });
    const router = registerForTest();
    const handler = router.routes['GET /models/:make'];
    const { res, trace } = makeMockRes();
    await handler({ query: {}, params: { make: 'Mazda' } }, res);
    const body = trace.body as { success: boolean; data: Array<{ value: string }> };
    const values = body.data.map((m) => m.value);
    expect(values).toContain('Demio');
    expect(values.filter((v) => v.toUpperCase() === 'DEMIO')).toHaveLength(1);
  });
});

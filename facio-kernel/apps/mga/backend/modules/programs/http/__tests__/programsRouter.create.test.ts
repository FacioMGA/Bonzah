import { beforeEach, describe, expect, it, vi } from 'vitest';

const productFindUnique = vi.fn();
const programCreate = vi.fn();
const programFindUnique = vi.fn();
const ratingModelFindFirst = vi.fn();
const ratingModelCreate = vi.fn();
const auditLog = vi.fn();

vi.mock('@prisma/client', () => ({
  Prisma: { PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {} },
}));

vi.mock('../../../../platform/db/connection.js', () => ({
  prisma: {
    productDefinition: { findUnique: productFindUnique },
    programBinderLink: {},
  },
  tenantScopedPrisma: {
    program: { create: programCreate, findUnique: programFindUnique },
    programRatingModel: { findFirst: ratingModelFindFirst, create: ratingModelCreate },
  },
}));

vi.mock('../../../../platform/audit/logger.js', () => ({
  AuditLogger: { log: auditLog },
}));

vi.mock('../../../policy/app/binders/binderAuthority.js', () => ({
  assertBinderAuthorizesProduct: vi.fn(),
  BinderAuthorityError: class BinderAuthorityError extends Error {},
}));

vi.mock('../../../../platform/utils/logger.js', () => ({ logger: { error: vi.fn() } }));
vi.mock('../../../accessControl/http/permissionMiddleware.js', () => ({
  requirePermission: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
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

type RouteHandler = (req: unknown, res: unknown) => Promise<void> | void;
type RouterLayer = {
  route?: {
    path?: string;
    methods?: { post?: boolean; put?: boolean };
    stack?: Array<{ handle?: RouteHandler }>;
  };
};

function getPostHandler(router: { stack: RouterLayer[] }): RouteHandler {
  const layer = router.stack.find(
    (entry) =>
      entry.route?.path === '/' &&
      Boolean(entry.route.methods?.post),
  );
  if (!layer) throw new Error('POST / route not found');
  const handler = layer.route?.stack?.at(-1)?.handle;
  if (!handler) throw new Error('POST / handler not found');
  return handler;
}

function getPutHandler(router: { stack: RouterLayer[] }, path: string): RouteHandler {
  const layer = router.stack.find(
    (entry) => entry.route?.path === path && Boolean(entry.route.methods?.put),
  );
  if (!layer) throw new Error(`PUT ${path} route not found`);
  const handler = layer.route?.stack?.at(-1)?.handle;
  if (!handler) throw new Error(`PUT ${path} handler not found`);
  return handler;
}

describe('programsRouter POST /', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('persists the selected active ProductDefinition as the canonical program product without creating metadata settings', async () => {
    productFindUnique.mockResolvedValue({ code: 'HOME', isActive: true });
    programCreate.mockResolvedValue({ id: 'program-1', name: 'Home 2026', productType: 'HOME', status: 'DRAFT' });
    const { default: router } = await import('../programsRouter.js');
    const res = mockRes();

    await getPostHandler(router)({ body: { name: 'Home 2026', productType: 'home', metadata: { currency: 'EUR' } }, auditContext: {} }, res);

    expect(productFindUnique).toHaveBeenCalledWith({ where: { code: 'HOME' }, select: { code: true, isActive: true } });
    expect(programCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ name: 'Home 2026', productType: 'HOME', status: 'DRAFT' }),
    }));
    expect(programCreate.mock.calls[0]?.[0].data).not.toHaveProperty('metadata');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, data: expect.objectContaining({ productType: 'HOME' }) }));
  });

  it('refuses an unavailable product instead of creating a product-less program', async () => {
    productFindUnique.mockResolvedValue(null);
    const { default: router } = await import('../programsRouter.js');
    const res = mockRes();

    await getPostHandler(router)({ body: { name: 'Home 2026', productType: 'HOME' }, auditContext: {} }, res);

    expect(programCreate).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'PRODUCT_NOT_AVAILABLE', message: 'No active product definition for HOME' },
    });
  });
});

describe('programsRouter PUT /:id/rating-model', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows an empty stage list for a Home model, whose product engine has no pipeline', async () => {
    programFindUnique.mockResolvedValue({ id: 'home-program', productType: 'HOME' });
    ratingModelFindFirst.mockResolvedValue(null);
    ratingModelCreate.mockResolvedValue({ id: 'home-rates-v1', version: 1, status: 'DRAFT', stages: [], tables: {} });
    const { default: router } = await import('../programsRouter.js');
    const res = mockRes();

    await getPutHandler(router, '/:id/rating-model')({
      params: { id: 'home-program' },
      body: { stages: [], tables: {} },
      auditContext: {},
    }, res);

    expect(ratingModelCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ programId: 'home-program', stages: [] }),
    }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});

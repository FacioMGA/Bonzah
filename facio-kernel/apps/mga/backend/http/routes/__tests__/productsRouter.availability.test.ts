import { describe, expect, it, vi } from 'vitest';
import { getTenantFixtures } from '../../../products/testHelpers/tenantFixtures.js';
import { runWithOperatingTenant } from '../../../platform/tenant/tenantAls.js';

const { findManyMock, findUniqueMock } = vi.hoisted(() => ({ findManyMock: vi.fn(), findUniqueMock: vi.fn() }));
vi.mock('../../../platform/db/connection.js', () => ({ prisma: { productDefinition: { findMany: findManyMock, findUnique: findUniqueMock } } }));
import productsRouter from '../../../modules/products/http/productsRouter.js';
type RouterLayer = { route?: { path?: string; methods?: { get?: boolean }; stack?: Array<{ handle?: (req: unknown, res: unknown) => Promise<void> }> } };
async function getProductRoute(path: string, code?: string) {
  const layer = (productsRouter.stack as RouterLayer[]).find((entry) => entry.route?.path === path && entry.route.methods?.get);
  const handler = layer?.route?.stack?.at(-1)?.handle;
  if (!handler) throw new Error(`GET ${path} handler missing`);
  const response: { status: number; body: { data?: unknown } } = { status: 200, body: {} };
  const res = { status: (status: number) => { response.status = status; return res; }, json: (body: { data?: unknown }) => { response.body = body; return res; } };
  await handler({ params: { code } }, res);
  return response;
}
const tenant = (code: string) => getTenantFixtures().find((entry) => entry.countryCode === code)!;

describe('product catalog territory filtering', () => {
  it('omits Motor from the Greece product collection', async () => {
    findManyMock.mockResolvedValue([{ code: 'MOTOR' }, { code: 'HOME' }, { code: 'TRAVEL' }]);
    const response = await runWithOperatingTenant(tenant('GR'), () => getProductRoute('/'));
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([{ code: 'HOME' }, { code: 'TRAVEL' }]);
  });

  it('does not expose Greece Motor through the direct metadata route', async () => {
    findUniqueMock.mockClear();
    findUniqueMock.mockResolvedValue({ code: 'MOTOR' });
    const response = await runWithOperatingTenant(tenant('GR'), () => getProductRoute('/:code', 'motor'));
    expect(response.status).toBe(404);
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it('retains Portugal Motor metadata', async () => {
    findUniqueMock.mockResolvedValue({ code: 'MOTOR' });
    const response = await runWithOperatingTenant(tenant('PT'), () => getProductRoute('/:code', 'motor'));
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ code: 'MOTOR' });
  });
});

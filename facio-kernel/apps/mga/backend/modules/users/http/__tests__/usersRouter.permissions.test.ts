import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveEffectivePermissionKeysForUser = vi.fn();
const requirePermission = vi.fn((_resource: string, _action: string) => (_req: unknown, _res: unknown, next: () => void) => next());
const syncSystemAccessAssignmentsForUser = vi.fn();

vi.mock('../../../accessControl/http/permissionMiddleware.js', () => ({ requirePermission }));

vi.mock('../../../accessControl/app/permissionService.js', () => ({
  resolveEffectivePermissionKeysForUser,
  syncSystemAccessAssignmentsForUser,
}));

vi.mock('../app/userDeps.js', () => ({
  prisma: {
    user: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      delete: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    userOtp: {
      create: vi.fn(),
      delete: vi.fn(),
    },
  },
  sendPasswordResetOtpEmail: vi.fn(async () => true),
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

function mockRes() {
  const res: { status?: ReturnType<typeof vi.fn>; json?: ReturnType<typeof vi.fn> } = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

function getRouteHandler(router: { stack: Array<Record<string, unknown>> }, method: 'get', path: string) {
  const layer = router.stack.find(
    (entry) =>
      (entry.route as { path?: string } | undefined)?.path === path &&
      Boolean((entry.route as { methods?: Record<string, boolean> } | undefined)?.methods?.[method]),
  );
  if (!layer) throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
  const stack = (layer.route as { stack?: Array<{ handle?: (req: unknown, res: unknown) => Promise<void> | void }> }).stack || [];
  return stack[stack.length - 1]?.handle as (req: unknown, res: unknown) => Promise<void> | void;
}

describe('usersRouter /me', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns effective permissions for the authenticated user', async () => {
    resolveEffectivePermissionKeysForUser.mockResolvedValue(['roles.view', 'users.view']);

    const mod = await import('../usersRouter.js');
    const handler = getRouteHandler(mod.createUsersModuleRouter(), 'get', '/me');

    const req = {
      user: {
        id: 'user-1',
        email: 'ops@example.com',
        name: 'Ops User',
        role: 'UNDERWRITER',
      },
    };
    const res = mockRes();

    await handler(req, res);

    expect(resolveEffectivePermissionKeysForUser).toHaveBeenCalledWith('user-1', 'UNDERWRITER');
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        id: 'user-1',
        email: 'ops@example.com',
        name: 'Ops User',
        role: 'UNDERWRITER',
        username: 'ops@example.com',
        effectivePermissions: ['roles.view', 'users.view'],
      },
    });
  });
});

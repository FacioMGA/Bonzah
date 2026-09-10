import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveEffectivePermissionsForUser = vi.fn();
const hasEffectivePermission = vi.fn();

vi.mock('../../app/permissionService.js', () => ({
  resolveEffectivePermissionsForUser,
  hasEffectivePermission,
}));

describe('requirePermission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.STRICT_PERMISSION_ENFORCEMENT;
  });

  it('allows the request when the permission is resolved', async () => {
    const { requirePermission } = await import('../permissionMiddleware.js');
    resolveEffectivePermissionsForUser.mockResolvedValue([{ key: 'roles.view' }]);
    hasEffectivePermission.mockReturnValue(true);

    const next = vi.fn();
    const req = {
      user: { id: 'user-1', role: 'UNDERWRITER' },
    };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };

    await requirePermission('roles', 'view')(req as never, res as never, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 403 when the permission is missing', async () => {
    const { requirePermission } = await import('../permissionMiddleware.js');
    resolveEffectivePermissionsForUser.mockResolvedValue([{ key: 'users.view' }]);
    hasEffectivePermission.mockReturnValue(false);

    const next = vi.fn();
    const req = {
      user: { id: 'user-1', role: 'UNDERWRITER' },
    };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };

    await requirePermission('roles', 'view')(req as never, res as never, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: 'PERMISSION_DENIED' }),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('returns explicit check failure when permission resolution errors', async () => {
    const { requirePermission } = await import('../permissionMiddleware.js');
    resolveEffectivePermissionsForUser.mockRejectedValue(new Error('db unavailable'));

    const next = vi.fn();
    const req = {
      user: { id: 'user-1', role: 'UNDERWRITER' },
    };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };

    await requirePermission('roles', 'view')(req as never, res as never, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: 'PERMISSION_CHECK_FAILED' }),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('returns explicit check failure for config or service resolver failures', async () => {
    const { requirePermission } = await import('../permissionMiddleware.js');
    resolveEffectivePermissionsForUser.mockRejectedValue(Object.assign(new Error('permission service misconfigured'), {
      code: 'CONFIG_MISSING',
    }));

    const next = vi.fn();
    const req = {
      user: { id: 'user-1', role: 'UNDERWRITER' },
    };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };

    await requirePermission('roles', 'view')(req as never, res as never, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: 'PERMISSION_CHECK_FAILED' }),
      }),
    );
    expect(next).not.toHaveBeenCalled();
    expect(hasEffectivePermission).not.toHaveBeenCalled();
  });

  it('returns explicit auth-required when req.user is missing on a protected route', async () => {
    const { requirePermission } = await import('../permissionMiddleware.js');

    const next = vi.fn();
    const req = {};
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };

    await requirePermission('roles', 'view')(req as never, res as never, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: 'AUTH_REQUIRED' }),
      }),
    );
    expect(resolveEffectivePermissionsForUser).not.toHaveBeenCalled();
    expect(hasEffectivePermission).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('ignores the retired fail-open env flag', async () => {
    process.env.STRICT_PERMISSION_ENFORCEMENT = 'false';
    const { requirePermission } = await import('../permissionMiddleware.js');
    resolveEffectivePermissionsForUser.mockRejectedValue(new Error('db unavailable'));

    const next = vi.fn();
    const req = {
      user: { id: 'user-1', role: 'UNDERWRITER' },
    };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };

    await requirePermission('roles', 'view')(req as never, res as never, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: 'PERMISSION_CHECK_FAILED' }),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });
});

describe('requireDocumentFetchPermission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows inline fetches with documents.view', async () => {
    const { requireDocumentFetchPermission } = await import('../permissionMiddleware.js');
    resolveEffectivePermissionsForUser.mockResolvedValue([{ key: 'documents.view' }]);
    hasEffectivePermission.mockImplementation((_perms, key) => key === 'documents.view');

    const next = vi.fn();
    const req = {
      user: { id: 'user-1', role: 'UNDERWRITER' },
      query: { inline: '1' },
    };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };

    await Reflect.apply(requireDocumentFetchPermission(), undefined, [req, res, next]);

    expect(hasEffectivePermission).toHaveBeenCalledWith(expect.anything(), 'documents.view');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('requires documents.download for attachment fetches', async () => {
    const { requireDocumentFetchPermission } = await import('../permissionMiddleware.js');
    resolveEffectivePermissionsForUser.mockResolvedValue([{ key: 'documents.view' }]);
    hasEffectivePermission.mockReturnValue(false);

    const next = vi.fn();
    const req = {
      user: { id: 'user-1', role: 'UNDERWRITER' },
      query: {},
    };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };

    await Reflect.apply(requireDocumentFetchPermission(), undefined, [req, res, next]);

    expect(hasEffectivePermission).toHaveBeenCalledWith(expect.anything(), 'documents.download');
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});

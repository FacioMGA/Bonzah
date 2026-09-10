import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcrypt';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
process.env.OTP_SECRET = process.env.OTP_SECRET || 'test-otp-secret';

const prismaMock = {
  user: {
    findUnique: vi.fn(),
    // ABY-311: signup + email-OTP existing-user lookups switched from
    // `findUnique` (case-sensitive) to `findFirst` with case-insensitive
    // mode. Default-delegate to `findUnique` so test setups that
    // `findUnique.mockResolvedValue(...)` keep working unchanged for
    // routes that now call `findFirst`.
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  userOtp: {
    count: vi.fn(),
    create: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  account: {
    create: vi.fn(),
    findFirst: vi.fn(),
  },
  accountUser: {
    create: vi.fn(),
    createMany: vi.fn(),
    findFirst: vi.fn(),
  },
  $transaction: vi.fn(),
};

// `tenantScopedPrisma` is the tenant-extended client used by handlers for
// account/policy writes; for these tests it can simply alias `prismaMock`
// since we don't exercise any tenant-scoping behaviour.
vi.mock('../../../platform/db/connection.js', () => ({
  prisma: prismaMock,
  tenantScopedPrisma: prismaMock,
}));

const sendEmailVerificationOtpEmailMock = vi.fn(async () => true);
const sendPasswordResetOtpEmailMock = vi.fn(async () => true);

vi.mock('../../../modules/communications/domain/notifications/email.js', () => ({
  sendEmailVerificationOtpEmail: (...args: unknown[]) =>
    sendEmailVerificationOtpEmailMock(...(args as Parameters<typeof sendEmailVerificationOtpEmailMock>)),
  sendPasswordResetOtpEmail: (...args: unknown[]) =>
    sendPasswordResetOtpEmailMock(...(args as Parameters<typeof sendPasswordResetOtpEmailMock>)),
}));

function mockRes() {
  const res: { status?: ReturnType<typeof vi.fn>; json?: ReturnType<typeof vi.fn> } = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

function getRouteHandler(router: { stack: Array<Record<string, unknown>> }, method: 'post' | 'get', path: string) {
  // The composer mounts sub-routers (`router.use(loginRouter)` etc.) so
  // route layers may live one level deep. Walk the parent stack first,
  // then descend into any nested subrouters.
  const findInStack = (stack: Array<Record<string, unknown>>): Record<string, unknown> | undefined => {
    for (const l of stack) {
      const route = l.route as { path?: string; methods?: Record<string, boolean> } | undefined;
      if (route?.path === path && Boolean(route.methods?.[method])) return l;
      const nested = (l.handle as { stack?: Array<Record<string, unknown>> } | undefined)?.stack;
      if (nested) {
        const hit = findInStack(nested);
        if (hit) return hit;
      }
    }
    return undefined;
  };

  const layer = findInStack(router.stack);
  if (!layer) {
    throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
  }
  // Return the LAST handler in the route's stack (the body), not the first.
  // Routes that pre-register `applyIpRateLimit` as middleware end up with that
  // middleware as `stack[0]`; the actual route logic these tests want to
  // exercise sits at `stack[stack.length - 1]`.
  const stack = (layer.route as { stack?: Array<{ handle?: (req: unknown, res: unknown) => Promise<void> | void }> } | undefined)?.stack || [];
  const last = stack[stack.length - 1];
  return last?.handle as (req: unknown, res: unknown) => Promise<void> | void;
}

describe('auth email OTP routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendEmailVerificationOtpEmailMock.mockReset();
    sendEmailVerificationOtpEmailMock.mockResolvedValue(true);
    sendPasswordResetOtpEmailMock.mockReset();
    sendPasswordResetOtpEmailMock.mockResolvedValue(true);
    prismaMock.$transaction.mockImplementation(async (cb: (tx: typeof prismaMock) => unknown) => cb(prismaMock));
    // ABY-311: routes now use `findFirst` for case-insensitive
    // existing-user lookup. Delegate to `findUnique` so existing test
    // setups (which call `findUnique.mockResolvedValue(...)`) cover
    // both lookup shapes without touching every test.
    prismaMock.user.findFirst.mockImplementation(async () => prismaMock.user.findUnique());
  });

  afterEach(() => {
    delete process.env.NODE_ENV;
  });

  it('does not create OTP for non-customer users on request', async () => {
    const mod = await import('../../../modules/auth/http/authRouter.js');
    const handler = getRouteHandler(mod.default, 'post', '/email-otp/request');
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'u-bo',
      email: 'ops@example.com',
      role: 'ADMIN',
    });

    const req = { body: { email: 'ops@example.com' } };
    const res = mockRes();
    await handler(req, res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { sent: true } });
    expect(prismaMock.userOtp.create).not.toHaveBeenCalled();
  });

  // ABY-311 (production: yuval@facio.io, 2026-06-04). Existing-user
  // lookup MUST be case-insensitive so an admin row stored as
  // `Yuval@facio.io` still triggers the non-customer enumeration
  // guard when a customer-flow OTP request comes in lowercased
  // (`yuval@facio.io`). Pre-fix this used `findUnique` and missed
  // the admin row, letting the OTP flow proceed with what was in
  // fact an admin email.
  it('non-customer guard is case-insensitive on email — admin stored as Yuval@facio.io still blocks lowercase request', async () => {
    const mod = await import('../../../modules/auth/http/authRouter.js');
    const handler = getRouteHandler(mod.default, 'post', '/email-otp/request');

    prismaMock.user.findFirst.mockReset();
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'u-admin-mixed-case',
      email: 'Yuval@facio.io',
      role: 'ADMIN',
    });

    const req = { body: { email: 'yuval@facio.io' } };
    const res = mockRes();
    await handler(req, res);

    expect(prismaMock.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          email: expect.objectContaining({
            equals: 'yuval@facio.io',
            mode: 'insensitive',
          }),
        }),
      }),
    );
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { sent: true } });
    expect(prismaMock.userOtp.create).not.toHaveBeenCalled();
  });

  it('verifies OTP and auto-creates customer with auth token', async () => {
    const mod = await import('../../../modules/auth/http/authRouter.js');
    const handler = getRouteHandler(mod.default, 'post', '/email-otp/verify');

    const userEmail = 'new.customer@example.com';
    prismaMock.userOtp.findFirst.mockResolvedValue({
      id: 'otp-1',
      codeHash: '66c3264ecf56c062a5d599a5c00902ffbe7488c9b12c84c33b01ad2cd8178c41',
      attempts: 0,
    });
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue({
      id: 'u-new',
      email: userEmail,
      role: 'CUSTOMER',
      name: 'New Customer',
      emailVerifiedAt: new Date('2026-02-13T10:00:00.000Z'),
      tokenVersion: 0,
    });
    prismaMock.account.create.mockResolvedValue({ id: 'acc-1' });
    prismaMock.accountUser.create.mockResolvedValue({ id: 'au-1' });
    prismaMock.user.update.mockResolvedValue({
      id: 'u-new',
      email: userEmail,
      role: 'CUSTOMER',
      name: 'New Customer',
      emailVerifiedAt: new Date('2026-02-13T10:00:00.000Z'),
      tokenVersion: 0,
      primaryAccountId: 'acc-1',
    });

    const req = { body: { email: userEmail, code: '123456', name: 'New Customer' } };
    const res = mockRes();
    await handler(req, res);

    expect(res.status).not.toHaveBeenCalled();
    expect(prismaMock.user.create).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          verified: true,
          token: expect.any(String),
          user: expect.objectContaining({
            email: userEmail,
            role: 'CUSTOMER',
          }),
        }),
      })
    );
  });

  it('allows OTP request for verified customers in dashboard access flow', async () => {
    const mod = await import('../../../modules/auth/http/authRouter.js');
    const handler = getRouteHandler(mod.default, 'post', '/email-otp/request');
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'u-customer',
      email: 'verified.customer@example.com',
      role: 'CUSTOMER',
      emailVerifiedAt: new Date('2026-02-10T09:00:00.000Z'),
    });
    prismaMock.userOtp.count.mockResolvedValue(0);
    prismaMock.userOtp.create.mockResolvedValue({ id: 'otp-2' });

    const req = {
      body: {
        email: 'verified.customer@example.com',
        flow: 'DASHBOARD_ACCESS',
      }
    };
    const res = mockRes();
    await handler(req, res);

    expect(prismaMock.userOtp.create).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ sent: true }),
      })
    );
  });

  it('assigns an internal account to admin login when tenant context is missing', async () => {
    process.env.NODE_ENV = 'production';
    vi.resetModules();
    const compareSpy = vi.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
    const mod = await import('../../../modules/auth/http/authRouter.js');
    const handler = getRouteHandler(mod.default, 'post', '/login');

    prismaMock.user.findUnique.mockResolvedValue({
      id: 'u-admin',
      email: 'admin@example.com',
      role: 'ADMIN',
      name: 'Admin User',
      password: '$2b$10$CwTycUXWue0Thq9StjUM0uJ8X5sMzdON3NofM8JrIoYNewc19hXtG', // "secret"
      mfaEnabled: false,
      emailVerifiedAt: null,
      tokenVersion: 0,
      primaryAccountId: null,
    });
    prismaMock.accountUser.findFirst.mockResolvedValue(null);
    prismaMock.account.findFirst.mockResolvedValue({ id: 'acc-internal' });
    prismaMock.accountUser.createMany.mockResolvedValue({ count: 1 });
    prismaMock.user.update.mockResolvedValue({
      id: 'u-admin',
      email: 'admin@example.com',
      role: 'ADMIN',
      name: 'Admin User',
      password: '$2b$10$CwTycUXWue0Thq9StjUM0uJ8X5sMzdON3NofM8JrIoYNewc19hXtG',
      mfaEnabled: false,
      emailVerifiedAt: null,
      tokenVersion: 0,
      primaryAccountId: 'acc-internal',
    });

    const req = { body: { username: 'admin@example.com', password: 'password' } };
    const res = mockRes();
    await handler(req, res);

    expect(prismaMock.account.findFirst).toHaveBeenCalled();
    expect(prismaMock.accountUser.createMany).toHaveBeenCalledWith({
      data: [{ accountId: 'acc-internal', userId: 'u-admin', role: 'OWNER' }],
      skipDuplicates: true,
    });
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'u-admin' },
      data: { primaryAccountId: 'acc-internal' },
    });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          tenantId: 'acc-internal',
          user: expect.objectContaining({
            email: 'admin@example.com',
            primaryAccountId: 'acc-internal',
          }),
        }),
      }),
    );
    compareSpy.mockRestore();
    delete process.env.NODE_ENV;
  });

  // ABY-71 — verify the resilient OTP request path (see authRouter
  // comments for the full rationale). The contract is:
  //   - If the OTP row is created, the route MUST return success.
  //   - The OTP row MUST NOT be deleted on email-pipeline failure.
  //   - Production responses MUST NOT leak SendGrid/worker failures
  //     back as a hard 500 — the customer can still verify when the
  //     email eventually arrives.
  describe('ABY-71 — OTP request resilience to comms-pipeline failures', () => {
    async function loadHandlerWithNodeEnv(nodeEnv: 'production' | 'development') {
      // Each test isolates its own `isProd` evaluation by setting
      // NODE_ENV BEFORE the module is (re-)imported, so the
      // top-of-module `const isProd = ...` snapshot is correct for
      // this scenario regardless of test order.
      process.env.NODE_ENV = nodeEnv;
      vi.resetModules();
      const mod = await import('../../../modules/auth/http/authRouter.js');
      return getRouteHandler(mod.default, 'post', '/email-otp/request');
    }

    it('returns success and KEEPS the OTP row when sendEmailVerificationOtpEmail throws (production)', async () => {
      sendEmailVerificationOtpEmailMock.mockRejectedValueOnce(new Error('TENANT_CONTEXT_REQUIRED'));
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'u-cust',
        email: 'cust@example.com',
        role: 'CUSTOMER',
        emailVerifiedAt: null,
      });
      prismaMock.userOtp.count.mockResolvedValue(0);
      prismaMock.userOtp.create.mockResolvedValue({ id: 'otp-resilient' });
      const otpDelete = vi.fn();
      const otpRecord = prismaMock.userOtp as unknown as Record<string, unknown>; // TODO(FAC-9202): drop this Record cast once `prismaMock.userOtp` exposes a typed `delete` mock surface; today the test-only mock map is `unknown`-shaped on purpose so individual tests wire methods on demand.
      const originalDelete = otpRecord.delete;
      otpRecord.delete = otpDelete;

      try {
        const handler = await loadHandlerWithNodeEnv('production');
        const req = { body: { email: 'cust@example.com', flow: 'DASHBOARD_ACCESS' } };
        const res = mockRes();
        await handler(req, res);

        expect(res.status).not.toHaveBeenCalled();
        expect(otpDelete).not.toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            success: true,
            data: expect.objectContaining({ sent: false, expiresMinutes: 10 }),
          }),
        );
        // Production never leaks devCode.
        const lastJsonArg = (res.json as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as Record<string, unknown>;
        const lastJsonData = (lastJsonArg?.data || {}) as Record<string, unknown>;
        expect('devCode' in lastJsonData).toBe(false);
      } finally {
        otpRecord.delete = originalDelete;
      }
    });

    it('returns success and surfaces devCode in non-prod when the dispatcher returns false', async () => {
      sendEmailVerificationOtpEmailMock.mockResolvedValueOnce(false);
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'u-cust-dev',
        email: 'devcust@example.com',
        role: 'CUSTOMER',
        emailVerifiedAt: null,
      });
      prismaMock.userOtp.count.mockResolvedValue(0);
      prismaMock.userOtp.create.mockResolvedValue({ id: 'otp-dev' });

      const handler = await loadHandlerWithNodeEnv('development');
      const req = { body: { email: 'devcust@example.com', flow: 'DASHBOARD_ACCESS' } };
      const res = mockRes();
      await handler(req, res);

      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            sent: false,
            expiresMinutes: 10,
            devCode: expect.any(String),
          }),
        }),
      );
    });
  });

  it('rejects disabled users before issuing a login token', async () => {
    const compareSpy = vi.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
    const mod = await import('../../../modules/auth/http/authRouter.js');
    const handler = getRouteHandler(mod.default, 'post', '/login');

    prismaMock.user.findUnique.mockResolvedValue({
      id: 'u-disabled',
      email: 'customer@example.com',
      role: 'CUSTOMER',
      name: 'Disabled Customer',
      password: '$2b$10$CwTycUXWue0Thq9StjUM0uJ8X5sMzdON3NofM8JrIoYNewc19hXtG',
      isActive: false,
      suspendedAt: new Date('2026-05-07T12:00:00.000Z'),
      mfaEnabled: false,
      emailVerifiedAt: new Date('2026-05-01T12:00:00.000Z'),
      tokenVersion: 0,
      primaryAccountId: 'acc-customer',
    });

    const req = { body: { username: 'Customer@Example.com', password: 'password' } };
    const res = mockRes();
    await handler(req, res);

    expect(compareSpy).not.toHaveBeenCalled();
    expect(prismaMock.accountUser.findFirst).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'ACCOUNT_DISABLED', message: 'Account is disabled' },
    });
    compareSpy.mockRestore();
  });
});

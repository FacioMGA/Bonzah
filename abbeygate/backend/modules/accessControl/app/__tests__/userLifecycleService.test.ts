/**
 * userLifecycleService — magic-link emission contract.
 *
 * Both the **admin password reset** and **invite** flows persist a
 * sha256-hashed token in `UserOtp` and email the recipient a magic link
 * pointing at `<publicAppBaseUrl>/auth/reset?token=<token>`.
 *
 * These tests pin two behaviours we MUST preserve:
 *
 * - The mailed link uses the per-call `publicAppBaseUrl` argument verbatim
 *   (which the router resolves tenant-aware via `resolvePublicAppBaseUrlFromRequest`).
 *   So in a multi-tenant deploy, calling these helpers with the PT tenant's
 *   base URL produces a PT link — never CY, never localhost, never the
 *   `PUBLIC_APP_BASE_URL` env var.
 * - On email-send failure the OTP row is cleaned up and a typed
 *   `EMAIL_SEND_FAILED` error is surfaced (so the UI can offer a "resend"
 *   affordance and we don't have stale unredeemable OTP rows).
 */
import crypto from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Strongly-typed mock signatures ────────────────────────────────
//
// Mocks are typed with the exact function signature they replace so that
// `mock.calls[i][j]` is already correctly typed and we never have to use
// `as` casts in the test body.

type SendResetLinkArgs = { toEmail: string; url: string; expiresHours: number };
type SendInviteLinkArgs = {
  toEmail: string;
  firstName: string;
  url: string;
  expiresHours: number;
  invitedBy?: string;
  platformName?: string;
};
type UserCreateArgs = {
  data: {
    email: string;
    firstName: string | null;
    lastName: string | null;
    isActive: boolean;
    password: string;
    inviteToken: string;
    inviteExpiresAt: Date;
    [key: string]: unknown;
  };
  select?: Record<string, boolean>;
};
type UserOtpCreateArgs = {
  data: {
    userId: string;
    email: string;
    purpose: 'PASSWORD_RESET' | string;
    codeHash: string;
    expiresAt: Date;
  };
};

const userMock = {
  findUnique: vi.fn(),
  findFirst: vi.fn(),
  create: vi.fn<(args: UserCreateArgs) => Promise<{ id: string; email: string }>>(),
  update: vi.fn(),
};
const userOtpMock = {
  create: vi.fn<(args: UserOtpCreateArgs) => Promise<{ id: string }>>(),
  delete: vi.fn(),
};
const accessAssignmentMock = {
  createMany: vi.fn(),
};
const prismaMock = {
  user: userMock,
  userOtp: userOtpMock,
  accessAssignment: accessAssignmentMock,
};

const sendPasswordResetLinkEmailMock =
  vi.fn<(args: SendResetLinkArgs) => Promise<boolean>>();
const sendInviteLinkEmailMock =
  vi.fn<(args: SendInviteLinkArgs) => Promise<boolean>>();
const auditLoggerMock = vi.fn();
const syncSystemAccessAssignmentsForUserMock = vi.fn();

vi.mock('../../../../platform/db/connection.js', () => ({
  prisma: prismaMock,
  tenantScopedPrisma: prismaMock,
}));

vi.mock('../../../communications/domain/notifications/email.js', () => ({
  sendPasswordResetLinkEmail: sendPasswordResetLinkEmailMock,
  sendInviteLinkEmail: sendInviteLinkEmailMock,
}));

vi.mock('../../../../platform/audit/logger.js', () => ({
  AuditLogger: { log: auditLoggerMock },
}));

vi.mock('../permissionService.js', () => ({
  syncSystemAccessAssignmentsForUser: syncSystemAccessAssignmentsForUserMock,
}));

vi.mock('../../../../platform/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const PT_BASE = 'https://abbeygate-pt.facio.io';
const CY_BASE = 'https://abbeygate-cy.facio.io';
const TEST_OTP_SECRET = 'test-otp-secret';

const ENV_KEYS = ['OTP_SECRET', 'PUBLIC_APP_BASE_URL', 'FRONTEND_URL', 'APP_URL', 'APP_BASE_URL'] as const;

function expectedCodeHash(token: string): string {
  return crypto.createHash('sha256').update(`${token}:${TEST_OTP_SECRET}`).digest('hex');
}

function tokenFromUrl(rawUrl: string): string {
  const token = new URL(rawUrl).searchParams.get('token');
  if (!token) throw new Error(`expected token query param in ${rawUrl}`);
  return token;
}

describe('userLifecycleService — magic-link emission', () => {
  const envBackup: Record<string, string | undefined> = {};

  beforeEach(() => {
    vi.clearAllMocks();
    // Force a deterministic `OTP_SECRET` and simulate a hostile env where
    // every URL fallback channel points at CY — the service must use the
    // per-call `publicAppBaseUrl` argument, never these env values.
    for (const key of ENV_KEYS) envBackup[key] = process.env[key];
    process.env.OTP_SECRET = TEST_OTP_SECRET;
    process.env.PUBLIC_APP_BASE_URL = CY_BASE;
    process.env.FRONTEND_URL = CY_BASE;

    sendPasswordResetLinkEmailMock.mockResolvedValue(true);
    sendInviteLinkEmailMock.mockResolvedValue(true);
    userOtpMock.create.mockImplementation(async ({ data }) => ({ id: 'otp-1', ...data }));
    userOtpMock.delete.mockResolvedValue({});
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const prev = envBackup[key];
      if (prev === undefined) delete process.env[key];
      else process.env[key] = prev;
    }
  });

  describe('adminResetUserPassword', () => {
    it('mails a magic link built from the per-call publicAppBaseUrl (PT), NOT from PUBLIC_APP_BASE_URL (CY)', async () => {
      userMock.findUnique.mockResolvedValue({ id: 'u-1', email: 'pedro@example.pt' });

      const { adminResetUserPassword } = await import('../userLifecycleService.js');
      await adminResetUserPassword('u-1', 'admin-1', 'Admin', { publicAppBaseUrl: PT_BASE });

      expect(sendPasswordResetLinkEmailMock).toHaveBeenCalledTimes(1);
      const [arg] = sendPasswordResetLinkEmailMock.mock.calls[0];
      expect(arg.toEmail).toBe('pedro@example.pt');
      expect(arg.expiresHours).toBe(24);

      const url = new URL(arg.url);
      expect(`${url.protocol}//${url.host}`).toBe(PT_BASE);
      expect(url.host).not.toMatch(/abbeygate-cy/);
      expect(url.pathname).toBe('/auth/reset');
      expect(url.searchParams.get('token')).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    });

    it('persists sha256(token + OTP_SECRET) as the OTP codeHash so the mailed token can be redeemed via /confirm-link', async () => {
      userMock.findUnique.mockResolvedValue({ id: 'u-1', email: 'p@example.com' });

      const { adminResetUserPassword } = await import('../userLifecycleService.js');
      await adminResetUserPassword('u-1', 'admin-1', 'Admin', { publicAppBaseUrl: PT_BASE });

      const [otpCreateArgs] = userOtpMock.create.mock.calls[0];
      const [emailArgs] = sendPasswordResetLinkEmailMock.mock.calls[0];
      const mailedToken = tokenFromUrl(emailArgs.url);

      expect(otpCreateArgs.data.userId).toBe('u-1');
      expect(otpCreateArgs.data.purpose).toBe('PASSWORD_RESET');
      expect(otpCreateArgs.data.codeHash).toBe(expectedCodeHash(mailedToken));
      const ttlMs = otpCreateArgs.data.expiresAt.getTime() - Date.now();
      expect(ttlMs).toBeGreaterThan(24 * 3600 * 1000 - 5000);
    });

    it('cleans up the OTP row and throws EMAIL_SEND_FAILED when the email send returns falsy', async () => {
      userMock.findUnique.mockResolvedValue({ id: 'u-1', email: 'p@example.com' });
      sendPasswordResetLinkEmailMock.mockResolvedValueOnce(false);

      const { adminResetUserPassword } = await import('../userLifecycleService.js');
      await expect(
        adminResetUserPassword('u-1', 'admin-1', 'Admin', { publicAppBaseUrl: PT_BASE }),
      ).rejects.toMatchObject({ code: 'EMAIL_SEND_FAILED' });

      expect(userOtpMock.delete).toHaveBeenCalledWith({ where: { id: 'otp-1' } });
      expect(auditLoggerMock).not.toHaveBeenCalled();
    });

    it('throws USER_NOT_FOUND when the target user does not exist (no email, no OTP)', async () => {
      userMock.findUnique.mockResolvedValue(null);

      const { adminResetUserPassword } = await import('../userLifecycleService.js');
      await expect(
        adminResetUserPassword('missing', 'admin-1', 'Admin', { publicAppBaseUrl: PT_BASE }),
      ).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });

      expect(userOtpMock.create).not.toHaveBeenCalled();
      expect(sendPasswordResetLinkEmailMock).not.toHaveBeenCalled();
    });
  });

  describe('inviteUser', () => {
    beforeEach(() => {
      userMock.findUnique.mockResolvedValue(null);
      userMock.findFirst.mockResolvedValue(null);
      userMock.create.mockResolvedValue({ id: 'u-2', email: 'new@example.pt' });
    });

    it('mails an invite link using the per-call PT base URL, with the same /auth/reset path that the confirm-link endpoint serves', async () => {
      const { inviteUser } = await import('../userLifecycleService.js');
      await inviteUser({
        email: 'new@example.pt',
        firstName: 'Maria',
        lastName: 'Silva',
        invitedById: 'admin-1',
        invitedByName: 'Admin',
        publicAppBaseUrl: PT_BASE,
      });

      expect(sendInviteLinkEmailMock).toHaveBeenCalledTimes(1);
      const [arg] = sendInviteLinkEmailMock.mock.calls[0];
      expect(arg.toEmail).toBe('new@example.pt');
      expect(arg.firstName).toBe('Maria');
      expect(arg.invitedBy).toBe('Admin');
      expect(arg.expiresHours).toBe(24 * 7);

      const url = new URL(arg.url);
      expect(`${url.protocol}//${url.host}`).toBe(PT_BASE);
      expect(url.host).not.toMatch(/abbeygate-cy/);
      expect(url.pathname).toBe('/auth/reset');
      expect(url.searchParams.get('token')).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    });

    it('normalizes invite emails and rejects case-variant duplicates', async () => {
      userMock.findFirst.mockResolvedValueOnce({ id: 'existing-user' });

      const { inviteUser } = await import('../userLifecycleService.js');
      await expect(
        inviteUser({
          email: 'Effie@Abbeygate.CY',
          firstName: 'Effie',
          publicAppBaseUrl: PT_BASE,
        }),
      ).rejects.toMatchObject({ code: 'EMAIL_CONFLICT' });

      expect(userMock.findFirst).toHaveBeenCalledWith({
        where: { email: { equals: 'effie@abbeygate.cy', mode: 'insensitive' } },
        select: { id: true },
      });
      expect(userMock.create).not.toHaveBeenCalled();
      expect(sendInviteLinkEmailMock).not.toHaveBeenCalled();
    });

    it('mirrors the mailed token into both User.inviteToken and a UserOtp row with PASSWORD_RESET purpose', async () => {
      const { inviteUser } = await import('../userLifecycleService.js');
      await inviteUser({
        email: 'new@example.pt',
        firstName: 'Maria',
        invitedById: 'admin-1',
        invitedByName: 'Admin',
        publicAppBaseUrl: PT_BASE,
      });

      const [userCreateArgs] = userMock.create.mock.calls[0];
      const [otpCreateArgs] = userOtpMock.create.mock.calls[0];
      const [emailArgs] = sendInviteLinkEmailMock.mock.calls[0];
      const mailedToken = tokenFromUrl(emailArgs.url);

      expect(userCreateArgs.data.isActive).toBe(false);
      expect(typeof userCreateArgs.data.password).toBe('string');
      expect(userCreateArgs.data.password.length).toBeGreaterThan(20);
      expect(userCreateArgs.data.inviteToken).toBe(mailedToken);

      expect(otpCreateArgs.data.purpose).toBe('PASSWORD_RESET');
      expect(otpCreateArgs.data.userId).toBe('u-2');
      expect(otpCreateArgs.data.codeHash).toBe(expectedCodeHash(mailedToken));
    });

    it('cleans up the OTP row and throws EMAIL_SEND_FAILED when invite email cannot be sent', async () => {
      sendInviteLinkEmailMock.mockResolvedValueOnce(false);

      const { inviteUser } = await import('../userLifecycleService.js');
      await expect(
        inviteUser({
          email: 'new@example.pt',
          firstName: 'Maria',
          invitedById: 'admin-1',
          invitedByName: 'Admin',
          publicAppBaseUrl: PT_BASE,
        }),
      ).rejects.toMatchObject({ code: 'EMAIL_SEND_FAILED' });

      expect(userOtpMock.delete).toHaveBeenCalledWith({ where: { id: 'otp-1' } });
      // The User row stays so admins can still resend later (per service contract).
      expect(userMock.create).toHaveBeenCalledTimes(1);
      expect(auditLoggerMock).not.toHaveBeenCalled();
    });

    it('rejects with EMAIL_CONFLICT when the email already belongs to an existing user', async () => {
      userMock.findFirst.mockResolvedValueOnce({ id: 'existing' });

      const { inviteUser } = await import('../userLifecycleService.js');
      await expect(
        inviteUser({
          email: 'new@example.pt',
          firstName: 'Maria',
          invitedById: 'admin-1',
          publicAppBaseUrl: PT_BASE,
        }),
      ).rejects.toMatchObject({ code: 'EMAIL_CONFLICT' });

      expect(userMock.create).not.toHaveBeenCalled();
      expect(userOtpMock.create).not.toHaveBeenCalled();
      expect(sendInviteLinkEmailMock).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // updateUserProfile — name-recomputation contract (ABY-304)
  //
  // The denormalised `User.name` field is the canonical concat of
  // `firstName + lastName`. The service used to recompute it on every
  // write, which silently wiped `User.name` to null whenever the row
  // had `name` populated but `firstName`/`lastName` were null (legacy
  // imports, SSO-only users) and the operator edited a different
  // field. These tests pin the fix:
  //
  //   - When neither firstName nor lastName is in the request,
  //     `name` MUST NOT appear in the prisma.user.update payload.
  //   - When firstName or lastName IS in the request, `name` is
  //     recomputed from the explicit value(s) plus the existing
  //     value for whichever side wasn't sent.
  //   - When both are explicitly cleared, `name` collapses to null.
  // ────────────────────────────────────────────────────────────────────
  describe('updateUserProfile — name recomputation contract (ABY-304)', () => {
    beforeEach(() => {
      userMock.update.mockResolvedValue({
        id: 'u-1',
        name: null,
        firstName: null,
        lastName: null,
        email: 'p@example.com',
        phone: null,
        role: 'CUSTOMER',
        userType: 'CUSTOMER',
      });
      syncSystemAccessAssignmentsForUserMock.mockResolvedValue(undefined);
    });

    it('does NOT touch User.name when only role/phone/userType are updated (legacy-name preservation)', async () => {
      // Row has `name` set but firstName/lastName null — the legacy shape
      // that triggered ABY-304 in production.
      userMock.findUnique.mockResolvedValue({
        firstName: null,
        lastName: null,
        name: 'Effie Pavlou',
        phone: '+357 99 000000',
        userType: 'INTERNAL',
        role: 'UNDERWRITER',
      });

      const { updateUserProfile } = await import('../userLifecycleService.js');
      await updateUserProfile('u-1', { role: 'ADMIN' }, 'admin-1', 'Admin');

      expect(userMock.update).toHaveBeenCalledTimes(1);
      const [updateArgs] = userMock.update.mock.calls[0] as [{ where: { id: string }; data: Record<string, unknown> }];
      expect(updateArgs.where).toEqual({ id: 'u-1' });
      expect(updateArgs.data).not.toHaveProperty('name');
      expect(updateArgs.data).not.toHaveProperty('firstName');
      expect(updateArgs.data).not.toHaveProperty('lastName');
      // ABY-311: role change MUST bump tokenVersion to invalidate the
      // user's cached JWT — otherwise the change doesn't take effect
      // until 8h JWT expiry. See userLifecycleService comment for context.
      expect(updateArgs.data).toEqual({ role: 'ADMIN', tokenVersion: { increment: 1 } });
    });

    it('recomputes User.name when firstName is provided alongside an existing lastName', async () => {
      userMock.findUnique.mockResolvedValue({
        firstName: 'Old',
        lastName: 'Surname',
        name: 'Old Surname',
        phone: null,
        userType: 'INTERNAL',
        role: 'UNDERWRITER',
      });

      const { updateUserProfile } = await import('../userLifecycleService.js');
      await updateUserProfile('u-1', { firstName: 'New' }, 'admin-1', 'Admin');

      const [updateArgs] = userMock.update.mock.calls[0] as [{ data: Record<string, unknown> }];
      expect(updateArgs.data.firstName).toBe('New');
      expect(updateArgs.data.name).toBe('New Surname');
      expect(updateArgs.data).not.toHaveProperty('lastName');
    });

    it('recomputes User.name to null when both first and last are explicitly cleared', async () => {
      userMock.findUnique.mockResolvedValue({
        firstName: 'Effie',
        lastName: 'Pavlou',
        name: 'Effie Pavlou',
        phone: null,
        userType: 'INTERNAL',
        role: 'UNDERWRITER',
      });

      const { updateUserProfile } = await import('../userLifecycleService.js');
      await updateUserProfile('u-1', { firstName: '', lastName: '' }, 'admin-1', 'Admin');

      const [updateArgs] = userMock.update.mock.calls[0] as [{ data: Record<string, unknown> }];
      expect(updateArgs.data.firstName).toBe('');
      expect(updateArgs.data.lastName).toBe('');
      expect(updateArgs.data.name).toBeNull();
    });

    it('recomputes User.name from both fields when both are provided', async () => {
      userMock.findUnique.mockResolvedValue({
        firstName: null,
        lastName: null,
        name: null,
        phone: null,
        userType: 'INTERNAL',
        role: 'CUSTOMER',
      });

      const { updateUserProfile } = await import('../userLifecycleService.js');
      await updateUserProfile('u-1', { firstName: 'Maria', lastName: 'Silva' }, 'admin-1', 'Admin');

      const [updateArgs] = userMock.update.mock.calls[0] as [{ data: Record<string, unknown> }];
      expect(updateArgs.data.firstName).toBe('Maria');
      expect(updateArgs.data.lastName).toBe('Silva');
      expect(updateArgs.data.name).toBe('Maria Silva');
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // updateUserProfile — tokenVersion-bump contract (ABY-311)
  //
  // Production incident 2026-06-04 (yuval@facio.io): admin row had been
  // demoted to CUSTOMER. The operator manually edited role back to
  // ADMIN via this code path, but the user's existing JWT continued to
  // resolve them as CUSTOMER (frontend redirected to /client) until
  // someone clicked "Reset Password" — which DOES bump tokenVersion
  // and forced re-login. The fix bumps tokenVersion here whenever
  // role or userType actually changes, mirroring `suspendUser`.
  //
  // Phone / firstName / lastName edits MUST NOT bump tokenVersion —
  // those don't affect access decisions and shouldn't log the user out.
  // ────────────────────────────────────────────────────────────────────
  describe('updateUserProfile — tokenVersion bump on access-affecting change (ABY-311)', () => {
    beforeEach(() => {
      userMock.update.mockResolvedValue({
        id: 'u-1',
        name: null,
        firstName: null,
        lastName: null,
        email: 'p@example.com',
        phone: null,
        role: 'CUSTOMER',
        userType: 'CUSTOMER',
      });
      syncSystemAccessAssignmentsForUserMock.mockResolvedValue(undefined);
    });

    it('bumps tokenVersion when userType changes (INTERNAL → CUSTOMER)', async () => {
      userMock.findUnique.mockResolvedValue({
        firstName: 'Yuval',
        lastName: 'Oren',
        name: 'Yuval Oren',
        phone: null,
        userType: 'INTERNAL',
        role: 'ADMIN',
      });

      const { updateUserProfile } = await import('../userLifecycleService.js');
      await updateUserProfile('u-1', { userType: 'CUSTOMER' }, 'admin-1', 'Admin');

      const [updateArgs] = userMock.update.mock.calls[0] as [{ data: Record<string, unknown> }];
      expect(updateArgs.data.tokenVersion).toEqual({ increment: 1 });
      expect(updateArgs.data.userType).toBe('CUSTOMER');
    });

    it('does NOT bump tokenVersion when role is set to its CURRENT value (no-op edits stay non-disruptive)', async () => {
      userMock.findUnique.mockResolvedValue({
        firstName: null,
        lastName: null,
        name: null,
        phone: null,
        userType: 'INTERNAL',
        role: 'ADMIN',
      });

      const { updateUserProfile } = await import('../userLifecycleService.js');
      await updateUserProfile('u-1', { role: 'ADMIN' }, 'admin-1', 'Admin');

      const [updateArgs] = userMock.update.mock.calls[0] as [{ data: Record<string, unknown> }];
      expect(updateArgs.data).not.toHaveProperty('tokenVersion');
    });

    it('does NOT bump tokenVersion when only phone changes (phone is not access-affecting)', async () => {
      userMock.findUnique.mockResolvedValue({
        firstName: null,
        lastName: null,
        name: null,
        phone: '+357 99 000000',
        userType: 'INTERNAL',
        role: 'UNDERWRITER',
      });

      const { updateUserProfile } = await import('../userLifecycleService.js');
      await updateUserProfile('u-1', { phone: '+357 99 111111' }, 'admin-1', 'Admin');

      const [updateArgs] = userMock.update.mock.calls[0] as [{ data: Record<string, unknown> }];
      expect(updateArgs.data).not.toHaveProperty('tokenVersion');
      expect(updateArgs.data.phone).toBe('+357 99 111111');
    });

    it('does NOT bump tokenVersion when only firstName/lastName change (name is not access-affecting)', async () => {
      userMock.findUnique.mockResolvedValue({
        firstName: 'Old',
        lastName: 'Name',
        name: 'Old Name',
        phone: null,
        userType: 'INTERNAL',
        role: 'UNDERWRITER',
      });

      const { updateUserProfile } = await import('../userLifecycleService.js');
      await updateUserProfile('u-1', { firstName: 'New', lastName: 'Name' }, 'admin-1', 'Admin');

      const [updateArgs] = userMock.update.mock.calls[0] as [{ data: Record<string, unknown> }];
      expect(updateArgs.data).not.toHaveProperty('tokenVersion');
    });

    it('bumps tokenVersion exactly once when role AND userType both change in the same edit', async () => {
      userMock.findUnique.mockResolvedValue({
        firstName: null,
        lastName: null,
        name: null,
        phone: null,
        userType: 'CUSTOMER',
        role: 'CUSTOMER',
      });

      const { updateUserProfile } = await import('../userLifecycleService.js');
      await updateUserProfile('u-1', { role: 'ADMIN', userType: 'INTERNAL' }, 'admin-1', 'Admin');

      const [updateArgs] = userMock.update.mock.calls[0] as [{ data: Record<string, unknown> }];
      expect(updateArgs.data.tokenVersion).toEqual({ increment: 1 });
      expect(updateArgs.data.role).toBe('ADMIN');
      expect(updateArgs.data.userType).toBe('INTERNAL');
    });
  });
});

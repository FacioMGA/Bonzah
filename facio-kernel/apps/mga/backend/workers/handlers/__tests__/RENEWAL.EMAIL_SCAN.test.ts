import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runWithOperatingTenant } from '../../../platform/tenant/tenantAls.js';
import type { TenantConfig } from '../../../platform/tenant/tenantConfig.js';
import type { CustomerEmailTriggerDispatchInput } from '../../../modules/communications/app/customerEmailTriggerService.js';
import type { CommunicationDeliveryAttempt, CommunicationMessage, Prisma } from '@prisma/client';

type DispatchResult = { messageId?: string; skipped?: boolean; reason?: string };
type InvitationEvidence = Pick<CommunicationMessage, 'status' | 'provider' | 'createdAt' | 'deliveredAt' | 'externalRefs'> & {
  deliveryAttempts: Array<Pick<CommunicationDeliveryAttempt, 'status' | 'provider' | 'attemptedAt' | 'resolvedAt'>>;
};

function deliveredEvidence(deliveredAt: Date, overrides: Partial<InvitationEvidence> = {}): InvitationEvidence {
  return {
    status: 'DELIVERED',
    provider: 'SENDGRID',
    createdAt: new Date(deliveredAt.getTime() - 2000),
    deliveredAt,
    externalRefs: { trigger: 'RENEWAL_INVITE' },
    deliveryAttempts: [{ status: 'DELIVERED', provider: 'SENDGRID', attemptedAt: new Date(deliveredAt.getTime() - 1000), resolvedAt: deliveredAt }],
    ...overrides,
  };
}

const policyFindManyMock = vi.fn();
const communicationFindFirstMock =
  vi.fn<(args: Prisma.CommunicationMessageFindFirstArgs) => Promise<InvitationEvidence | null>>();
const renewalUpsertMock = vi.fn();
const dispatchMock =
  vi.fn<(input: CustomerEmailTriggerDispatchInput) => Promise<DispatchResult>>();
const runWithOperatingTenantByIdMock = vi.fn();

vi.mock('../../../platform/db/connection.js', () => {
  const prisma = {
    policy: { findMany: policyFindManyMock },
    communicationMessage: { findFirst: communicationFindFirstMock },
    renewalEmailState: { upsert: renewalUpsertMock },
  };
  return { prisma, tenantScopedPrisma: prisma };
});

vi.mock('../../../modules/communications/app/customerEmailTriggerService.js', () => ({
  dispatchCustomerEmailTrigger: dispatchMock,
}));

vi.mock('../../../platform/tenant/tenantJobContext.js', () => ({
  runWithOperatingTenantById: runWithOperatingTenantByIdMock,
}));

const loggerMocks = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

vi.mock('../../../platform/utils/logger.js', () => ({
  logger: loggerMocks,
}));

const PUBLIC_BASE_URL_ENV_KEYS = ['PUBLIC_APP_BASE_URL', 'FRONTEND_URL', 'APP_URL', 'APP_BASE_URL'] as const;

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

async function runEnabledScan(): Promise<void> {
  const mod = await import('../RENEWAL.EMAIL_SCAN.js');
  await runWithOperatingTenant(PT_TENANT, async () => {
    await mod.scanRenewalEmailsForCurrentTenant({ dispatchEnabled: true });
  });
}

describe('RENEWAL.EMAIL_SCAN handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    communicationFindFirstMock.mockResolvedValue(null);
    dispatchMock.mockResolvedValue({ messageId: 'msg-1' });
    runWithOperatingTenantByIdMock.mockImplementation(
      async (_tenantId: string, work: () => Promise<unknown>) =>
        runWithOperatingTenant(PT_TENANT, work),
    );
  });

  it.each(['bdx-import@import.local', '  BDX123@IMPORT.LOCAL  '])('skips imported placeholder %s without dispatching or advancing renewal state', async (email) => {
    const now = new Date('2026-09-06T12:00:00.000Z');
    policyFindManyMock.mockResolvedValue([{
      id: 'imported-policy', policyNumber: 'BDX-1', productType: 'HOME',
      expiryDate: new Date('2026-09-20T12:00:00.000Z'),
      quoteData: { proposer: { email, firstName: 'Imported' } }, renewalEmailState: null,
    }]);
    const { scanRenewalEmailsForCurrentTenant } = await import('../RENEWAL.EMAIL_SCAN.js');
    const summary = await runWithOperatingTenant(PT_TENANT, () => scanRenewalEmailsForCurrentTenant({ now, dispatchEnabled: true }));
    expect(summary).toMatchObject({ scanned: 1, skippedNoEmail: 1, invitesEligible: 0, invitesSent: 0, chasersSent: 0 });
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(renewalUpsertMock).not.toHaveBeenCalled();
    expect(loggerMocks.warn).toHaveBeenCalledWith(expect.objectContaining({ reason: 'IMPORTED_PLACEHOLDER_EMAIL', policyId: 'imported-policy' }), 'renewal.email_scan.skip_missing_email');
    expect(JSON.stringify(loggerMocks.warn.mock.calls)).not.toContain(email.trim().toLowerCase());
  });

  it('dispatches only the real contact in a mixed imported renewal batch', async () => {
    const now = new Date('2026-09-06T12:00:00.000Z');
    policyFindManyMock.mockResolvedValue(['missing@import.local', 'customer@example.com'].map((email, index) => ({
      id: `policy-${index}`, policyNumber: `REF-${index}`, productType: 'HOME',
      expiryDate: new Date('2026-09-20T12:00:00.000Z'),
      quoteData: { proposer: { email, firstName: 'Customer' } }, renewalEmailState: null,
    })));
    const { scanRenewalEmailsForCurrentTenant } = await import('../RENEWAL.EMAIL_SCAN.js');
    const summary = await runWithOperatingTenant(PT_TENANT, () => scanRenewalEmailsForCurrentTenant({ now, dispatchEnabled: true }));
    expect(summary).toMatchObject({ skippedNoEmail: 1, invitesEligible: 1, invitesSent: 1 });
    expect(dispatchMock).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ entityId: 'policy-1', toEmail: 'customer@example.com' }));
    expect(renewalUpsertMock).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ where: { policyId: 'policy-1' } }));
  });

  it('sends renewal invite for due policy and persists renewal state', async () => {
    const due = new Date();
    due.setDate(due.getDate() + 27);
    policyFindManyMock.mockResolvedValue([
      {
        id: 'policy-1',
        policyNumber: 'AB-001',
        productType: 'MOTOR',
        expiryDate: due,
        quoteData: { proposer: { email: 'customer@example.com', firstName: 'Avi' } },
        renewalEmailState: null,
      },
    ]);

    await runEnabledScan();

    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      trigger: 'RENEWAL_INVITE',
      entityId: 'policy-1',
      toEmail: 'customer@example.com',
      variables: expect.objectContaining({
        renewal: expect.objectContaining({
          homeUplift: { enabled: false, valuePct: 3 },
        }),
      }),
    }));
    expect(renewalUpsertMock).toHaveBeenCalled();
  });

  // ABY-85: home insurance renewal must trigger the same reminder
  // pipeline. The worker is product-agnostic, so a home policy in the
  // window with a proposer email must produce a `RENEWAL_INVITE`. This
  // test pins that ABY-85 is satisfied without product-specific code.
  it('sends RENEWAL_INVITE for HOME product policies (ABY-85 regression)', async () => {
    const due = new Date();
    due.setDate(due.getDate() + 21);
    policyFindManyMock.mockResolvedValue([
      {
        id: 'home-policy-1',
        policyNumber: 'HM-2026-001',
        productType: 'HOME',
        expiryDate: due,
        quoteData: { proposer: { email: 'home@example.com', firstName: 'Liav' } },
        renewalEmailState: null,
      },
    ]);

    await runEnabledScan();

    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      trigger: 'RENEWAL_INVITE',
      entityId: 'home-policy-1',
      toEmail: 'home@example.com',
      idempotencySeed: expect.stringContaining('HM-2026-001'),
    }));
    expect(renewalUpsertMock).toHaveBeenCalled();
  });

  // ABY-85: previously the bucket was a narrow window; a
  // single missed scan would silently drop the invite. The widened
  // bucket sends once when `dueInDays <= 28 && >= 1` and the
  // RenewalEmailState row keeps it idempotent.
  it('sends RENEWAL_INVITE when the policy is 28 days from expiry', async () => {
    const due = new Date();
    due.setDate(due.getDate() + 28);
    policyFindManyMock.mockResolvedValue([
      {
        id: 'policy-edge',
        policyNumber: 'AB-EDGE',
        productType: 'HOME',
        expiryDate: due,
        quoteData: { proposer: { email: 'edge@example.com', firstName: 'Edge' } },
        renewalEmailState: null,
      },
    ]);

    await runEnabledScan();

    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      trigger: 'RENEWAL_INVITE',
      entityId: 'policy-edge',
    }));
  });

  it('sends RENEWAL_CHASER at 7 days when the matching invitation was delivered at least 7 days ago', async () => {
    const due = new Date();
    due.setDate(due.getDate() + 7);
    const inviteSentAt = new Date();
    inviteSentAt.setDate(inviteSentAt.getDate() - 7);
    communicationFindFirstMock.mockResolvedValue(deliveredEvidence(inviteSentAt));
    policyFindManyMock.mockResolvedValue([
      {
        id: 'policy-chaser',
        policyNumber: 'AB-CHASER',
        productType: 'HOME',
        expiryDate: due,
        quoteData: { proposer: { email: 'chaser@example.com', firstName: 'Chaser' } },
        renewalEmailState: { inviteSentAt, chaserSentAt: null },
      },
    ]);

    await runEnabledScan();

    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      trigger: 'RENEWAL_CHASER',
      entityId: 'policy-chaser',
      toEmail: 'chaser@example.com',
    }));
    expect(communicationFindFirstMock).toHaveBeenCalledExactlyOnceWith({
      where: {
        thread: { entityType: 'POLICY', entityId: 'policy-chaser' },
        direction: 'OUTBOUND',
        channel: 'EMAIL',
        communicationType: 'EXTERNAL',
        toRecipients: { equals: ['chaser@example.com'] },
        AND: [
          { externalRefs: { path: ['trigger'], equals: 'RENEWAL_INVITE' } },
          { externalRefs: { path: ['template', 'variables', 'policy', 'number'], equals: 'AB-CHASER' } },
          { externalRefs: { path: ['template', 'variables', 'policy', 'renewalDate'], equals: due.toISOString().slice(0, 10) } },
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        status: true, provider: true, createdAt: true, deliveredAt: true, externalRefs: true,
        deliveryAttempts: {
          where: { channel: 'EMAIL' },
          orderBy: [{ attemptedAt: 'desc' }, { id: 'desc' }],
          take: 1,
          select: { status: true, provider: true, attemptedAt: true, resolvedAt: true },
        },
      },
    });
  });

  describe('chaser delivery evidence', () => {
    const now = new Date('2026-09-06T12:00:00.000Z');
    const deliveredAt = new Date('2026-08-30T12:00:00.000Z');

    beforeEach(() => {
      policyFindManyMock.mockResolvedValue([{
        id: 'policy-evidence', policyNumber: 'EVIDENCE-1', productType: 'HOME',
        expiryDate: new Date('2026-09-13T12:00:00.000Z'),
        quoteData: { proposer: { email: 'current@example.com', firstName: 'Customer' } },
        renewalEmailState: { inviteSentAt: new Date('2026-08-23T12:00:00.000Z'), chaserSentAt: null },
      }]);
    });

    async function scan(dispatchEnabled = true) {
      const { scanRenewalEmailsForCurrentTenant } = await import('../RENEWAL.EMAIL_SCAN.js');
      return runWithOperatingTenant(PT_TENANT, () => scanRenewalEmailsForCurrentTenant({ now, dispatchEnabled }));
    }

    async function expectDeferred() {
      expect(await scan()).toMatchObject({ chasersDeferred: 1, chasersEligible: 0, chasersSent: 0 });
      expect(dispatchMock).not.toHaveBeenCalled();
      expect(renewalUpsertMock).not.toHaveBeenCalled();
    }

    it('does not use a queue timestamp when no matching policy, term and recipient invitation exists', async () => {
      await expectDeferred();
      expect(communicationFindFirstMock).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          thread: { entityType: 'POLICY', entityId: 'policy-evidence' },
          toRecipients: { equals: ['current@example.com'] },
          AND: expect.arrayContaining([
            { externalRefs: { path: ['template', 'variables', 'policy', 'number'], equals: 'EVIDENCE-1' } },
            { externalRefs: { path: ['template', 'variables', 'policy', 'renewalDate'], equals: '2026-09-13' } },
          ]),
        }),
      }));
    });

    it.each<CommunicationMessage['status']>(['QUEUED', 'SENT', 'FAILED'])('rejects latest invitation status %s even with a stale delivered timestamp', async (status) => {
      communicationFindFirstMock.mockResolvedValue(deliveredEvidence(deliveredAt, { status }));
      await expectDeferred();
    });

    it.each<CommunicationDeliveryAttempt['status']>(['QUEUED', 'SENDING', 'SENT', 'BOUNCED', 'FAILED'])('rejects latest email attempt %s even when the message says delivered', async (status) => {
      communicationFindFirstMock.mockResolvedValue(deliveredEvidence(deliveredAt, {
        deliveryAttempts: [{ status, provider: 'SENDGRID', attemptedAt: new Date(deliveredAt.getTime() - 1000), resolvedAt: deliveredAt }],
      }));
      await expectDeferred();
    });

    it('rejects missing message delivery timestamp', async () => {
      communicationFindFirstMock.mockResolvedValue(deliveredEvidence(deliveredAt, { deliveredAt: null }));
      await expectDeferred();
    });

    it('rejects missing attempt evidence', async () => {
      communicationFindFirstMock.mockResolvedValue(deliveredEvidence(deliveredAt, { deliveryAttempts: [] }));
      await expectDeferred();
    });

    it('rejects missing attempt resolution timestamp', async () => {
      communicationFindFirstMock.mockResolvedValue(deliveredEvidence(deliveredAt, {
        deliveryAttempts: [{ status: 'DELIVERED', provider: 'SENDGRID', attemptedAt: new Date(deliveredAt.getTime() - 1000), resolvedAt: null }],
      }));
      await expectDeferred();
    });

    it('rejects attempt evidence from a different provider', async () => {
      communicationFindFirstMock.mockResolvedValue(deliveredEvidence(deliveredAt, {
        deliveryAttempts: [{ status: 'DELIVERED', provider: 'MANUAL', attemptedAt: new Date(deliveredAt.getTime() - 1000), resolvedAt: deliveredAt }],
      }));
      await expectDeferred();
    });

    it('rejects synthetic invitation delivery', async () => {
      communicationFindFirstMock.mockResolvedValue(deliveredEvidence(deliveredAt, {
        externalRefs: { trigger: 'RENEWAL_INVITE', synthetic: true },
      }));
      await expectDeferred();
    });

    it('rejects a stale delivered webhook assigned to a newer retry', async () => {
      communicationFindFirstMock.mockResolvedValue(deliveredEvidence(deliveredAt, {
        deliveryAttempts: [{ status: 'DELIVERED', provider: 'SENDGRID', attemptedAt: new Date(deliveredAt.getTime() + 1000), resolvedAt: deliveredAt }],
      }));
      await expectDeferred();
    });

    it('accepts legitimate same-second provider timestamp truncation after seven full days', async () => {
      const providerTimestamp = new Date(deliveredAt.getTime() - 1000);
      communicationFindFirstMock.mockResolvedValue(deliveredEvidence(providerTimestamp, {
        deliveryAttempts: [{ status: 'DELIVERED', provider: 'SENDGRID', attemptedAt: new Date(providerTimestamp.getTime() + 900), resolvedAt: providerTimestamp }],
      }));
      expect(await scan()).toMatchObject({ chasersEligible: 1, chasersSent: 1, chasersDeferred: 0 });
      expect(dispatchMock).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ trigger: 'RENEWAL_CHASER' }));
    });

    it('does not let second precision shorten the seven-day minimum after the actual attempt', async () => {
      communicationFindFirstMock.mockResolvedValue(deliveredEvidence(deliveredAt, {
        deliveryAttempts: [{ status: 'DELIVERED', provider: 'SENDGRID', attemptedAt: new Date(deliveredAt.getTime() + 900), resolvedAt: deliveredAt }],
      }));
      await expectDeferred();
    });

    it('rejects message delivery predating the latest attempt even with a newer attempt resolution', async () => {
      communicationFindFirstMock.mockResolvedValue(deliveredEvidence(deliveredAt, {
        deliveryAttempts: [{ status: 'DELIVERED', provider: 'SENDGRID', attemptedAt: new Date(deliveredAt.getTime() + 1000), resolvedAt: new Date(deliveredAt.getTime() + 2000) }],
      }));
      await expectDeferred();
    });

    it('rejects attempt evidence predating the invitation message', async () => {
      communicationFindFirstMock.mockResolvedValue(deliveredEvidence(deliveredAt, {
        createdAt: deliveredAt,
      }));
      await expectDeferred();
    });

    it('waits seven full days after delivery even when queue acceptance was older', async () => {
      communicationFindFirstMock.mockResolvedValue(deliveredEvidence(new Date(deliveredAt.getTime() + 1)));
      await expectDeferred();
    });

    it('uses the later canonical delivery timestamp if message and attempt differ', async () => {
      communicationFindFirstMock.mockResolvedValue(deliveredEvidence(deliveredAt, {
        deliveryAttempts: [{ status: 'DELIVERED', provider: 'SENDGRID', attemptedAt: new Date(deliveredAt.getTime() - 1000), resolvedAt: new Date(deliveredAt.getTime() + 1) }],
      }));
      await expectDeferred();
    });

    it('rejects future delivery timestamps', async () => {
      communicationFindFirstMock.mockResolvedValue(deliveredEvidence(new Date(now.getTime() + 1)));
      await expectDeferred();
    });

    it('records preview eligibility only after verified delivery without dispatch or state writes', async () => {
      communicationFindFirstMock.mockResolvedValue(deliveredEvidence(deliveredAt));
      expect(await scan(false)).toMatchObject({ chasersDeferred: 0, chasersEligible: 1, chasersSent: 0, dispatchEnabled: false });
      expect(dispatchMock).not.toHaveBeenCalled();
      expect(renewalUpsertMock).not.toHaveBeenCalled();
    });

    it('fails closed on a delivery evidence read error without advancing renewal state', async () => {
      communicationFindFirstMock.mockRejectedValueOnce(new Error('Evidence unavailable'));
      await expect(scan()).rejects.toThrow('Evidence unavailable');
      expect(dispatchMock).not.toHaveBeenCalled();
      expect(renewalUpsertMock).not.toHaveBeenCalled();
    });
  });

  it('advances past a full ineligible page so later policies are not starved', async () => {
    const now = new Date('2026-09-06T12:00:00.000Z');
    const expiryDate = new Date('2026-09-20T12:00:00.000Z');
    policyFindManyMock
      .mockResolvedValueOnce(Array.from({ length: 1000 }, (_, index) => ({
        id: `policy-${String(index).padStart(4, '0')}`, policyNumber: `REF-${index}`, productType: 'HOME',
        expiryDate, quoteData: { proposer: { email: 'missing@import.local' } }, renewalEmailState: null,
      })))
      .mockResolvedValueOnce([{
        id: 'policy-1000', policyNumber: 'REF-1000', productType: 'HOME', expiryDate,
        quoteData: { proposer: { email: 'real@example.com' } }, renewalEmailState: null,
      }]);
    const { scanRenewalEmailsForCurrentTenant } = await import('../RENEWAL.EMAIL_SCAN.js');
    const summary = await runWithOperatingTenant(PT_TENANT, () => scanRenewalEmailsForCurrentTenant({ now, dispatchEnabled: true }));
    expect(summary).toMatchObject({ scanned: 1001, skippedNoEmail: 1000, invitesEligible: 1, invitesSent: 1 });
    expect(policyFindManyMock).toHaveBeenCalledTimes(2);
    expect(policyFindManyMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({ id: { gt: 'policy-0999' }, status: { in: ['ISSUED', 'ACTIVE'] } }),
      orderBy: { id: 'asc' }, take: 1000,
    }));
    expect(dispatchMock).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ entityId: 'policy-1000' }));
  });

  it('defers the chaser when a catch-up invitation is missing', async () => {
    const due = new Date();
    due.setDate(due.getDate() + 6);
    policyFindManyMock.mockResolvedValue([{
      id: 'policy-catch-up',
      policyNumber: 'AB-CATCH-UP',
      productType: 'HOME',
      expiryDate: due,
      quoteData: { proposer: { email: 'catch-up@example.com', firstName: 'Catch-up' } },
      renewalEmailState: null,
    }]);

    const mod = await import('../RENEWAL.EMAIL_SCAN.js');
    const summary = await runWithOperatingTenant(PT_TENANT, () =>
      mod.scanRenewalEmailsForCurrentTenant({ dispatchEnabled: true }));

    expect(summary).toMatchObject({ invitesSent: 1, chasersSent: 0, chasersDeferred: 1 });
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({ trigger: 'RENEWAL_INVITE' }));
  });

  it('defers the chaser until seven full days have elapsed after the invitation', async () => {
    const due = new Date();
    due.setDate(due.getDate() + 6);
    const inviteSentAt = new Date();
    inviteSentAt.setDate(inviteSentAt.getDate() - 6);
    policyFindManyMock.mockResolvedValue([{
      id: 'policy-gap',
      policyNumber: 'AB-GAP',
      productType: 'HOME',
      expiryDate: due,
      quoteData: { proposer: { email: 'gap@example.com', firstName: 'Gap' } },
      renewalEmailState: { inviteSentAt, chaserSentAt: null },
    }]);

    const mod = await import('../RENEWAL.EMAIL_SCAN.js');
    const summary = await runWithOperatingTenant(PT_TENANT, () =>
      mod.scanRenewalEmailsForCurrentTenant({ dispatchEnabled: true }));

    expect(summary).toMatchObject({ chasersEligible: 0, chasersDeferred: 1, chasersSent: 0 });
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  // ABY-85: missing-email policies used to be silently skipped — there
  // was no signal at all. Now they must produce a structured warn log
  // so operators can spot policies that would never receive a reminder
  // (e.g. legacy imports without `quoteData.proposer.email`).
  it('emits a structured warn log when a renewing policy has no proposer email', async () => {
    const due = new Date();
    due.setDate(due.getDate() + 20);
    policyFindManyMock.mockResolvedValue([
      {
        id: 'policy-no-email',
        policyNumber: 'AB-NO-EMAIL',
        productType: 'HOME',
        expiryDate: due,
        quoteData: { proposer: { firstName: 'Nameless' } },
        renewalEmailState: null,
      },
    ]);

    await runEnabledScan();

    expect(dispatchMock).not.toHaveBeenCalled();
    expect(loggerMocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'renewal.email_scan.skip_missing_email',
        policyId: 'policy-no-email',
        productType: 'HOME',
      }),
      'renewal.email_scan.skip_missing_email',
    );
  });

  // Tenant-scoping regression. The renewal worker has no inbound HTTP
  // request, so the only way it can produce the right tenant's domain in
  // the link is via the worker entry-point's `runWith*OperatingTenant`
  // scope. If anyone reverts the URL builder back to reading
  // `process.env.PUBLIC_APP_BASE_URL` directly, this test will catch it.
  it('emits the renewal URL with the operating tenant publicBaseUrl (not the env var)', async () => {
    const envBackup: Record<string, string | undefined> = {};
    for (const key of PUBLIC_BASE_URL_ENV_KEYS) {
      envBackup[key] = process.env[key];
      // Hostile env: every fallback channel screams "CY". Only ALS should win.
      process.env[key] = 'https://abbeygate-cy.facio.io';
    }

    try {
      const due = new Date();
      due.setDate(due.getDate() + 20);
      policyFindManyMock.mockResolvedValue([
        {
          id: 'policy-pt-1',
          policyNumber: 'PT-001',
          productType: 'HOME',
          expiryDate: due,
          quoteData: { proposer: { email: 'cliente@example.pt', firstName: 'Maria' } },
          renewalEmailState: null,
        },
      ]);

      const mod = await import('../RENEWAL.EMAIL_SCAN.js');
      await runWithOperatingTenant(PT_TENANT, async () => {
        await mod.scanRenewalEmailsForCurrentTenant({ dispatchEnabled: true });
      });

      expect(dispatchMock).toHaveBeenCalledTimes(1);
      expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
        trigger: 'RENEWAL_INVITE',
        entityId: 'policy-pt-1',
        variables: expect.objectContaining({
          renewal: expect.objectContaining({
            url: 'https://abbeygate-pt.facio.io/policies/policy-pt-1/renewal',
          }),
        }),
      }));
      expect(dispatchMock).not.toHaveBeenCalledWith(expect.objectContaining({
        variables: expect.objectContaining({
          renewal: expect.objectContaining({
            url: expect.stringContaining('abbeygate-cy'),
          }),
        }),
      }));
    } finally {
      for (const key of PUBLIC_BASE_URL_ENV_KEYS) {
        const prev = envBackup[key];
        if (prev === undefined) delete process.env[key];
        else process.env[key] = prev;
      }
    }
  });

  it('restores the operating tenant carried by the scheduled event', async () => {
    policyFindManyMock.mockResolvedValue([]);
    const mod = await import('../RENEWAL.EMAIL_SCAN.js');

    await mod.runRenewalEmailScan({
      eventId: 'renewal-email-scan:event-1',
      data: {
        operatingTenantId: PT_TENANT.id,
        scheduledAt: '2026-09-04T12:00:00.000Z',
      },
    });

    expect(runWithOperatingTenantByIdMock).toHaveBeenCalledWith(PT_TENANT.id, expect.any(Function));
    expect(policyFindManyMock).toHaveBeenCalledTimes(1);
  });

  it('defaults to preview-only and records eligibility without dispatching', async () => {
    const due = new Date();
    due.setDate(due.getDate() + 20);
    policyFindManyMock.mockResolvedValue([{
      id: 'policy-preview',
      policyNumber: 'PT-PREVIEW',
      productType: 'HOME',
      expiryDate: due,
      quoteData: { proposer: { email: 'preview@example.pt', firstName: 'Preview' } },
      renewalEmailState: null,
    }]);
    const previous = process.env.RENEWAL_EMAIL_DISPATCH_ENABLED;
    delete process.env.RENEWAL_EMAIL_DISPATCH_ENABLED;

    try {
      const mod = await import('../RENEWAL.EMAIL_SCAN.js');
      const summary = await runWithOperatingTenant(PT_TENANT, () =>
        mod.scanRenewalEmailsForCurrentTenant());

      expect(summary).toMatchObject({
        scanned: 1,
        invitesEligible: 1,
        invitesSent: 0,
        dispatchEnabled: false,
      });
      expect(dispatchMock).not.toHaveBeenCalled();
      expect(renewalUpsertMock).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.RENEWAL_EMAIL_DISPATCH_ENABLED;
      else process.env.RENEWAL_EMAIL_DISPATCH_ENABLED = previous;
    }
  });

  it('rejects a scheduled event without an operating tenant id', async () => {
    const mod = await import('../RENEWAL.EMAIL_SCAN.js');

    await expect(mod.runRenewalEmailScan({ eventId: 'renewal-email-scan:event-1', data: {} }))
      .rejects.toThrow(/operatingTenantId/);
    expect(runWithOperatingTenantByIdMock).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runWithOperatingTenant } from '../../../platform/tenant/tenantAls.js';
import type { TenantConfig } from '../../../platform/tenant/tenantConfig.js';
import type { CustomerEmailTriggerDispatchInput } from '../../../modules/communications/app/customerEmailTriggerService.js';

type DispatchResult = { messageId?: string; skipped?: boolean; reason?: string };

const policyFindManyMock = vi.fn();
const renewalUpsertMock = vi.fn();
const dispatchMock =
  vi.fn<(input: CustomerEmailTriggerDispatchInput) => Promise<DispatchResult>>();

vi.mock('../../../platform/db/connection.js', () => {
  const prisma = {
    policy: { findMany: policyFindManyMock },
    renewalEmailState: { upsert: renewalUpsertMock },
  };
  return { prisma, tenantScopedPrisma: prisma };
});

vi.mock('../../../modules/communications/app/customerEmailTriggerService.js', () => ({
  dispatchCustomerEmailTrigger: dispatchMock,
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

// `handleRenewalEmailScan` only reads `job.data` (and the bound impl in
// these tests doesn't even read that). Constructing a full BullMQ `Job`
// fixture would couple the test to BullMQ internals, so we re-type the
// imported handler through a single function-type assertion to a narrower
// shape: `(job: { data: unknown }) => Promise<unknown>`. That's the
// minimal contract the handler actually needs from its argument.
type RenewalScanHandler = (job: { data: unknown }) => Promise<unknown>;

describe('RENEWAL.EMAIL_SCAN handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dispatchMock.mockResolvedValue({ messageId: 'msg-1' });
  });

  it('sends renewal invite for due policy and persists renewal state', async () => {
    const due = new Date();
    due.setDate(due.getDate() + 20);
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

    const mod = await import('../RENEWAL.EMAIL_SCAN.js');
    const handleRenewalEmailScan = mod.handleRenewalEmailScan as RenewalScanHandler;
    await handleRenewalEmailScan({ data: {} });

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

    const mod = await import('../RENEWAL.EMAIL_SCAN.js');
    const handleRenewalEmailScan = mod.handleRenewalEmailScan as RenewalScanHandler;
    await handleRenewalEmailScan({ data: {} });

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
  // bucket sends once when `dueInDays <= 21 && >= 1` and the
  // RenewalEmailState row keeps it idempotent.
  it('sends RENEWAL_INVITE when the policy is 21 days from expiry', async () => {
    const due = new Date();
    due.setDate(due.getDate() + 21);
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

    const mod = await import('../RENEWAL.EMAIL_SCAN.js');
    const handleRenewalEmailScan = mod.handleRenewalEmailScan as RenewalScanHandler;
    await handleRenewalEmailScan({ data: {} });

    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      trigger: 'RENEWAL_INVITE',
      entityId: 'policy-edge',
    }));
  });

  it('sends RENEWAL_CHASER when the policy is 9 days from expiry', async () => {
    const due = new Date();
    due.setDate(due.getDate() + 9);
    policyFindManyMock.mockResolvedValue([
      {
        id: 'policy-chaser',
        policyNumber: 'AB-CHASER',
        productType: 'HOME',
        expiryDate: due,
        quoteData: { proposer: { email: 'chaser@example.com', firstName: 'Chaser' } },
        renewalEmailState: { inviteSentAt: new Date(), chaserSentAt: null },
      },
    ]);

    const mod = await import('../RENEWAL.EMAIL_SCAN.js');
    const handleRenewalEmailScan = mod.handleRenewalEmailScan as RenewalScanHandler;
    await handleRenewalEmailScan({ data: {} });

    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      trigger: 'RENEWAL_CHASER',
      entityId: 'policy-chaser',
      toEmail: 'chaser@example.com',
    }));
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

    const mod = await import('../RENEWAL.EMAIL_SCAN.js');
    const handleRenewalEmailScan = mod.handleRenewalEmailScan as RenewalScanHandler;
    await handleRenewalEmailScan({ data: {} });

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
      const handleRenewalEmailScan = mod.handleRenewalEmailScan as RenewalScanHandler;
      await runWithOperatingTenant(PT_TENANT, async () => {
        await handleRenewalEmailScan({ data: {} });
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
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';

/**
 * EMAIL.UW_REFERRAL producer/consumer contract (Fixes ABBEYGATE-N, extended
 * for per-jurisdiction referral routing — Peter Sheppard, 24 Jul 2026).
 *
 * The handler accepts BOTH payload shapes: the legacy FLAT payload
 * (`policyId` at the top level — motor producer, sibling email producers)
 * and the canonical DomainEventEnvelope (payload under `data` — the
 * quoteRateService producer, which needs the envelope so the same outbox
 * row is ingestible by BEHAVIOR.NORMALIZE). ABBEYGATE-N was the handler
 * only parsing flat while a producer wrote the envelope; dual-shape
 * extraction removes that failure class in both directions.
 * Canonical producers: `backend/products/motor/quotes/service.ts` (motor)
 * and `backend/modules/quotes/app/quoteRateService.ts` (home/travel/health).
 *
 * Recipient contract: explicit `payload.to` wins; otherwise the handler
 * binds the policy's operating tenant and fans out to the jurisdiction's
 * underwriting team from `UW_REFERRAL_EMAILS_BY_COUNTRY` (tenantConfig).
 * The old env channel (UW_REFERRAL_EMAIL_TO / NOTIFICATIONS_EMAIL_TO) was
 * never configured in production, so every referral notification failed
 * with "no recipient available" — these tests pin the tenant-map routing.
 */

const dispatchMock = vi.fn(async (): Promise<{ skipped: boolean; reason?: string }> => ({
  skipped: false,
}));

vi.mock('../../../modules/communications/app/customerEmailTriggerService.js', () => ({
  dispatchCustomerEmailTrigger: (...args: unknown[]) => dispatchMock(...args),
}));

const runWithPolicyOperatingTenantMock = vi.fn(
  async (_policyId: string, fn: () => Promise<unknown>) => fn(),
);

vi.mock('../../../platform/tenant/tenantJobContext.js', () => ({
  runWithPolicyOperatingTenant: (policyId: string, fn: () => Promise<unknown>) =>
    runWithPolicyOperatingTenantMock(policyId, fn),
}));

// Mutable per-test tenant. `uwReferralEmailsForCountry` stays REAL so these
// tests pin the actual production recipient lists.
let currentCountryCode = 'CY';
let currentPublicBaseUrl = 'https://cy.abbeygate.com';

vi.mock('../../../platform/tenant/tenantConfig.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../platform/tenant/tenantConfig.js')>();
  return {
    ...actual,
    getTenantConfig: () => ({ countryCode: currentCountryCode }),
  };
});

vi.mock('../../../platform/http/publicAppLinks.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../platform/http/publicAppLinks.js')>();
  return {
    ...actual,
    resolvePublicAppBaseUrlFromTenant: () => currentPublicBaseUrl,
  };
});

const { handleEmailUwReferral } = await import('../EMAIL.UW_REFERRAL.js');

function asJob(data: unknown): Job {
  return { data } as unknown as Job;
}

function dispatchedRecipients(): string[] {
  return dispatchMock.mock.calls.map((call) => (call[0] as { toEmail: string }).toEmail);
}

// Per-jurisdiction routing confirmed 5 Aug 2026 (Danny / Peter / Andy F):
// CY (and Cyprus-serviced GR/ES/IT) → Danny; PT → the underwriting trio.
// Andy F is CC'd on his jurisdiction mailbox (.cy for CY-serviced, .pt for PT);
// yuval + Peter + Theodoros are the ALL-territory CC on every jurisdiction.
const CY_RECIPIENTS = [
  'danny@abbeygate.cy',
  'andy@abbeygate.cy',
  'yuval@facio.io',
  'peter@abbeygate.cy',
  'theo@abbeygate.cy',
];
const PT_RECIPIENTS = [
  'matt@abbeygate.pt',
  'ivan@abbeygate.pt',
  'francisco@abbeygate.pt',
  'andy@abbeygate.pt',
  'yuval@facio.io',
  'peter@abbeygate.cy',
  'theo@abbeygate.cy',
];

describe('EMAIL.UW_REFERRAL handler — payload extraction + per-jurisdiction routing', () => {
  beforeEach(() => {
    dispatchMock.mockClear();
    runWithPolicyOperatingTenantMock.mockClear();
    currentCountryCode = 'CY';
    currentPublicBaseUrl = 'https://cy.abbeygate.com';
  });

  it('binds the policy operating tenant before resolving recipients', async () => {
    await handleEmailUwReferral(asJob({ policyId: 'pol_123', reasons: [] }));
    expect(runWithPolicyOperatingTenantMock).toHaveBeenCalledTimes(1);
    expect(runWithPolicyOperatingTenantMock).toHaveBeenCalledWith('pol_123', expect.any(Function));
  });

  it('CY referral routes to Danny + Andy(.cy) + global CC', async () => {
    currentCountryCode = 'CY';
    await handleEmailUwReferral(
      asJob({
        policyId: 'pol_123',
        policyNumber: 'ABG-MOT-0001',
        quoteReference: 'Q-0001',
        reasons: ['Proposer is under 25 — requires underwriter referral per scheme.'],
      }),
    );
    expect(dispatchedRecipients()).toEqual(CY_RECIPIENTS);
    const arg = dispatchMock.mock.calls[0]![0] as {
      trigger: string;
      entityId: string;
      variables: { policy: { number: string }; uw: { adminUrl: string; message: string } };
    };
    // Dedicated internal template — UW_INFO_REQUEST's required `uw.url`
    // made every referral dispatch silently skip (see template test).
    expect(arg.trigger).toBe('UW_REFERRAL_RAISED');
    expect(arg.entityId).toBe('pol_123');
    expect(arg.variables.policy.number).toBe('ABG-MOT-0001');
    expect(arg.variables.uw.adminUrl).toBe(
      'https://cy.abbeygate.com/policies/pol_123#underwriting',
    );
    expect(arg.variables.uw.message).toContain(
      'Proposer is under 25 — requires underwriter referral per scheme.',
    );
  });

  it('PT referral routes to the underwriting trio + Andy(.pt) + global CC', async () => {
    currentCountryCode = 'PT';
    currentPublicBaseUrl = 'https://pt.abbeygate.com';
    await handleEmailUwReferral(asJob({ policyId: 'pol_pt', reasons: ['AGE_REFERRAL'] }));
    expect(dispatchedRecipients()).toEqual(PT_RECIPIENTS);
    const arg = dispatchMock.mock.calls[0]![0] as {
      variables: { uw: { adminUrl: string } };
    };
    expect(arg.variables.uw.adminUrl).toBe(
      'https://pt.abbeygate.com/policies/pol_pt#underwriting',
    );
  });

  it('GR referral is serviced by Cyprus (Danny + Andy(.cy) + global CC)', async () => {
    currentCountryCode = 'GR';
    await handleEmailUwReferral(asJob({ policyId: 'pol_gr', reasons: [] }));
    expect(dispatchedRecipients()).toEqual(CY_RECIPIENTS);
  });

  it('explicit payload.to overrides the tenant map (single dispatch)', async () => {
    currentCountryCode = 'PT';
    await handleEmailUwReferral(
      asJob({ policyId: 'pol_456', to: 'override@abbeygate.pt', reasons: [] }),
    );
    expect(dispatchedRecipients()).toEqual(['override@abbeygate.pt']);
  });

  it('works when only policyId + reasons are present (policyNumber/quoteReference optional)', async () => {
    await handleEmailUwReferral(asJob({ policyId: 'pol_789', reasons: [] }));
    const arg = dispatchMock.mock.calls[0]![0] as { variables: { policy: { number: string } } };
    // policyNumber falls back to policyId for display only — never invented.
    expect(arg.variables.policy.number).toBe('pol_789');
  });

  it('throws (no silent drop) when the dispatch reports a skip', async () => {
    dispatchMock.mockResolvedValueOnce({ skipped: true, reason: 'Missing variables: policy.number' });
    await expect(
      handleEmailUwReferral(asJob({ policyId: 'pol_skip', reasons: [] })),
    ).rejects.toThrow(/dispatch skipped/i);
  });

  it('accepts the canonical envelope shape (payload nested under data) — quoteRateService producer', async () => {
    currentCountryCode = 'CY';
    await handleEmailUwReferral(
      asJob({
        eventId: 'evt_1',
        eventType: 'EMAIL.UW_REFERRAL',
        aggregateType: 'POLICY',
        aggregateId: 'pol_999',
        occurredAt: new Date().toISOString(),
        data: {
          policyId: 'pol_999',
          policyNumber: 'ABG-HOM-0002',
          reasons: ['LOCAL_MARKET_NATIONALITY_REFERRAL: Proposer nationality Cyprus'],
        },
      }),
    );
    expect(dispatchedRecipients()).toEqual(CY_RECIPIENTS);
    const arg = dispatchMock.mock.calls[0]![0] as {
      entityId: string;
      variables: { policy: { number: string } };
    };
    expect(arg.entityId).toBe('pol_999');
    expect(arg.variables.policy.number).toBe('ABG-HOM-0002');
  });

  it('REGRESSION (ABBEYGATE-N): still rejects a payload with no policyId in either shape', async () => {
    await expect(
      handleEmailUwReferral(asJob({ eventType: 'EMAIL.UW_REFERRAL', reasons: [] })),
    ).rejects.toThrow();
    expect(dispatchMock).not.toHaveBeenCalled();
  });
});

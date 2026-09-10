import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../../../platform/events/queue.js', () => ({
  routeEventToQueue: vi.fn(),
}));
import { rateQuote } from '../../../../modules/quotes/app/publicAutoQuoteService.js';
import { tenantScopedPrisma } from '../../../../platform/db/connection.js';
import { registerAllProducts } from '../../../registerProducts.js';
import { runWithOperatingTenant } from '../../../../platform/tenant/tenantAls.js';
import { getTenantFixtures } from '../../../testHelpers/tenantFixtures.js';

registerAllProducts();

// The motor rating engine resolves jurisdiction config via `getTenantConfig()`
// (ADR-0019: ALS-only), so any `rateQuote` that reaches pricing must run inside
// an operating-tenant ALS scope. Wrap calls in CY, mirroring the pattern in the
// motor pricing tests (e.g. calculator.windscreenIncluded.test.ts).
const cyTenant = getTenantFixtures().find((t) => t.countryCode === 'CY')!;
const rateQuoteCY: typeof rateQuote = (args) => runWithOperatingTenant(cyTenant, () => rateQuote(args));

vi.mock('../../../../platform/db/connection.js', () => ({
  prisma: {
    policy: { findUnique: vi.fn(), update: vi.fn() },
    policyStateCurrent: { findUnique: vi.fn(), upsert: vi.fn() },
    policySearchIndex: { upsert: vi.fn() },
    priceCalculationAudit: { create: vi.fn(async () => ({ id: 'audit-1' })) },
    program: { findFirst: vi.fn(), findUnique: vi.fn() },
    outbox: { create: vi.fn() },
  },
  tenantScopedPrisma: {
    policy: { findUnique: vi.fn(), update: vi.fn() },
    policyStateCurrent: { findUnique: vi.fn(), upsert: vi.fn() },
    policySearchIndex: { upsert: vi.fn() },
    priceCalculationAudit: { create: vi.fn(async () => ({ id: 'audit-1' })) },
    program: { findFirst: vi.fn(), findUnique: vi.fn() },
    outbox: { create: vi.fn() },
    // Sanctions quote-gate (ABY-quote-screening) calls policyHolder lookup
    // for screening subject fallback via findFirst (PolicyHolder has only
    // `id` as @unique; relation to Policy is one-holder-many-policies).
    // The gate no-ops when no subject is resolved, so returning null keeps
    // existing test scenarios unchanged.
    policyHolder: { findFirst: vi.fn(async () => null) },
  },
}));

vi.mock('../../../../platform/audit/logger.js', () => ({
  AuditLogger: { log: vi.fn() },
}));

// Motor now screens at quote time on name + DOB (ADR-0043): the resolver
// reads `proposer.firstName/lastName/dateOfBirth`, so `rateQuote` reaches
// the sanctions gate. These tests exercise rating/coverage snapshot logic,
// not screening (which has dedicated coverage in the compliance module).
// Stub the sanctions service factory (its sole export) so the real gate
// runs but resolves without touching Prisma. Mocking the factory rather
// than the compliance barrel avoids an async-`importActual` race with the
// dynamic `import()` the motor service does under concurrent rating.
vi.mock('../../../../modules/compliance/app/serviceFactory.js', () => ({
  getSanctionsService: () => ({ assertClearOrThrow: vi.fn(async () => ({})) }),
}));

describe('rateQuote edge cases', () => {
  const futureRenewalDate = (() => {
    const date = new Date();
    date.setDate(date.getDate() + 7);
    return date.toISOString().slice(0, 10);
  })();

  const baseQuoteData = {
    proposer: {
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      phone: '+35799111222',
      dateOfBirth: '1988-01-01',
    },
    make: 'Toyota',
    model: 'Corolla',
    year: 2020,
    renewalDate: futureRenewalDate,
    coverRequired: 'Comprehensive',
    requiredExcess: '',
    vehicleType: 'Car',
    engineSize: 1800,
    vehicleValue: 30_000,
    kmsPerYear: 10000,
    ncb: '2 Years',
    licenseYears: 8,
    licenseType: 'Full',
    licenseIssuedIn: 'Cyprus',
    countryOfRegistration: 'Cyprus',
    hasClaims: false,
    hasConvictions: false,
    hasAdditionalDrivers: false,
    vehicleUse: 'SD&P',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.QUOTE_TOKEN_SECRET = 'test-secret';
    vi.mocked(tenantScopedPrisma.policy.findUnique).mockResolvedValue({
      id: 'pol-1',
      policyNumber: 'ABQ1',
      productType: 'MOTOR',
      status: 'DRAFT',
      isLocked: false,
      programId: null,
    });
    vi.mocked(tenantScopedPrisma.policyStateCurrent.findUnique).mockResolvedValue({ snapshot: {} });
    vi.mocked(tenantScopedPrisma.policy.update).mockResolvedValue({});
    vi.mocked(tenantScopedPrisma.policyStateCurrent.upsert).mockResolvedValue({});
    vi.mocked(tenantScopedPrisma.policySearchIndex.upsert).mockResolvedValue({});
  });

  it('routes to yellow-lane when declared value is >2x market value', async () => {
    const result = await rateQuoteCY({
      policyId: 'pol-1',
      quoteData: {
        ...baseQuoteData,
        vehicleValue: 50_000,
        marketValue: 20_000,
      },
    });
    expect(result.status).toBe('referral');
    expect((result.warnings || []).join(' ')).toContain('declared value');
    expect(result.underwritingAnalysis?.triggerCount).toBeGreaterThan(0);
    const persisted = vi.mocked(tenantScopedPrisma.policyStateCurrent.upsert).mock.calls.at(-1)?.[0];
    const snapshot = persisted?.update?.snapshot as Record<string, unknown>;
    const underwritingAnalysis = snapshot?.underwritingAnalysis as Record<string, unknown>;
    expect(String(underwritingAnalysis?.lane || '')).toBe('yellow');
    expect(
      Array.isArray(underwritingAnalysis?.triggers)
        && (underwritingAnalysis.triggers as Array<Record<string, unknown>>).some((trigger) =>
          String(trigger.code || '') === 'YELLOW.DECLARED_VALUE_GT_2X_MARKET_VALUE')
    ).toBe(true);
  });

  const uwReferralEventTypes = () =>
    vi
      .mocked(tenantScopedPrisma.outbox.create)
      .mock.calls.map((call) => (call?.[0]?.data as { eventType?: string } | undefined)?.eventType)
      .filter((eventType) => eventType === 'EMAIL.UW_REFERRAL');

  it('notifies the UW team when the value-mismatch yellow lane forces REFERRAL', async () => {
    const result = await rateQuoteCY({
      policyId: 'pol-1',
      quoteData: {
        ...baseQuoteData,
        vehicleValue: 50_000,
        marketValue: 20_000,
      },
    });
    expect(result.status).toBe('referral');
    // The value-mismatch lane is independent of uwDecision.outcome, so this
    // referral previously enqueued no EMAIL.UW_REFERRAL. It must now notify UW.
    expect(uwReferralEventTypes().length).toBeGreaterThan(0);
  });

  it('notifies the UW team when a BO override below the minimum excess forces REFERRAL', async () => {
    const result = await rateQuoteCY({
      policyId: 'pol-1',
      quoteData: { ...baseQuoteData, __meta: { origin: 'bo' } },
      overrideExcess: 1,
    });
    expect(result.status).toBe('referral');
    expect(uwReferralEventTypes().length).toBeGreaterThan(0);
  });

  it('keeps last write semantics under concurrent BO override rating', async () => {
    const state: { latest: Record<string, unknown> | null } = { latest: null };
    vi.mocked(tenantScopedPrisma.policyStateCurrent.upsert).mockImplementation(async (payload) => {
      const req = payload?.update?.snapshot?.pricing?.boOverrideApproval?.requestedOverrideExcess;
      if (req === 200) {
        await new Promise((r) => setTimeout(r, 20));
      }
      state.latest = payload?.update?.snapshot;
      return {};
    });

    const quoteData = {
      ...baseQuoteData,
      __meta: { origin: 'bo' },
    };

    await Promise.all([
      rateQuoteCY({ policyId: 'pol-1', quoteData, overrideExcess: 200 }),
      rateQuoteCY({ policyId: 'pol-1', quoteData, overrideExcess: 300 }),
    ]);

    // Because the 200-path is delayed, it writes last in this deterministic test.
    expect(state.latest?.pricing?.boOverrideApproval?.requestedOverrideExcess).toBe(200);
  });

  it('blocks rerating when policy is already active/issued-like', async () => {
    vi.mocked(tenantScopedPrisma.policy.findUnique).mockResolvedValueOnce({
      id: 'pol-1',
      policyNumber: 'ABQ1',
      productType: 'MOTOR',
      status: 'ACTIVE',
      isLocked: false,
      programId: null,
    });

    await expect(
      rateQuote({
        policyId: 'pol-1',
        quoteData: {
          ...baseQuoteData,
        },
      })
    ).rejects.toMatchObject({
      code: 'POLICY_NOT_EDITABLE',
      httpStatus: 409,
    });
  });

  it('blocks rating before quote-ready fields are complete', async () => {
    await expect(
      rateQuote({
        policyId: 'pol-1',
        quoteData: {
          ...baseQuoteData,
          proposer: { ...baseQuoteData.proposer, dateOfBirth: '' },
        },
      })
    ).rejects.toMatchObject({
      code: 'INVALID_QUOTE_DATA',
      httpStatus: 400,
      details: expect.objectContaining({
        missingSlugs: expect.arrayContaining(['proposer.dateOfBirth']),
      }),
    });
    expect(tenantScopedPrisma.policy.update).not.toHaveBeenCalled();
  });

  it('persists canonical coverageSelection snapshots for customer bundle choices', async () => {
    await rateQuoteCY({
      policyId: 'pol-1',
      quoteData: baseQuoteData,
      coverageSelection: {
        selected: { 'CV 172': true, 'COV-ROADSIDE-VIP': true },
        params: { 'CV 172': { limit_eur: 5000 } },
      },
    });

    expect(tenantScopedPrisma.policyStateCurrent.upsert).toHaveBeenCalled();
    const payload = vi.mocked(tenantScopedPrisma.policyStateCurrent.upsert).mock.calls[0]?.[0];
    const snapshot = payload?.update?.snapshot as Record<string, unknown>;
    const coverageSelection = snapshot?.coverageSelection as Record<string, unknown>;
    expect(coverageSelection?.schemaVersion).toBe(1);
    expect(coverageSelection?.source).toBe('CUSTOMER_RECS');
    expect((coverageSelection?.selected as Record<string, boolean>)?.['CV 172']).toBe(true);
    expect((coverageSelection?.params as Record<string, Record<string, unknown>>)?.['CV 172']).toEqual({ limit_eur: 5000 });
  });

  it('rejects retired selectedOptions coverage payloads', async () => {
    const retiredCoverageRequest: Parameters<typeof rateQuote>[0] & { selectedOptions: Record<string, boolean> } = {
      policyId: 'pol-1',
      quoteData: baseQuoteData,
      selectedOptions: { 'CV 172': true },
    };

    await expect(
      rateQuote(retiredCoverageRequest)
    ).rejects.toMatchObject({
      code: 'LEGACY_COVERAGE_SHAPE',
      httpStatus: 400,
    });
    expect(tenantScopedPrisma.policyStateCurrent.upsert).not.toHaveBeenCalled();
  });

  it('preserves stored coverageSelection when rerating without a new selection payload', async () => {
    vi.mocked(tenantScopedPrisma.policyStateCurrent.findUnique).mockResolvedValueOnce({
      snapshot: {
        coverageSelection: {
          schemaVersion: 1,
          source: 'USER_SELECTION',
          selected: {
            'COV-ROADSIDE-VIP': true,
            'CV 172': true,
          },
          params: {
            'COV-ROADSIDE-VIP': { target_vehicle_id: 'primary' },
          },
        },
      },
    });

    await rateQuoteCY({
      policyId: 'pol-1',
      quoteData: baseQuoteData,
    });

    const payload = vi.mocked(tenantScopedPrisma.policyStateCurrent.upsert).mock.calls.at(-1)?.[0];
    const snapshot = payload?.update?.snapshot as Record<string, unknown>;
    const coverageSelection = snapshot?.coverageSelection as Record<string, unknown>;
    expect((coverageSelection?.selected as Record<string, boolean>)?.['COV-ROADSIDE-VIP']).toBe(true);
    expect((coverageSelection?.selected as Record<string, boolean>)?.['CV 172']).toBe(true);
    expect((coverageSelection?.params as Record<string, Record<string, unknown>>)?.['COV-ROADSIDE-VIP']).toEqual({ target_vehicle_id: 'primary' });
  });
});

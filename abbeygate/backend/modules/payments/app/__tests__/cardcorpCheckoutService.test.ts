import { beforeEach, describe, expect, it, vi } from 'vitest';

const txMock = {
  policy: { update: vi.fn(async () => ({})) },
};

const tenantScopedPrismaMock = {
  policy: { update: vi.fn() },
  policyHolder: { findFirst: vi.fn(async () => null) },
  payment: {
    findFirst: vi.fn(),
    create: vi.fn(async () => ({ id: 'pay-1' })),
  },
  $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => await fn(txMock)),
};

// Sanctions screening now runs at checkout (pre-payment) — ADR-0067. Mock the
// compliance spine so these tests can drive it: clear by default, or throw a
// SanctionsBlockError to prove checkout is refused before OPPWA is called.
const assertClearOrThrowMock = vi.fn(async () => ({}));
class SanctionsBlockErrorMock extends Error {
  readonly code = 'SANCTIONS_BLOCK';
  readonly outcome: string;
  readonly reasonCode: string;
  readonly providerSearchId?: string;
  constructor(args: { message: string; outcome: string; reasonCode: string; providerSearchId?: string }) {
    super(args.message);
    this.name = 'SanctionsBlockError';
    this.outcome = args.outcome;
    this.reasonCode = args.reasonCode;
    this.providerSearchId = args.providerSearchId;
  }
}

const cardcorpCreateCheckoutMock = vi.fn(async (payload: Record<string, unknown>) => ({
  id: 'checkout-1',
  integrity: 'integrity-1',
  raw: { payload },
}));

// ABY-261 — the checkout boundary now ALWAYS re-rates via the canonical
// `ratePolicyAndPersist` service. These tests mock it so they can pin the
// contract: checkout total === `primaryOption.annualPremium` of the fresh
// rate, period. The old "legacy addonGrossPrices + basePremium" sum is gone.
const ratePolicyAndPersistMock = vi.fn();

vi.mock('../../../../platform/db/connection.js', () => ({
  prisma: {},
  tenantScopedPrisma: tenantScopedPrismaMock,
}));

vi.mock('../../../../platform/tenant/tenantConfig.js', () => ({
  getTenantConfig: () => ({ id: 'tenant-1', countryCode: 'CY' }),
}));

vi.mock('../../infra/cardcorpGateway.js', () => ({
  cardcorpCreateCheckout: (payload: Record<string, unknown>) => cardcorpCreateCheckoutMock(payload),
  formatAmountEUR: (value: number) => value.toFixed(2),
  safeMerchantTxId: (value: string) => value,
}));

vi.mock('../../../policy/infra/projections/policyListIndex.js', () => ({
  enqueuePolicyListIndexUpdate: vi.fn(),
}));

vi.mock('../../../policy/app/commands/policyLifecycleCommands.js', () => ({
  transitionPolicyLifecycle: vi.fn(async () => undefined),
}));

vi.mock('../../../policy/domain/ProductRegistry.js', () => ({
  ProductRegistry: {
    getInstance: () => ({
      getAdapter: (productType: string) => ({
        getRuntimeDefinition: () => ({ intake: { publicSessionSlug: String(productType).toLowerCase() } }),
      }),
    }),
  },
}));

vi.mock('../../../quotes/app/quoteRateService.js', () => ({
  ratePolicyAndPersist: (args: { policyId: string; productType: string }) => ratePolicyAndPersistMock(args),
}));

vi.mock('../../../compliance/app/index.js', () => ({
  getSanctionsService: () => ({ assertClearOrThrow: (input: unknown) => assertClearOrThrowMock(input) }),
  resolveIndividualScreeningSubject: (args: { policyHolderName?: string | null; quoteData?: unknown }) => {
    const proposer =
      (args.quoteData as { proposer?: { firstName?: string; lastName?: string } } | undefined)?.proposer ?? {};
    const name =
      [proposer.firstName, proposer.lastName].filter(Boolean).join(' ').trim() ||
      String(args.policyHolderName ?? '').trim();
    return name ? { subjectName: name } : null;
  },
  SanctionsBlockError: SanctionsBlockErrorMock,
}));

vi.mock('../../../../platform/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const basePolicy = {
  id: 'policy-1',
  policyNumber: 'Q-1',
  status: 'QUOTED' as const,
  productType: 'TRAVEL',
  quoteData: {
    proposer: {
      firstName: 'Ada',
      lastName: 'Traveller',
      email: 'ada@example.com',
      phone: '+35799111222',
      address: { line1: '1 Road', city: 'Nicosia', postcode: '1000' },
    },
  },
  // NB: stale quoteResponse — checkout must IGNORE this and use the fresh
  // rate result instead. Pinning this is the whole point of ABY-261.
  quoteResponse: { primaryOption: { annualPremium: 136.51 } },
  publicSessionToken: 'public-token-1',
};

const baseArgs = {
  publicPolicyRequestId: 'public-token-1',
  cfg: {
    entityId: 'entity-1',
    bearerToken: 'bearer-1',
    baseUrl: 'https://eu-test.oppwa.com',
    testMode: 'EXTERNAL' as const,
  },
  request: {
    protocol: 'http',
    host: 'localhost:5173',
    origin: 'http://localhost:5173',
    ip: '127.0.0.1',
  },
  parseRecord: (value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {},
  newPublicSessionToken: () => 'new-token',
};

describe('createCardcorpAutoCheckout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: screening clears so the premium-contract tests below stay focused.
    assertClearOrThrowMock.mockResolvedValue({});
    tenantScopedPrismaMock.policyHolder.findFirst.mockResolvedValue(null);
  });

  it('includes the policy product slug on the public quote return URL', async () => {
    ratePolicyAndPersistMock.mockResolvedValueOnce({
      ok: true,
      status: 'QUOTED',
      quoteData: basePolicy.quoteData,
      quoteResponse: { primaryOption: { annualPremium: 406.91 } },
      underwritingAnalysis: null,
    });
    const { createCardcorpAutoCheckout } = await import('../cardcorpCheckoutService.js');

    const result = await createCardcorpAutoCheckout({ ...baseArgs, policy: basePolicy });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const url = new URL(result.data.shopperResultUrl);
    expect(url.pathname).toBe('/quote/public-token-1');
    expect(url.searchParams.get('product')).toBe('travel');
    expect(url.searchParams.get('step')).toBe('payment');
    expect(url.searchParams.get('ref')).toBe('public-token-1');
    expect(cardcorpCreateCheckoutMock.mock.calls[0]?.[0]?.shopperResultUrl).toBeUndefined();
  });

  // ABY-261 — the boundary trusts the fresh rate, end of story. Even when
  // the stored `policy.quoteResponse` is stale (the Effie case), the
  // amount charged is `primaryOption.annualPremium` from the freshly
  // executed rate — NOT a reconstructed `basePremium + legacy addonGrossPrices`
  // sum (that math is deleted).
  it('charges the freshly rated primaryOption.annualPremium even when policy.quoteResponse is stale', async () => {
    vi.resetModules();
    ratePolicyAndPersistMock.mockResolvedValueOnce({
      ok: true,
      status: 'QUOTED',
      quoteData: { ...basePolicy.quoteData, addons: { businessCover: true, gadget: true, golf: true } },
      // Fresh rate: gross premium WITH the three addons baked in.
      quoteResponse: { primaryOption: { annualPremium: 206.51 } },
      underwritingAnalysis: null,
    });
    const { createCardcorpAutoCheckout } = await import('../cardcorpCheckoutService.js');

    const result = await createCardcorpAutoCheckout({
      ...baseArgs,
      policy: {
        ...basePolicy,
        // Deliberately stale — must be ignored.
        quoteResponse: { primaryOption: { annualPremium: 136.51 }, addonPrices: { businessCover: 20, gadget: 20, golf: 30 } },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.amount).toBe('206.51');
    expect(ratePolicyAndPersistMock).toHaveBeenCalledWith({ policyId: basePolicy.id, productType: 'TRAVEL' });
  });

  it('refuses checkout when the fresh rate comes back REFERRAL', async () => {
    vi.resetModules();
    ratePolicyAndPersistMock.mockResolvedValueOnce({
      ok: true,
      status: 'REFERRAL',
      quoteData: basePolicy.quoteData,
      quoteResponse: { primaryOption: { annualPremium: 0 }, status: 'REFERRAL' },
      underwritingAnalysis: null,
    });
    const { createCardcorpAutoCheckout } = await import('../cardcorpCheckoutService.js');

    const result = await createCardcorpAutoCheckout({ ...baseArgs, policy: basePolicy });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(422);
    expect(result.error.code).toBe('QUOTE_REFERRED');
  });

  it('refuses checkout when the fresh rate comes back DECLINED', async () => {
    vi.resetModules();
    ratePolicyAndPersistMock.mockResolvedValueOnce({
      ok: true,
      status: 'DECLINED',
      quoteData: basePolicy.quoteData,
      quoteResponse: { primaryOption: { annualPremium: 0 }, status: 'DECLINED' },
      underwritingAnalysis: null,
    });
    const { createCardcorpAutoCheckout } = await import('../cardcorpCheckoutService.js');

    const result = await createCardcorpAutoCheckout({ ...baseArgs, policy: basePolicy });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(422);
    expect(result.error.code).toBe('QUOTE_DECLINED');
  });

  it('surfaces rate-pipeline errors as checkout errors with the same status/code', async () => {
    vi.resetModules();
    ratePolicyAndPersistMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      code: 'MISSING_TRIP_DATES',
      message: 'Trip dates are required',
    });
    const { createCardcorpAutoCheckout } = await import('../cardcorpCheckoutService.js');

    const result = await createCardcorpAutoCheckout({ ...baseArgs, policy: basePolicy });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(result.error.code).toBe('MISSING_TRIP_DATES');
  });

  it('is safe for motor/home policies whose adapter has no addons (amount = fresh annualPremium)', async () => {
    vi.resetModules();
    ratePolicyAndPersistMock.mockResolvedValueOnce({
      ok: true,
      status: 'QUOTED',
      quoteData: basePolicy.quoteData,
      quoteResponse: { primaryOption: { annualPremium: 347.00 } },
      underwritingAnalysis: null,
    });
    const { createCardcorpAutoCheckout } = await import('../cardcorpCheckoutService.js');

    const result = await createCardcorpAutoCheckout({
      ...baseArgs,
      policy: { ...basePolicy, productType: 'MOTOR', policyNumber: 'Q-4', publicSessionToken: 'public-token-4', id: 'policy-4' },
      publicPolicyRequestId: 'public-token-4',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.amount).toBe('347.00');
    expect(ratePolicyAndPersistMock).toHaveBeenCalledWith({ policyId: 'policy-4', productType: 'MOTOR' });
  });

  // ADR-0067 — screening moved off quote and onto the pre-payment chokepoint.
  // A sanctioned/PEP match must stop the customer BEFORE the OPPWA checkout is
  // ever created, not just at post-payment issuance.
  it('refuses checkout and does NOT open OPPWA when screening returns a hard block', async () => {
    vi.resetModules();
    ratePolicyAndPersistMock.mockResolvedValueOnce({
      ok: true,
      status: 'QUOTED',
      quoteData: basePolicy.quoteData,
      quoteResponse: { primaryOption: { annualPremium: 200.0 } },
      underwritingAnalysis: null,
    });
    assertClearOrThrowMock.mockRejectedValueOnce(
      new SanctionsBlockErrorMock({ message: 'blocked', outcome: 'hits_found', reasonCode: 'SANCTIONS_HIT' }),
    );
    const { createCardcorpAutoCheckout } = await import('../cardcorpCheckoutService.js');

    const result = await createCardcorpAutoCheckout({ ...baseArgs, policy: basePolicy });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(409);
    expect(result.error.code).toBe('SANCTION_SCREENING_BLOCKED');
    // The customer-facing message must never reveal the sanctions match.
    expect(result.error.message.toLowerCase()).not.toContain('sanction');
    expect(cardcorpCreateCheckoutMock).not.toHaveBeenCalled();
  });

  // Fail-closed: a Creditsafe outage must block payment (503), not let an
  // unscreened customer pay — this is the Aug 2026 incident rule, moved to the
  // point money changes hands instead of stopping all quoting.
  it('blocks payment with 503 when the screening provider is unavailable', async () => {
    vi.resetModules();
    ratePolicyAndPersistMock.mockResolvedValueOnce({
      ok: true,
      status: 'QUOTED',
      quoteData: basePolicy.quoteData,
      quoteResponse: { primaryOption: { annualPremium: 200.0 } },
      underwritingAnalysis: null,
    });
    assertClearOrThrowMock.mockRejectedValueOnce(
      new SanctionsBlockErrorMock({ message: 'unavailable', outcome: 'provider_unavailable', reasonCode: 'PROVIDER_UNAVAILABLE' }),
    );
    const { createCardcorpAutoCheckout } = await import('../cardcorpCheckoutService.js');

    const result = await createCardcorpAutoCheckout({ ...baseArgs, policy: basePolicy });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(503);
    expect(result.error.code).toBe('SANCTION_SCREENING_UNAVAILABLE');
    expect(cardcorpCreateCheckoutMock).not.toHaveBeenCalled();
  });

  // Never charge a customer we could not identify: a placeholder-only name
  // resolves to no subject, so checkout is refused rather than opened.
  it('refuses checkout when only a placeholder identity is present', async () => {
    vi.resetModules();
    ratePolicyAndPersistMock.mockResolvedValueOnce({
      ok: true,
      status: 'QUOTED',
      quoteData: { proposer: {} },
      quoteResponse: { primaryOption: { annualPremium: 200.0 } },
      underwritingAnalysis: null,
    });
    const { createCardcorpAutoCheckout } = await import('../cardcorpCheckoutService.js');

    const result = await createCardcorpAutoCheckout({
      ...baseArgs,
      policy: { ...basePolicy, quoteData: { proposer: {} } },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(409);
    expect(result.error.code).toBe('SANCTION_SCREENING_SUBJECT_MISSING');
    expect(assertClearOrThrowMock).not.toHaveBeenCalled();
    expect(cardcorpCreateCheckoutMock).not.toHaveBeenCalled();
  });
});

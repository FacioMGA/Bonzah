import { describe, expect, it } from 'vitest';
import { travelGoldenFixtures } from './goldenFixtures.js';
import { travelProductRuntimeConfig as travelRuntimeDefinition } from './runtime.js';
import { runWithOperatingTenant } from '../../platform/tenant/tenantAls.js';
import { getTenantFixtures } from '../testHelpers/tenantFixtures.js';
import type { BuildQuoteResponseContext } from '../../modules/policy/domain/productContracts.js';
import { fixtureProgrammeDefinition, fixtureRatingModelTables } from '../programDefinitionFixtures.js';

// ADR-0019 — the travel calculator (`travelCalculator.calculateTravelPremium`)
// reads `getTenantConfig()` for sliding admin fees + per-tenant currency, so
// every test that goes through `runtime.buildQuoteResponse` must execute
// inside an ALS context. Wrap calls in `runInCY` to keep tests fail-closed
// instead of silently 500-ing in CI.
const cyTenant = getTenantFixtures().find((t) => t.countryCode === 'CY')!;
const runInCY = <T>(fn: () => Promise<T>): Promise<T> => runWithOperatingTenant(cyTenant, fn);

const travelFixtureRatingModel = fixtureRatingModelTables('TRAVEL');
if (!travelFixtureRatingModel) throw new Error('TRAVEL fixture rating model is required.');
const travelFixtureDefinition = fixtureProgrammeDefinition('TRAVEL');

const travelProductRuntimeConfig = {
  ...travelRuntimeDefinition,
  buildQuoteResponse(quoteData: unknown, context: BuildQuoteResponseContext = {}) {
    return travelRuntimeDefinition.buildQuoteResponse(quoteData, {
      ...context,
      programDefinition: travelFixtureDefinition,
      ratingModel: {
        id: 'travel-runtime-test-model',
        programId: travelFixtureDefinition.programId,
        version: 1,
        binderProductAuthorityId: travelFixtureDefinition.binderProductAuthorityId,
        tables: travelFixtureRatingModel,
      },
    });
  },
};

/**
 * Narrow shape of the parts of `quoteResponse` these tests read. Declared
 * locally so the test file does not bridge typed values through the
 * open-shape map casts that the diff-any guard flags as laundering.
 * The fields below mirror the canonical writer in
 * `backend/products/travel/runtime.ts`.
 */
type TravelQuoteResponseTestView = {
  primaryOption: {
    annualPremium?: number;
    noAddonGrossPremium?: number | null;
    breakdown: {
      addonBreakdown: Record<string, number>;
      lines: Array<{ code: string; amount: number; kind: string }>;
    };
  };
  addonPrices: Record<string, number>;
  addonGrossPrices?: unknown;
  planOptions: Record<string, { premium: number } | null>;
};

/**
 * Narrow view for a REFERRAL/DECLINED response where `primaryOption` is
 * null and the lane + reason codes are the contract surface (ADR-0054).
 * Declared separately from the QUOTED view above so neither has to carry
 * the other's nullability.
 */
type TravelUwLaneTestView = {
  status: string;
  primaryOption: unknown;
  uwDecision: { lane: string; reasons: Array<{ code: string }> };
};

function asTravelUwLaneView(value: unknown): TravelUwLaneTestView {
  return value as TravelUwLaneTestView;
}

function asTravelQuoteResponse(value: unknown): TravelQuoteResponseTestView {
  return value as TravelQuoteResponseTestView;
}

describe('travel addon price contract (ABY-272 — every addon matches the rate sheet)', () => {
  // The rate sheet (`backend/products/travel/pricing/data/brit-travel-2025.json`,
  // section `addons`) is the SINGLE writer for addon prices. Every
  // surface (Step 5 option card, breakdown.lines, BO Premium tab, PDF)
  // reads the same number through `calculateTravelPremium` →
  // `breakdown.addonBreakdown`. This table pins each addon × tripType
  // × travellerCount EUR amount so that future edits to the JSON, the
  // calculator, OR the runtime's `addonPrices` writer are caught by
  // CI before they ship.
  //
  // perTraveller addons: amount = travellerCount × value
  // loadPercent addons:  amount = basePremium × value
  const baseQuote = travelGoldenFixtures.minimumValid;

  it.each([
    // Multi-trip, single person (the trip type in the customer's
    // ABY-272 screenshot — Annual Gold MT, Europe, Single).
    { flag: 'businessCover',    tripType: 'annual_multi_trip', coverType: 'single', expected: 20 },
    { flag: 'gadget',           tripType: 'annual_multi_trip', coverType: 'single', expected: 40 },
    { flag: 'winterSports',     tripType: 'annual_multi_trip', coverType: 'single', expected: 50 },
    { flag: 'wedding',          tripType: 'annual_multi_trip', coverType: 'single', expected: 20 },
    { flag: 'golfCover',        tripType: 'annual_multi_trip', coverType: 'single', expected: 10 },
    { flag: 'terrorism',        tripType: 'annual_multi_trip', coverType: 'single', expected: 10 },
    { flag: 'sportsEquipment',  tripType: 'annual_multi_trip', coverType: 'single', expected: 25 },
    // Multi-trip, couple → perTraveller × 2.
    { flag: 'businessCover',    tripType: 'annual_multi_trip', coverType: 'couple', expected: 40 },
    { flag: 'gadget',           tripType: 'annual_multi_trip', coverType: 'couple', expected: 80 },
    // Multi-trip, family → perTraveller × 3.
    { flag: 'businessCover',    tripType: 'annual_multi_trip', coverType: 'family', expected: 60 },
    { flag: 'gadget',           tripType: 'annual_multi_trip', coverType: 'family', expected: 120 },
    // Single-trip, single person — gadget differs by trip type per the
    // rate sheet (20 single, 40 multi). winterSports is the loadPercent
    // case — asserted separately below because the amount is
    // base-premium-dependent.
    { flag: 'gadget',           tripType: 'single_trip',      coverType: 'single', expected: 20 },
    { flag: 'businessCover',    tripType: 'single_trip',      coverType: 'single', expected: 20 },
    { flag: 'wedding',          tripType: 'single_trip',      coverType: 'single', expected: 20 },
    { flag: 'golfCover',        tripType: 'single_trip',      coverType: 'single', expected: 10 },
    { flag: 'terrorism',        tripType: 'single_trip',      coverType: 'single', expected: 10 },
    { flag: 'sportsEquipment',  tripType: 'single_trip',      coverType: 'single', expected: 25 },
  ])(
    '$flag on $tripType / $coverType => €$expected',
    async ({ flag, tripType, coverType, expected }) => {
      const baseTrip: { planType?: string } = baseQuote.trip ?? {};
      const baseTravellers: { coverType?: string } = baseQuote.travellers ?? {};
      const baseQuoteParams: { selectedPlan?: string; maxTripDays?: number } = baseQuote.quote ?? {};
      const quote = {
        ...baseQuote,
        trip: { ...baseTrip, planType: tripType },
        travellers: { ...baseTravellers, coverType },
        // Multi-trip policies must declare `maxTripDays` (ADR-0018 —
        // no silent default). Single-trip ignores the field. 17 is the
        // smallest documented band so the test always hits a known cell.
        quote: { ...baseQuoteParams, maxTripDays: 17 },
      };
      const response = await runInCY(() =>
        travelProductRuntimeConfig.buildQuoteResponse(quote, { resolvedCoverageSet: null }),
      );
      const view = asTravelQuoteResponse(response.quoteResponse);
      expect(
        view.addonPrices[flag],
        `${flag} on ${tripType}/${coverType}: card price must equal rate sheet (€${expected})`,
      ).toBe(expected);
    },
  );

  it('winter sports SINGLE-TRIP is a 100% load on the base premium (loadPercent rule)', async () => {
    // The only addon with a loadPercent rule on single trip. Card
    // price must equal basePremium for the selected plan.
    const baseTrip: { planType?: string } = baseQuote.trip ?? {};
    const baseTravellers: { coverType?: string } = baseQuote.travellers ?? {};
    const baseQuoteParams: { selectedPlan?: string; maxTripDays?: number } = baseQuote.quote ?? {};
    const quote = {
      ...baseQuote,
      trip: { ...baseTrip, planType: 'single_trip' },
      travellers: { ...baseTravellers, coverType: 'single' },
      quote: { ...baseQuoteParams, maxTripDays: 17 },
    };
    const response = await runInCY(() =>
      travelProductRuntimeConfig.buildQuoteResponse(quote, { resolvedCoverageSet: null }),
    );
    const view = asTravelQuoteResponse(response.quoteResponse);
    const noAddonGross = Number(view.primaryOption.noAddonGrossPremium || 0);
    // The no-addon gross includes tax + admin fee; the rate sheet's
    // 100% load applies to the BASE premium (rate-table cell ×
    // single-trip cover multiplier). We derive the expected base from
    // the breakdown's `base` line, which is exactly the rate-table
    // value the loadPercent rule multiplies.
    const baseLine = view.primaryOption.breakdown.lines.find((line) => line.code === 'base');
    expect(baseLine).toBeDefined();
    expect(view.addonPrices.winterSports).toBe(baseLine?.amount);
    // Sanity — the load is real (and not bigger than the rest of the
    // entire quote, which would mean the multiplier was misread).
    expect(view.addonPrices.winterSports).toBeGreaterThan(0);
    expect(view.addonPrices.winterSports).toBeLessThan(noAddonGross);
  });

  it.each([
    { area: 'Europe', destinations: ['Germany'] },
    { area: 'Worldwide excluding USA + Canada', destinations: ['Japan'] },
    { area: 'Worldwide including USA + Canada', destinations: ['USA'] },
  ])(
    'perTraveller addons price the same across $area (ABY-272 area-invariance)',
    async ({ destinations }) => {
      // ABY-272 cross-area pin: the rate sheet declares businessCover,
      // gadget, golfCover, terrorism, sportsEquipment and wedding as
      // `perTraveller` rules. Those amounts depend ONLY on
      // travellerCount, NOT on destination area. The bug Effie hit
      // was visible in Europe, but the broken Δ-gross math could
      // have produced different drift on other areas (admin-fee
      // band shifts differ by base-premium tier). Pin that the per-
      // traveller addon prices are area-invariant — every area, same
      // €20 / €40 / €25 etc. — so a future drift on Worldwide quotes
      // would land here, not as a Marker.io ticket.
      const baseTrip: { planType?: string } = baseQuote.trip ?? {};
      const baseTravellers: { coverType?: string } = baseQuote.travellers ?? {};
      const baseQuoteParams: { selectedPlan?: string; maxTripDays?: number } = baseQuote.quote ?? {};
      const quote = {
        ...baseQuote,
        trip: { ...baseTrip, planType: 'annual_multi_trip', destinations },
        travellers: { ...baseTravellers, coverType: 'single' },
        quote: { ...baseQuoteParams, maxTripDays: 17 },
      };
      const response = await runInCY(() =>
        travelProductRuntimeConfig.buildQuoteResponse(quote, { resolvedCoverageSet: null }),
      );
      const view = asTravelQuoteResponse(response.quoteResponse);
      // Same rate-sheet values whether the customer is travelling to
      // Berlin, Tokyo, or New York.
      expect(view.addonPrices.businessCover).toBe(20);
      expect(view.addonPrices.gadget).toBe(40);
      expect(view.addonPrices.golfCover).toBe(10);
      expect(view.addonPrices.terrorism).toBe(10);
      expect(view.addonPrices.sportsEquipment).toBe(25);
      expect(view.addonPrices.wedding).toBe(20);
      expect(view.addonPrices.winterSports).toBe(50);
      // And every card price is exactly what the breakdown will
      // surface when the customer adds it — same number, every area.
      for (const flag of [
        'businessCover',
        'gadget',
        'golfCover',
        'terrorism',
        'sportsEquipment',
        'wedding',
        'winterSports',
      ] as const) {
        // Simulate the customer adding ONLY this addon; the matching
        // line in `breakdown.lines` must carry the same €X.
        const withFlag = await runInCY(() =>
          travelProductRuntimeConfig.buildQuoteResponse(
            { ...quote, addons: { ...quote.addons, [flag]: true } },
            { resolvedCoverageSet: null },
          ),
        );
        const withFlagView = asTravelQuoteResponse(withFlag.quoteResponse);
        const line = withFlagView.primaryOption.breakdown.lines.find((l) => l.code === `addon.${flag}`);
        expect(line, `expected breakdown line addon.${flag}`).toBeDefined();
        expect(line?.amount).toBe(view.addonPrices[flag]);
      }
    },
  );

  it('quoteResponse exposes addonPrices but NOT the legacy addonGrossPrices key (ABY-272 spine lock)', async () => {
    // Hard ban on dual pricing. The legacy `addonGrossPrices` field
    // (delta gross premium incl. admin-fee + IPT swings) is gone; any
    // re-introduction is caught here. If you NEED a delta calculation
    // for an operator surface, route it through
    // `calculateEndorsementPremium`, not via a new top-level field on
    // the quote response.
    const response = await runInCY(() =>
      travelProductRuntimeConfig.buildQuoteResponse(baseQuote, { resolvedCoverageSet: null }),
    );
    const view = asTravelQuoteResponse(response.quoteResponse);
    expect(view.addonPrices, 'quoteResponse must expose addonPrices').toBeDefined();
    expect(view.addonGrossPrices, 'quoteResponse must NOT carry the legacy addonGrossPrices field').toBeUndefined();
  });
});

describe('travel buildQuoteResponse uses resolvedCoverageSet', () => {
  const baseQuote = travelGoldenFixtures.minimumValid;

  it('adds addon premium when resolved coverage enables winter sports', async () => {
    const withoutCoverage = await runInCY(() => travelProductRuntimeConfig.buildQuoteResponse(baseQuote, { resolvedCoverageSet: null }));
    const withCoverage = await runInCY(() => travelProductRuntimeConfig.buildQuoteResponse(baseQuote, {
      resolvedCoverageSet: {
        productType: 'TRAVEL',
        programCode: 'abbeygate_travel',
        selectedCodes: ['TRAVEL-WINTER-SPORTS'],
        items: [],
        applied: [{ code: 'TRAVEL-WINTER-SPORTS' }],
      },
    }));
    const withoutPremium = Number((withoutCoverage.quoteResponse.primaryOption as Record<string, unknown>)?.annualPremium || 0);
    const withPremium = Number((withCoverage.quoteResponse.primaryOption as Record<string, unknown>)?.annualPremium || 0);
    expect(withPremium).toBeGreaterThan(withoutPremium);
  });

  it('keeps addonPrices stable across re-rates regardless of which addons are already applied (ABY-247)', async () => {
    // The "Wedding addon goes from €20 to €0 after navigating back to
    // Step 4 and forward to Step 5" bug. The per-addon prices the
    // wizard renders MUST be the cost of that addon against a clean
    // (no-addon) baseline, NOT against the current already-enriched
    // quote. Otherwise the first selection becomes sticky and silently
    // zeroes itself on the next re-rate, hiding the real cost from the
    // customer right before they pay.
    const firstRate = await runInCY(() => travelProductRuntimeConfig.buildQuoteResponse(baseQuote, {
      resolvedCoverageSet: null,
    }));
    const secondRate = await runInCY(() => travelProductRuntimeConfig.buildQuoteResponse(baseQuote, {
      resolvedCoverageSet: {
        productType: 'TRAVEL',
        programCode: 'abbeygate_travel',
        selectedCodes: ['TRAVEL-WEDDING'],
        items: [],
        applied: [{ code: 'TRAVEL-WEDDING' }],
      },
    }));

    const firstAddonPrices = asTravelQuoteResponse(firstRate.quoteResponse).addonPrices;
    const secondAddonPrices = asTravelQuoteResponse(secondRate.quoteResponse).addonPrices;

    // Wedding's price must be the same EUR amount on the second rate
    // as on the first — applying the endorsement upstream must NOT
    // collapse its own marginal to zero.
    expect(secondAddonPrices.wedding).toBeGreaterThan(0);
    expect(secondAddonPrices.wedding).toBe(firstAddonPrices.wedding);
    // Every other addon's price must also remain stable across the
    // two rate calls — the bug class was "applied addons go to 0", so
    // the contract is "all addon prices are independent of the
    // currently-applied set".
    for (const flag of Object.keys(firstAddonPrices)) {
      expect(secondAddonPrices[flag]).toBe(firstAddonPrices[flag]);
    }
  });

  it('addon card price EQUALS the breakdown.addonBreakdown line for the same flag (ABY-272 spine identity)', async () => {
    // The single most important pricing invariant on the wizard:
    // whatever number sits on the "+€X" stamp on an addon card MUST be
    // the same number the customer sees on the breakdown line for that
    // addon once they click Add. Pre-ABY-272 the card was Δ
    // grossPremium (rolled admin-fee + IPT swings in) and the
    // breakdown line was the net addon amount — two pricings for one
    // business concept on the same screen. If this test fails, the
    // dual-pricing spine break has been re-introduced.
    const withWedding = await runInCY(() => travelProductRuntimeConfig.buildQuoteResponse(baseQuote, {
      resolvedCoverageSet: {
        productType: 'TRAVEL',
        programCode: 'abbeygate_travel',
        selectedCodes: ['TRAVEL-WEDDING'],
        items: [],
        applied: [{ code: 'TRAVEL-WEDDING' }],
      },
    }));
    const view = asTravelQuoteResponse(withWedding.quoteResponse);
    const cardPrice = Number(view.addonPrices.wedding);
    expect(cardPrice).toBeGreaterThan(0);
    // Identity vs the underlying addon breakdown map.
    expect(cardPrice).toBe(view.primaryOption.breakdown.addonBreakdown.wedding);
    // Identity vs the canonical `breakdown.lines` array the wizard
    // sidebar, BO Premium tab and PDF all render — same number,
    // every surface.
    const weddingLine = view.primaryOption.breakdown.lines.find((line) => line.code === 'addon.wedding');
    expect(weddingLine).toBeDefined();
    expect(weddingLine?.amount).toBe(cardPrice);
  });

  it('exposes primaryOption.noAddonGrossPremium for the Step 4 plan picker comparison (ABY-251)', async () => {
    // Wizard Step 4 plan-picker renders the no-addon gross premium of
    // each tier so the customer's comparison is honest (otherwise the
    // numbers visibly inflate the moment they toggle an addon on Step
    // 5 and come back). ABY-272 retired the legacy
    // "noAddonGrossPremium + Σ addonGrossPrices === annualPremium"
    // reconciliation because admin fee and IPT scale with net premium
    // and don't belong on addon lines. The new spine is
    // `breakdown.lines` (ABY-264) — each line carries the truth for
    // itself. This test just pins that `noAddonGrossPremium` remains
    // a positive number bounded below the with-addons annualPremium.
    const withWedding = await runInCY(() => travelProductRuntimeConfig.buildQuoteResponse(baseQuote, {
      resolvedCoverageSet: {
        productType: 'TRAVEL',
        programCode: 'abbeygate_travel',
        selectedCodes: ['TRAVEL-WEDDING'],
        items: [],
        applied: [{ code: 'TRAVEL-WEDDING' }],
      },
    }));

    const primary = (withWedding.quoteResponse.primaryOption as Record<string, unknown>);
    const annualPremium = Number(primary.annualPremium || 0);
    const noAddonGrossPremium = Number(primary.noAddonGrossPremium || 0);

    expect(noAddonGrossPremium).toBeGreaterThan(0);
    expect(annualPremium).toBeGreaterThan(noAddonGrossPremium);
  });

  it('returns planOptions[*].premium as no-addon gross even when addons are applied (ABY-251)', async () => {
    // Step 4 plan picker shows planOptions[silver|gold|platinum].premium
    // to let the customer compare plans. Those numbers MUST be the
    // no-addon price of each tier — otherwise the moment the customer
    // toggles an addon on Step 5 and comes back to Step 4 to change
    // tier, every plan's price visibly inflates by the addon load,
    // misleading the comparison.
    const withoutAddons = await runInCY(() => travelProductRuntimeConfig.buildQuoteResponse(baseQuote, {
      resolvedCoverageSet: null,
    }));
    const withWedding = await runInCY(() => travelProductRuntimeConfig.buildQuoteResponse(baseQuote, {
      resolvedCoverageSet: {
        productType: 'TRAVEL',
        programCode: 'abbeygate_travel',
        selectedCodes: ['TRAVEL-WEDDING'],
        items: [],
        applied: [{ code: 'TRAVEL-WEDDING' }],
      },
    }));

    const noAddonOptions = (withoutAddons.quoteResponse as Record<string, unknown>).planOptions as Record<string, { premium: number } | null>;
    const withAddonOptions = (withWedding.quoteResponse as Record<string, unknown>).planOptions as Record<string, { premium: number } | null>;

    for (const plan of ['silver', 'gold', 'platinum'] as const) {
      const a = noAddonOptions[plan]?.premium;
      const b = withAddonOptions[plan]?.premium;
      expect(a).toBeDefined();
      expect(b).toBeDefined();
      // planOptions price MUST be identical regardless of addon selection.
      expect(b).toBe(a);
    }
  });

  it('honours quoteData.addons.* flags even when resolvedCoverageSet.applied is empty (ABY-258)', async () => {
    // Effie's session `KR6gpbSR…` had `quoteData.addons` carrying five
    // addon flags set to `true` (gadget, wedding, golfCover, terrorism,
    // businessCover) but the response landed with
    // `breakdown.addonsTotal: 0` because `context.resolvedCoverageSet.applied`
    // was empty — the MBE coverage resolver silently failed upstream.
    // Result: customer would have paid €352.68 instead of €552.68 and the
    // schedule would not have included any of the addons selected. The
    // already-issued ABOLV1000097 has the same shape — gadget=true in
    // quoteData but missing from the breakdown / schedule.
    //
    // `mergedAppliedEndorsements` is the defensive bridge that reads
    // `quoteData.addons.*` and feeds the canonical
    // `TRAVEL-<UPPERCASED-FLAG>` codes into the applied set when the
    // upstream resolver hasn't already supplied them.
    const quoteWithGadgetFlag = {
      ...baseQuote,
      addons: { ...baseQuote.addons, gadget: true },
    };

    const noResolved = await runInCY(() => travelProductRuntimeConfig.buildQuoteResponse(quoteWithGadgetFlag, {
      resolvedCoverageSet: null,
    }));
    const emptyApplied = await runInCY(() => travelProductRuntimeConfig.buildQuoteResponse(quoteWithGadgetFlag, {
      resolvedCoverageSet: {
        productType: 'TRAVEL',
        programCode: 'abbeygate_travel',
        selectedCodes: [],
        items: [],
        applied: [],
      },
    }));

    for (const result of [noResolved, emptyApplied]) {
      const primary = (result.quoteResponse.primaryOption as Record<string, unknown>);
      const breakdown = (primary.breakdown as Record<string, unknown>);
      const addonBreakdown = (breakdown.addonBreakdown as Record<string, number>);

      // The customer's intent (addons.gadget=true) MUST reach the rate.
      expect(Number(breakdown.addonsTotal || 0)).toBeGreaterThan(0);
      expect(addonBreakdown.gadget).toBeGreaterThan(0);
      // And annualPremium (the billed gross) MUST exceed the no-addon
      // baseline so the customer is actually charged for what they
      // selected.
      const annualPremium = Number(primary.annualPremium || 0);
      const noAddonGrossPremium = Number(primary.noAddonGrossPremium || 0);
      expect(annualPremium).toBeGreaterThan(noAddonGrossPremium);
    }
  });

  it('deduplicates when the same addon arrives via both quoteData.addons and resolvedCoverageSet.applied (ABY-258)', async () => {
    // Belt-and-suspenders: when the MBE resolver works AND quoteData
    // also carries the flag, only one endorsement is added to the
    // calculation — the marginal cost of `gadget` is added once, not
    // twice. The dedup happens in `mergedAppliedEndorsements` via a
    // set-based check on the uppercase code. Without dedup, the gadget
    // load would be double-counted and the customer overcharged by
    // exactly one gadget premium.
    const quoteWithGadgetFlag = {
      ...baseQuote,
      addons: { ...baseQuote.addons, gadget: true },
    };

    const flagOnly = await runInCY(() => travelProductRuntimeConfig.buildQuoteResponse(quoteWithGadgetFlag, {
      resolvedCoverageSet: null,
    }));
    const bothPaths = await runInCY(() => travelProductRuntimeConfig.buildQuoteResponse(quoteWithGadgetFlag, {
      resolvedCoverageSet: {
        productType: 'TRAVEL',
        programCode: 'abbeygate_travel',
        selectedCodes: ['TRAVEL-GADGET'],
        items: [],
        applied: [{ code: 'TRAVEL-GADGET' }],
      },
    }));

    const flagOnlyAnnual = Number((flagOnly.quoteResponse.primaryOption as Record<string, unknown>).annualPremium || 0);
    const bothAnnual = Number((bothPaths.quoteResponse.primaryOption as Record<string, unknown>).annualPremium || 0);

    // Same gadget addon, same premium — regardless of how many paths
    // surfaced it.
    expect(bothAnnual).toBeCloseTo(flagOnlyAnnual, 2);
  });

  it('does not regress ABY-247 price stability when addons arrive via quoteData.addons (ABY-258)', async () => {
    // The ABY-247 invariant: addon prices on `addonPrices` are
    // independent of the current selection. The ABY-258 merge MUST
    // not break this — i.e. `addonPrices.wedding` must be the
    // same EUR amount whether the customer has nothing selected or
    // already has gadget enabled via the raw flag path.
    const baseline = await runInCY(() => travelProductRuntimeConfig.buildQuoteResponse(baseQuote, {
      resolvedCoverageSet: null,
    }));
    const withGadgetFlag = await runInCY(() => travelProductRuntimeConfig.buildQuoteResponse({
      ...baseQuote,
      addons: { ...baseQuote.addons, gadget: true },
    }, { resolvedCoverageSet: null }));

    const baselinePrices = asTravelQuoteResponse(baseline.quoteResponse).addonPrices;
    const withGadgetPrices = asTravelQuoteResponse(withGadgetFlag.quoteResponse).addonPrices;

    for (const flag of Object.keys(baselinePrices)) {
      expect(withGadgetPrices[flag]).toBe(baselinePrices[flag]);
    }
  });

  it('breakdown.lines sum to primaryOption.annualPremium with the wedding addon applied (ABY-272 reconciliation)', async () => {
    // Replaces the legacy "annualPremium = noAddonGross + Σ
    // addonGrossPrices" loose reconciliation (which only held within
    // ±€25 of admin-fee swing). The new spine identity is exact: the
    // canonical `breakdown.lines` array sums to `annualPremium` row by
    // row, with the Total line stamped equal to the sum of every
    // preceding non-total row. This is the row the customer sees on
    // the wizard sidebar, BO Premium tab and PDF — and the row the
    // payment gateway charges.
    const withWedding = await runInCY(() => travelProductRuntimeConfig.buildQuoteResponse(baseQuote, {
      resolvedCoverageSet: {
        productType: 'TRAVEL',
        programCode: 'abbeygate_travel',
        selectedCodes: ['TRAVEL-WEDDING'],
        items: [],
        applied: [{ code: 'TRAVEL-WEDDING' }],
      },
    }));
    const view = asTravelQuoteResponse(withWedding.quoteResponse);
    const annualPremium = Number(view.primaryOption.annualPremium || 0);
    const totalLine = view.primaryOption.breakdown.lines.find((line) => line.kind === 'total');
    expect(totalLine).toBeDefined();
    expect(totalLine?.amount).toBeCloseTo(annualPremium, 2);

    const sumOfNonTotalLines = view.primaryOption.breakdown.lines
      .filter((line) => line.kind !== 'total')
      .reduce((acc, line) => acc + line.amount, 0);
    expect(Number(sumOfNonTotalLines.toFixed(2))).toBeCloseTo(annualPremium, 2);
  });
});

describe('travel prior-claims history end-to-end (ADR-0054)', () => {
  const baseQuote = travelGoldenFixtures.minimumValid;

  it('over €500 → REFERRAL with the UW-owned reason and no auto price', async () => {
    const response = await runInCY(() =>
      travelProductRuntimeConfig.buildQuoteResponse(
        { ...baseQuote, risk: { hasPreviousTravelClaim: true, previousTravelClaimBand: 'over_500' } },
        { resolvedCoverageSet: null },
      ),
    );
    const qr = asTravelUwLaneView(response.quoteResponse);
    expect(qr.status).toBe('REFERRAL');
    expect(qr.primaryOption).toBeNull();
    expect(qr.uwDecision.lane).toBe('referral');
    expect(qr.uwDecision.reasons.some((r) => r.code === 'PRIOR_TRAVEL_CLAIM_OVER_THRESHOLD')).toBe(true);
  });

  it('up to €500 → QUOTED with a claims-history loading line, priced above the no-claim quote', async () => {
    const noClaim = await runInCY(() =>
      travelProductRuntimeConfig.buildQuoteResponse(
        { ...baseQuote, risk: { hasPreviousTravelClaim: false } },
        { resolvedCoverageSet: null },
      ),
    );
    const withClaim = await runInCY(() =>
      travelProductRuntimeConfig.buildQuoteResponse(
        { ...baseQuote, risk: { hasPreviousTravelClaim: true, previousTravelClaimBand: 'up_to_500' } },
        { resolvedCoverageSet: null },
      ),
    );
    const view = asTravelQuoteResponse(withClaim.quoteResponse);
    const claimsLine = view.primaryOption.breakdown.lines.find((line) => line.code === 'loading.claims');
    expect(claimsLine, 'expected a loading.claims line').toBeDefined();
    expect(claimsLine?.amount).toBeGreaterThan(0);

    const withClaimPremium = Number(view.primaryOption.annualPremium || 0);
    const noClaimPremium = Number(asTravelQuoteResponse(noClaim.quoteResponse).primaryOption.annualPremium || 0);
    expect(withClaimPremium).toBeGreaterThan(noClaimPremium);
  });
});

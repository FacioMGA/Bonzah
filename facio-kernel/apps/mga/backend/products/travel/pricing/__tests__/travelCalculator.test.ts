import { describe, it, expect } from 'vitest';
import { calculateTravelPremium as calculateTravelPremiumWithRates, TravelQuoteValidationError } from '../travelCalculator.js';
import { loadBritTravelRates } from '../data/loader.js';
import { loadTravelFeeBands } from '../data/travel-fee-bands.loader.js';
import { runWithOperatingTenant } from '../../../../platform/tenant/tenantAls.js';
import { getTenantFixtures } from '../../../testHelpers/tenantFixtures.js';

// ADR-0019: getTenantConfig() is ALS-only — every test must wrap its
// calculation in runWithOperatingTenant.
const cyTenant = getTenantFixtures().find((t) => t.countryCode === 'CY')!;
const runInCY = <T>(fn: () => T): T => runWithOperatingTenant(cyTenant, fn);
const TRAVEL_RATING_TABLES = { rateCard: loadBritTravelRates(), adminFees: loadTravelFeeBands() };
const calculateTravelPremium = (input: Parameters<typeof calculateTravelPremiumWithRates>[0]) => calculateTravelPremiumWithRates(input, TRAVEL_RATING_TABLES);

describe('calculateTravelPremium', () => {
  it('rates a basic single-trip silver to Europe for a 35-year-old', () => {
    const today = new Date();
    const dob = new Date(today.getFullYear() - 35, today.getMonth(), today.getDate()).toISOString().slice(0, 10);
    const start = new Date().toISOString().slice(0, 10);
    const end = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const result = runInCY(() => calculateTravelPremium({
      eligibility: { countryOfResidence: 'Cyprus' },
      travellers: { coverType: 'single', leadTravellerDOB: dob },
      trip: { planType: 'single_trip', destinations: ['Spain', 'Italy'], startDate: start, endDate: end },
      quote: { selectedPlan: 'silver' },
      addons: {},
    }));

    expect(result.declined).toBe(false);
    expect(result.refer).toBe(false);
    expect(result.breakdown.basePremium).toBeGreaterThan(0);
    expect(result.breakdown.grossPremium).toBe(result.breakdown.netPremium + result.breakdown.iptAmount + result.breakdown.adminFee);
  });

  it('declines destinations that include Cuba', () => {
    const dob = new Date(new Date().getFullYear() - 40, 0, 1).toISOString().slice(0, 10);
    const start = new Date().toISOString().slice(0, 10);
    const end = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const result = runInCY(() => calculateTravelPremium({
      eligibility: { countryOfResidence: 'Cyprus' },
      travellers: { coverType: 'single', leadTravellerDOB: dob },
      trip: { planType: 'single_trip', destinations: ['Cuba'], startDate: start, endDate: end },
      quote: { selectedPlan: 'gold' },
    }));

    expect(result.declined).toBe(true);
    expect(result.declineReason).toMatch(/excluded country/i);
  });

  it('refers trips over 62 days (single-trip off-matrix)', () => {
    const dob = new Date(new Date().getFullYear() - 40, 0, 1).toISOString().slice(0, 10);
    const start = new Date().toISOString().slice(0, 10);
    const end = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const result = runInCY(() => calculateTravelPremium({
      eligibility: { countryOfResidence: 'Cyprus' },
      travellers: { coverType: 'single', leadTravellerDOB: dob },
      trip: { planType: 'single_trip', destinations: ['Spain'], startDate: start, endDate: end },
      quote: { selectedPlan: 'silver' },
    }));

    expect(result.refer).toBe(true);
  });

  it('refers travellers age 80+ with explicit REFER cell', () => {
    const dob = new Date(new Date().getFullYear() - 82, 0, 1).toISOString().slice(0, 10);
    const start = new Date().toISOString().slice(0, 10);
    // 8 days → resolveDayBand(8) = 9, a populated band; the 80+ row in
    // that cell is explicitly 'REFER'.
    const end = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const result = runInCY(() => calculateTravelPremium({
      eligibility: { countryOfResidence: 'Cyprus' },
      travellers: { coverType: 'single', leadTravellerDOB: dob },
      trip: { planType: 'single_trip', destinations: ['Spain'], startDate: start, endDate: end },
      quote: { selectedPlan: 'silver' },
    }));

    expect(result.refer).toBe(true);
    // Per ADR-0018 a REFER reason can be either an explicit REFER cell
    // ("manual review") or an off-matrix combination ("No rate cell").
    expect(result.reason).toMatch(/manual review|No rate cell/i);
  });

  it('applies single-trip winter sports as a 100% loading', () => {
    const dob = new Date(new Date().getFullYear() - 30, 0, 1).toISOString().slice(0, 10);
    const start = new Date().toISOString().slice(0, 10);
    // 8 days → resolveDayBand = 9 (populated). Day-band 5 is intentionally
    // off-matrix for Europe Individual silver (would have hit the deleted
    // neighbour-band fallback pre-PR-3); use 8 to land on a real cell.
    const end = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const base = runInCY(() => calculateTravelPremium({
      eligibility: { countryOfResidence: 'Cyprus' },
      travellers: { coverType: 'single', leadTravellerDOB: dob },
      trip: { planType: 'single_trip', destinations: ['Spain'], startDate: start, endDate: end },
      quote: { selectedPlan: 'silver' },
      addons: {},
    }));
    const withAddon = runInCY(() => calculateTravelPremium({
      eligibility: { countryOfResidence: 'Cyprus' },
      travellers: { coverType: 'single', leadTravellerDOB: dob },
      trip: { planType: 'single_trip', destinations: ['Spain'], startDate: start, endDate: end },
      quote: { selectedPlan: 'silver' },
      addons: { winterSports: true },
    }));
    expect(withAddon.breakdown.addonBreakdown.winterSports).toBeCloseTo(base.breakdown.basePremium, 2);
  });

  it('prices annual multi-trip winter sports and business cover per traveller', () => {
    const dob = new Date(new Date().getFullYear() - 30, 0, 1).toISOString().slice(0, 10);
    const start = new Date().toISOString().slice(0, 10);
    const end = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const result = runInCY(() => calculateTravelPremium({
      eligibility: { countryOfResidence: 'Cyprus' },
      travellers: { coverType: 'couple', leadTravellerDOB: dob },
      trip: { planType: 'annual_multi_trip', destinations: ['Spain'], startDate: start, endDate: end },
      // Pre-PR-3 the calculator silently defaulted to 17 days when
      // maxTripDays was missing; ADR-0018 requires it explicitly.
      quote: { selectedPlan: 'silver', maxTripDays: 17 },
      addons: { winterSports: true, businessCover: true },
    }));

    expect(result.breakdown.addonBreakdown.winterSports).toBe(100);
    expect(result.breakdown.addonBreakdown.businessCover).toBe(40);
  });

  it('rates multi-traveller cover from the oldest declared traveller DOB', () => {
    const leadDob = new Date(new Date().getFullYear() - 30, 0, 1).toISOString().slice(0, 10);
    const olderDob = new Date(new Date().getFullYear() - 55, 0, 1).toISOString().slice(0, 10);
    const start = new Date().toISOString().slice(0, 10);
    const end = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const result = runInCY(() => calculateTravelPremium({
      eligibility: { countryOfResidence: 'Cyprus' },
      travellers: { coverType: 'couple', travellerCount: 2, leadTravellerDOB: leadDob, additionalTravellerDOBs: [olderDob] },
      trip: { planType: 'annual_multi_trip', destinations: ['europe'], startDate: start, endDate: end },
      quote: { selectedPlan: 'silver', maxTripDays: 17 },
      addons: {},
    }));

    expect(result.refer).toBe(false);
    expect(result.breakdown.basePremium).toBe(80.6);
  });

  it('prices single-parent family from the workbook Family row', () => {
    const dob = new Date(new Date().getFullYear() - 35, 0, 1).toISOString().slice(0, 10);
    const start = new Date().toISOString().slice(0, 10);
    const end = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const result = runInCY(() => calculateTravelPremium({
      eligibility: { countryOfResidence: 'Cyprus' },
      travellers: {
        coverType: 'single_parent_family',
        travellerCount: 3,
        leadTravellerDOB: dob,
        additionalTravellerDOBs: ['2012-01-01', '2014-01-01'],
      },
      trip: { planType: 'annual_multi_trip', destinations: ['europe'], startDate: start, endDate: end },
      quote: { selectedPlan: 'silver', maxTripDays: 17 },
      addons: {},
    }));

    expect(result.refer).toBe(false);
    expect(result.breakdown.basePremium).toBe(110.16);
  });

  it('rates the canonical Worldwide including USA and Canada destination area', () => {
    const dob = new Date(new Date().getFullYear() - 30, 0, 1).toISOString().slice(0, 10);
    const start = new Date().toISOString().slice(0, 10);
    // 8 days → resolveDayBand = 9 (populated for both Europe and
    // WorldwideInc Individual silver). Day-band 5 isn't on the matrix.
    const end = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const europe = runInCY(() => calculateTravelPremium({
      eligibility: { countryOfResidence: 'Cyprus' },
      travellers: { coverType: 'single', leadTravellerDOB: dob },
      trip: { planType: 'single_trip', destinations: ['europe'], startDate: start, endDate: end },
      quote: { selectedPlan: 'silver' },
    }));
    const worldwideIncludingUsa = runInCY(() => calculateTravelPremium({
      eligibility: { countryOfResidence: 'Cyprus' },
      travellers: { coverType: 'single', leadTravellerDOB: dob },
      trip: { planType: 'single_trip', destinations: ['worldwide_including_usa_canada'], startDate: start, endDate: end },
      quote: { selectedPlan: 'silver' },
    }));

    expect(worldwideIncludingUsa.declined).toBe(false);
    expect(worldwideIncludingUsa.refer).toBe(false);
    expect(worldwideIncludingUsa.breakdown.basePremium).toBeGreaterThan(europe.breakdown.basePremium);
  });

  it('prices annual multi-trip by max trip days instead of policy end date', () => {
    const dob = new Date(new Date().getFullYear() - 30, 0, 1).toISOString().slice(0, 10);
    const start = new Date().toISOString().slice(0, 10);

    const annual = runInCY(() => calculateTravelPremium({
      eligibility: { countryOfResidence: 'Cyprus' },
      travellers: { coverType: 'single', leadTravellerDOB: dob },
      trip: {
        planType: 'annual_multi_trip',
        destinations: ['europe'],
        startDate: start,
        endDate: new Date(Date.now() + 364 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      },
      quote: { selectedPlan: 'silver', maxTripDays: 17 },
    }));

    expect(annual.declined).toBe(false);
    expect(annual.refer).toBe(false);
    expect(annual.breakdown.basePremium).toBe(42.99);
  });

  describe('ADR-0018 fail-closed inputs', () => {
    it('throws TravelQuoteValidationError(INVALID_DOB) for unparseable DOB', () => {
      expect(() => runInCY(() => calculateTravelPremium({
        eligibility: { countryOfResidence: 'Cyprus' },
        travellers: { coverType: 'single', leadTravellerDOB: 'not-a-date' },
        trip: { planType: 'single_trip', destinations: ['Spain'], startDate: '2026-06-01', endDate: '2026-06-05' },
        quote: { selectedPlan: 'silver' },
      }))).toThrow(TravelQuoteValidationError);
    });

    it('throws TravelQuoteValidationError(INVALID_TRIP_DATES) for unparseable trip dates', () => {
      const dob = new Date(new Date().getFullYear() - 35, 0, 1).toISOString().slice(0, 10);
      expect(() => runInCY(() => calculateTravelPremium({
        eligibility: { countryOfResidence: 'Cyprus' },
        travellers: { coverType: 'single', leadTravellerDOB: dob },
        trip: { planType: 'single_trip', destinations: ['Spain'], startDate: 'foo', endDate: 'bar' },
        quote: { selectedPlan: 'silver' },
      }))).toThrow(TravelQuoteValidationError);
    });

    it('throws TravelQuoteValidationError(MISSING_MAX_TRIP_DAYS) when annual policy omits maxTripDays', () => {
      const dob = new Date(new Date().getFullYear() - 35, 0, 1).toISOString().slice(0, 10);
      expect(() => runInCY(() => calculateTravelPremium({
        eligibility: { countryOfResidence: 'Cyprus' },
        travellers: { coverType: 'single', leadTravellerDOB: dob },
        trip: {
          planType: 'annual_multi_trip',
          destinations: ['europe'],
          startDate: '2026-01-01',
          endDate: '2026-12-31',
        },
        // quote.maxTripDays intentionally omitted
        quote: { selectedPlan: 'silver' },
      }))).toThrow(TravelQuoteValidationError);
    });

    it('REFERs (does not silently substitute) when no rate cell exists for the requested combination', () => {
      // Pick a combination genuinely off-matrix: Multi Trip with
      // maxTripDays = 62 resolves to dayBand 62, but the JSON only has
      // Multi Trip cells for dayBands {17, 31, 45}. (Single Trip
      // Couple/Family is no longer off-matrix per Andrew 2026-05-18 —
      // it's priced via singleTripCoverMultipliers.)
      const dob = new Date(new Date().getFullYear() - 30, 0, 1).toISOString().slice(0, 10);
      const start = new Date().toISOString().slice(0, 10);
      const end = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const result = runInCY(() => calculateTravelPremium({
        eligibility: { countryOfResidence: 'Cyprus' },
        travellers: { coverType: 'couple', leadTravellerDOB: dob },
        trip: { planType: 'annual_multi_trip', destinations: ['worldwide_including_usa_canada'], startDate: start, endDate: end },
        quote: { selectedPlan: 'silver', maxTripDays: 62 },
      }));
      expect(result.refer).toBe(true);
      expect(result.reason).toMatch(/No rate cell available/);
    });
  });

  describe('Single Trip Couple/Family pricing (Andrew 2026-05-18)', () => {
    // Per Andrew's clarification: BRIT Sept 2025 sheet only has Individual
    // rows for Single Trip; Couple/Family use the Individual rate × a
    // multiplier (Couple 1.9, Family 2.15). Single parent family reuses
    // the Family multiplier per existing platform convention.

    const TODAY_YEAR = new Date().getFullYear();
    const baseInputs = {
      eligibility: { countryOfResidence: 'Cyprus' as const },
      trip: {
        planType: 'single_trip' as const,
        destinations: ['Spain'],
        startDate: new Date().toISOString().slice(0, 10),
        endDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      },
      quote: { selectedPlan: 'silver' as const },
      addons: {},
    };

    function priceFor(coverType: 'single' | 'couple' | 'family' | 'single_parent_family') {
      const dob = new Date(TODAY_YEAR - 30, 0, 1).toISOString().slice(0, 10);
      return runInCY(() => calculateTravelPremium({
        ...baseInputs,
        travellers: { coverType, leadTravellerDOB: dob },
      }));
    }

    it('Individual = base rate (multiplier 1.0)', () => {
      // Silver / Single trip / Europe / Individual / 3 days / 18-35 = €12.04
      const result = priceFor('single');
      expect(result.refer).toBe(false);
      expect(result.declined).toBe(false);
      expect(result.breakdown.basePremium).toBe(12.04);
    });

    it('Couple = base rate × 1.9', () => {
      const result = priceFor('couple');
      expect(result.refer).toBe(false);
      expect(result.declined).toBe(false);
      // 12.04 × 1.9 = 22.876 → 22.88 (round2)
      expect(result.breakdown.basePremium).toBe(22.88);
    });

    it('Family = base rate × 2.15', () => {
      const result = priceFor('family');
      expect(result.refer).toBe(false);
      expect(result.declined).toBe(false);
      // 12.04 × 2.15 = 25.886 → 25.89 (round2)
      expect(result.breakdown.basePremium).toBe(25.89);
    });

    it('Single parent family reuses the Family multiplier (existing platform convention)', () => {
      const result = priceFor('single_parent_family');
      expect(result.refer).toBe(false);
      expect(result.declined).toBe(false);
      expect(result.breakdown.basePremium).toBe(25.89);
    });

    it('Multi Trip Couple uses the direct Couple rate cell, NOT the multiplier', () => {
      // Silver / Multi trip / Europe / Couple / 17 days / 18-35 = €67.16
      // (NOT Individual €42.99 × 1.9 = €81.68 — confirms direct lookup.)
      const dob = new Date(TODAY_YEAR - 30, 0, 1).toISOString().slice(0, 10);
      const start = new Date().toISOString().slice(0, 10);
      const end = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const result = runInCY(() => calculateTravelPremium({
        eligibility: { countryOfResidence: 'Cyprus' },
        travellers: { coverType: 'couple', leadTravellerDOB: dob },
        trip: { planType: 'annual_multi_trip', destinations: ['Spain'], startDate: start, endDate: end },
        quote: { selectedPlan: 'silver', maxTripDays: 17 },
        addons: {},
      }));
      expect(result.refer).toBe(false);
      expect(result.breakdown.basePremium).toBe(67.16);
    });

    it('Multi Trip Family uses the direct Family rate cell, NOT the multiplier', () => {
      // Silver / Multi trip / Europe / Family / 17 days / 18-35 = €110.16
      const dob = new Date(TODAY_YEAR - 30, 0, 1).toISOString().slice(0, 10);
      const start = new Date().toISOString().slice(0, 10);
      const end = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const result = runInCY(() => calculateTravelPremium({
        eligibility: { countryOfResidence: 'Cyprus' },
        travellers: { coverType: 'family', leadTravellerDOB: dob },
        trip: { planType: 'annual_multi_trip', destinations: ['Spain'], startDate: start, endDate: end },
        quote: { selectedPlan: 'silver', maxTripDays: 17 },
        addons: {},
      }));
      expect(result.refer).toBe(false);
      expect(result.breakdown.basePremium).toBe(110.16);
    });
  });

  describe('sliding admin fee (Andy 2026-05-16)', () => {
    // Per Andy's directive: fees apply on NET premium, Travel-only.
    //   ≤ €70  → €7
    //   71–200 → €18
    //   201+   → €25
    // We exercise each band by picking rate cells whose value falls
    // into that band (Silver / Single trip / Europe / Individual / 3
    // days has the cheapest rates). Add-ons disabled to keep net
    // predictable.

    function runForCheapBand(): ReturnType<typeof calculateTravelPremium> {
      // Silver / Single trip / Europe / Individual / 3 days / 18-35 = €12.04
      const dob = new Date(new Date().getFullYear() - 30, 0, 1).toISOString().slice(0, 10);
      const start = new Date().toISOString().slice(0, 10);
      const end = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      return runInCY(() => calculateTravelPremium({
        eligibility: { countryOfResidence: 'Cyprus' },
        travellers: { coverType: 'single', leadTravellerDOB: dob },
        trip: { planType: 'single_trip', destinations: ['Spain'], startDate: start, endDate: end },
        quote: { selectedPlan: 'silver' },
        addons: {},
      }));
    }

    function runForMidBand(): ReturnType<typeof calculateTravelPremium> {
      // Silver / Single trip / WorldwideInc / Individual / 23 days / 18-35
      // = €42.96 + 1 winter-sports load (100% = €42.96) → net €85.92
      const dob = new Date(new Date().getFullYear() - 30, 0, 1).toISOString().slice(0, 10);
      const start = new Date().toISOString().slice(0, 10);
      const end = new Date(Date.now() + 23 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      return runInCY(() => calculateTravelPremium({
        eligibility: { countryOfResidence: 'Cyprus' },
        travellers: { coverType: 'single', leadTravellerDOB: dob },
        trip: { planType: 'single_trip', destinations: ['worldwide_including_usa_canada'], startDate: start, endDate: end },
        quote: { selectedPlan: 'silver' },
        addons: { winterSports: true },
      }));
    }

    function runForTopBand(): ReturnType<typeof calculateTravelPremium> {
      // Platinum / Single trip / WorldwideInc / Individual / 62 days / 36-50
      // = €157.38 — well into the €201+ band after IPT/addons-free
      const dob = new Date(new Date().getFullYear() - 40, 0, 1).toISOString().slice(0, 10);
      const start = new Date().toISOString().slice(0, 10);
      const end = new Date(Date.now() + 62 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      return runInCY(() => calculateTravelPremium({
        eligibility: { countryOfResidence: 'Cyprus' },
        travellers: { coverType: 'single', leadTravellerDOB: dob },
        trip: { planType: 'single_trip', destinations: ['worldwide_including_usa_canada'], startDate: start, endDate: end },
        quote: { selectedPlan: 'platinum' },
        addons: { winterSports: true },
      }));
    }

    it('applies €7 fee for net premium ≤ €70', () => {
      const result = runForCheapBand();
      expect(result.breakdown.netPremium).toBeLessThanOrEqual(70);
      expect(result.breakdown.adminFee).toBe(7);
    });

    it('applies €18 fee for net premium €71–€200', () => {
      const result = runForMidBand();
      expect(result.breakdown.netPremium).toBeGreaterThan(70);
      expect(result.breakdown.netPremium).toBeLessThanOrEqual(200);
      expect(result.breakdown.adminFee).toBe(18);
    });

    it('applies €25 fee for net premium > €200', () => {
      const result = runForTopBand();
      expect(result.breakdown.netPremium).toBeGreaterThan(200);
      expect(result.breakdown.adminFee).toBe(25);
    });
  });

  describe('JSON-driven add-ons (Andy 2026-05-16)', () => {
    // Each test picks a single add-on and asserts the resolved amount
    // matches the per-trip-type rule from the active-sale Excel.

    function buildBase(addons: Record<string, boolean>, opts?: { multiTrip?: boolean; coverType?: string }): ReturnType<typeof calculateTravelPremium> {
      const dob = new Date(new Date().getFullYear() - 30, 0, 1).toISOString().slice(0, 10);
      const start = new Date().toISOString().slice(0, 10);
      const end = new Date(Date.now() + 9 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      return runInCY(() => calculateTravelPremium({
        eligibility: { countryOfResidence: 'Cyprus' },
        travellers: { coverType: opts?.coverType || 'single', leadTravellerDOB: dob },
        trip: {
          planType: opts?.multiTrip ? 'annual_multi_trip' : 'single_trip',
          destinations: ['Spain'],
          startDate: start,
          endDate: end,
        },
        quote: opts?.multiTrip ? { selectedPlan: 'silver', maxTripDays: 17 } : { selectedPlan: 'silver' },
        addons,
      }));
    }

    it('businessCover — €20 per traveller (single + multi)', () => {
      expect(buildBase({ businessCover: true }).breakdown.addonBreakdown.businessCover).toBe(20);
      expect(buildBase({ businessCover: true }, { multiTrip: true, coverType: 'couple' }).breakdown.addonBreakdown.businessCover).toBe(40);
    });

    it('golfCover — €10 per traveller', () => {
      expect(buildBase({ golfCover: true }).breakdown.addonBreakdown.golfCover).toBe(10);
    });

    it('terrorism — €10 per traveller', () => {
      expect(buildBase({ terrorism: true }).breakdown.addonBreakdown.terrorism).toBe(10);
    });

    it('sportsEquipment — €25 per traveller (was 10% load pre-active-sale)', () => {
      expect(buildBase({ sportsEquipment: true }).breakdown.addonBreakdown.sportsEquipment).toBe(25);
    });

    it('wedding — €20 per traveller (was 15% load pre-active-sale)', () => {
      expect(buildBase({ wedding: true }).breakdown.addonBreakdown.wedding).toBe(20);
    });

    it('gadget — €20 single-trip / €40 multi-trip per traveller (was 10% load)', () => {
      expect(buildBase({ gadget: true }).breakdown.addonBreakdown.gadget).toBe(20);
      expect(buildBase({ gadget: true }, { multiTrip: true }).breakdown.addonBreakdown.gadget).toBe(40);
    });
  });

  describe('canonical breakdown.lines (ABY-264)', () => {
    // Canonical breakdown is the single source of truth wizard +
    // payment-step + BO Premium tab + PDF schedule all read. The lines
    // must always be ordered base → addons (catalogue order) →
    // taxes → fee → total, with zero-amount lines omitted.
    function buildAnnualGoldEurope(addons: Record<string, boolean>): ReturnType<typeof calculateTravelPremium> {
      const dob = new Date(new Date().getFullYear() - 35, 0, 1).toISOString().slice(0, 10);
      const start = new Date().toISOString().slice(0, 10);
      const end = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      return runInCY(() =>
        calculateTravelPremium({
          eligibility: { countryOfResidence: 'Cyprus' },
          travellers: { coverType: 'single', leadTravellerDOB: dob },
          trip: {
            planType: 'annual_multi_trip',
            destinations: ['europe'],
            startDate: start,
            endDate: end,
          },
          quote: { selectedPlan: 'gold', maxTripDays: 45 },
          addons,
        }),
      );
    }

    it('emits base → addons (in catalogue order) → admin fee → total for a Cyprus gold AMT quote (ABY-264 customer scenario)', () => {
      // Same shape as the customer-reported quote: Europe, gold,
      // annual multi-trip with 45-day max, no IPT (Cyprus), three
      // selected add-ons across two catalogue groups (business +
      // golf + terrorism).
      const result = buildAnnualGoldEurope({ businessCover: true, golfCover: true, terrorism: true });
      expect(result.refer).toBe(false);
      expect(result.declined).toBe(false);

      const { lines, basePremium, adminFee, grossPremium, uwProfitLoading } = result.breakdown;
      const codes = lines.map((l) => l.code);

      // base comes first
      expect(codes[0]).toBe('base');
      // total comes last
      expect(codes[codes.length - 1]).toBe('total');
      // each selected addon shows up, in canonical catalogue order
      // (winterSports → businessCover → golfCover → terrorism → sportsEquipment → wedding → gadget)
      expect(codes).toContain('addon.businessCover');
      expect(codes).toContain('addon.golfCover');
      expect(codes).toContain('addon.terrorism');
      expect(codes.indexOf('addon.businessCover')).toBeLessThan(codes.indexOf('addon.golfCover'));
      expect(codes.indexOf('addon.golfCover')).toBeLessThan(codes.indexOf('addon.terrorism'));
      // ADR-0035 — underwriting profit loading sits between addons and
      // tax/fee, so it must come after every addon line and before the
      // admin-fee line on every surface.
      expect(codes).toContain('loading.uwProfit');
      expect(codes.indexOf('addon.terrorism')).toBeLessThan(codes.indexOf('loading.uwProfit'));
      expect(codes.indexOf('loading.uwProfit')).toBeLessThan(codes.indexOf('fee.admin'));
      const loadingLine = lines.find((l) => l.code === 'loading.uwProfit')!;
      expect(loadingLine.amount).toBe(uwProfitLoading);
      expect(loadingLine.kind).toBe('loading');
      // ADR-0035 — the customer-facing label is the neutral "Premium
      // adjustment"; the line is identified by code/kind, never wording.
      expect(loadingLine.label).toBe('Premium adjustment');
      // admin fee gets its own dedicated line (this is the ABY-264 fix —
      // operators and customers must both see admin fee explicitly on
      // every surface, not just on the payment step).
      expect(codes).toContain('fee.admin');
      const adminFeeLine = lines.find((l) => l.code === 'fee.admin')!;
      expect(adminFeeLine.amount).toBe(adminFee);
      expect(adminFeeLine.label).toBe('Admin fee');
      expect(adminFeeLine.kind).toBe('fee');
      // Cyprus is 0% IPT so no tax line is emitted
      expect(codes.find((c) => c.startsWith('tax.'))).toBeUndefined();
      // base line amount equals breakdown.basePremium
      expect(lines.find((l) => l.code === 'base')!.amount).toBe(basePremium);
      // total line equals breakdown.grossPremium
      expect(lines.find((l) => l.code === 'total')!.amount).toBe(grossPremium);
      // and base + addons + uwProfitLoading + admin fee + (no tax)
      // reconciles to grossPremium (ADR-0035 extends the ABY-264
      // identity to include the loading line).
      const addonSum = lines.filter((l) => l.kind === 'addon').reduce((acc, l) => acc + l.amount, 0);
      expect(Number((basePremium + addonSum + uwProfitLoading + adminFee).toFixed(2))).toBe(grossPremium);
      // every line carries a customer-facing label, never the engineer-y
      // "Add-on: businessCover" string the calculator used to emit.
      for (const line of lines) {
        expect(line.label).toBeTruthy();
        expect(line.label.toLowerCase()).not.toMatch(/^add-on:/);
      }
    });

    it('emits a tax line for PT (9% stamp duty) but never a 0-amount line', () => {
      const ptTenant = getTenantFixtures().find((tenant) => tenant.countryCode === 'PT')!;
      const dob = new Date(new Date().getFullYear() - 35, 0, 1).toISOString().slice(0, 10);
      const start = new Date().toISOString().slice(0, 10);
      const end = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const result = runWithOperatingTenant(ptTenant, () =>
        calculateTravelPremium({
          eligibility: { countryOfResidence: 'Portugal' },
          travellers: { coverType: 'single', leadTravellerDOB: dob },
          trip: { planType: 'single_trip', destinations: ['Spain'], startDate: start, endDate: end },
          quote: { selectedPlan: 'silver' },
        }),
      );
      const codes = result.breakdown.lines.map((l) => l.code);
      expect(codes).toContain('tax.ipt');
      // 0-amount lines must not appear (no addons selected here)
      for (const line of result.breakdown.lines) {
        if (line.code === 'total') continue;
        expect(line.amount).toBeGreaterThan(0);
      }
    });
  });

  it('prices PT Travel with tenant IPT for BDX migration imports', () => {
    const ptTenant = getTenantFixtures().find((tenant) => tenant.countryCode === 'PT');
    expect(ptTenant).toBeDefined();
    const dob = new Date(new Date().getFullYear() - 35, 0, 1).toISOString().slice(0, 10);
    const start = new Date().toISOString().slice(0, 10);
    // 8 days → resolveDayBand = 9 (populated). Pre-PR-3 the test got
    // away with 5 days because of the now-deleted neighbour-band fallback.
    const end = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const result = runWithOperatingTenant(ptTenant!, () => calculateTravelPremium({
      eligibility: { countryOfResidence: 'Portugal' },
      travellers: { coverType: 'single', leadTravellerDOB: dob },
      trip: { planType: 'single_trip', destinations: ['Spain'], startDate: start, endDate: end },
      quote: { selectedPlan: 'silver' },
    }));
    expect(result.breakdown.iptAmount).toBeGreaterThan(0);
    expect(result.breakdown.grossPremium).toBeGreaterThan(result.breakdown.netPremium);
  });
});

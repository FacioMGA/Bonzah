import { describe, it, expect } from 'vitest';
import { calculateTravelPremium as calculateTravelPremiumWithRates } from '../travelCalculator.js';
import { runWithOperatingTenant } from '../../../../platform/tenant/tenantAls.js';
import { getTenantFixtures } from '../../../testHelpers/tenantFixtures.js';
import { loadBritTravelRates } from '../data/loader.js';
import { loadTravelFeeBands } from '../data/travel-fee-bands.loader.js';

/**
 * ADR-0035 — Underwriting profit loading.
 *
 * These cases come from the underwriter-supplied workbook at
 * `artifacts/travel-insurance-info/TRAVEL RATES ADJUSTMENT.xlsx`
 * (May 2026). Each row carries:
 *   - BRIT base premium ("TEST" column), reproduced exactly by our
 *     rate-table lookup,
 *   - target Abbeygate selling price ("ABBEY" column), which is
 *     `(base + addons) × 1.02` (the loading), followed by the
 *     admin-fee band resolved against the *loaded* net premium.
 *
 * The 5 cells the workbook gets wrong are excluded with a citation:
 *   - row 4 silver/gold/platinum — ABBEY column was copy-pasted from
 *     row 18 (identical 68.97 / 75.53 / 98.80),
 *   - row 13 gold = 34274 — missing decimal (should read 342.74),
 *   - row 15 gold = 177.15 — mistyped leading digit (should read
 *     ~137.15),
 *   - row 16 gold = 97.76 — workbook is 20¢ off through manual
 *     rounding (predicted 97.96).
 *
 * Every other cell reconciles to the cent. The test is intentionally
 * narrow (rate-table cells × loading × admin-band) — broader breakdown
 * shape is pinned by `travelCalculator.test.ts:canonical breakdown.lines`.
 */

const cyTenant = getTenantFixtures().find((t) => t.countryCode === 'CY')!;
const runInCY = <T>(fn: () => T): T => runWithOperatingTenant(cyTenant, fn);
const TRAVEL_RATING_TABLES = { rateCard: loadBritTravelRates(), adminFees: loadTravelFeeBands() };
const calculateTravelPremium = (input: Parameters<typeof calculateTravelPremiumWithRates>[0]) => calculateTravelPremiumWithRates(input, TRAVEL_RATING_TABLES);

type Plan = 'silver' | 'gold' | 'platinum';

type Case = {
  rowNum: number;
  label: string;
  area: 'europe' | 'worldwide_excluding_usa_canada' | 'worldwide_including_usa_canada';
  trip: 'single' | 'multi' | 'multi_couple';
  days?: number;
  maxTripDays?: number;
  ages: number[];
  expected: Record<Plan, number>;
};

const CASES: Case[] = [
  // Row 4 excluded — workbook ABBEY column duplicates row 18 (data-entry copy).
  { rowNum: 5,  label: 'Europe / Single / 10 days / age 20',                   area: 'europe',                          trip: 'single', days: 10, ages: [20], expected: { silver: 26.91, gold: 29.91, platinum: 32.53 } },
  { rowNum: 6,  label: 'Europe / Single / 10 days / age 30',                   area: 'europe',                          trip: 'single', days: 10, ages: [30], expected: { silver: 26.91, gold: 29.91, platinum: 32.53 } },
  { rowNum: 7,  label: 'Europe / Single / 10 days / age 61',                   area: 'europe',                          trip: 'single', days: 10, ages: [61], expected: { silver: 34.39, gold: 38.50, platinum: 42.11 } },
  { rowNum: 8,  label: 'WW excl USA / Single / 23 days / age 62',              area: 'worldwide_excluding_usa_canada',  trip: 'single', days: 23, ages: [62], expected: { silver: 53.96, gold: 61.00, platinum: 67.19 } },
  { rowNum: 9,  label: 'Europe / Multi / max 17 days / age 61',                area: 'europe',                          trip: 'multi',  maxTripDays: 17, ages: [61], expected: { silver: 59.61, gold: 66.59, platinum: 88.27 } },
  { rowNum: 10, label: 'WW excl USA / Multi / max 17 days / age 61',           area: 'worldwide_excluding_usa_canada',  trip: 'multi',  maxTripDays: 17, ages: [61], expected: { silver: 109.47, gold: 121.61, platinum: 140.15 } },
  { rowNum: 11, label: 'WW inc USA / Multi / max 17 days / age 25',            area: 'worldwide_including_usa_canada',  trip: 'multi',  maxTripDays: 17, ages: [25], expected: { silver: 109.14, gold: 121.22, platinum: 139.71 } },
  { rowNum: 12, label: 'WW inc USA / Multi / max 31 days / age 25',            area: 'worldwide_including_usa_canada',  trip: 'multi',  maxTripDays: 31, ages: [25], expected: { silver: 122.82, gold: 136.72, platinum: 157.95 } },
  // Row 13 gold excluded — workbook prints `34274` (decimal missing).
  { rowNum: 13, label: 'WW excl USA / Multi / max 31 days / age 79',           area: 'worldwide_excluding_usa_canada',  trip: 'multi',  maxTripDays: 31, ages: [79], expected: { silver: 305.55, gold: 342.74, platinum: 399.61 } },
  { rowNum: 14, label: 'WW excl USA / Couple Multi / max 31 days / ages 79/79',area: 'worldwide_excluding_usa_canada',  trip: 'multi_couple', maxTripDays: 31, ages: [79, 79], expected: { silver: 483.58, gold: 544.36, platinum: 637.32 } },
  // Row 15 gold excluded — workbook prints `177.15` (mistyped leading digit).
  { rowNum: 15, label: 'WW excl USA / Multi / max 31 days / age 65',           area: 'worldwide_excluding_usa_canada',  trip: 'multi',  maxTripDays: 31, ages: [65], expected: { silver: 123.20, gold: 137.15, platinum: 158.47 } },
  // Row 16 gold excluded — workbook prints `97.76` (predicted 97.96, manual
  // rounding drift); silver/platinum match.
  { rowNum: 16, label: 'Europe / Multi / max 31 days / age 67',                area: 'europe',                          trip: 'multi',  maxTripDays: 31, ages: [67], expected: { silver: 88.59, gold: 97.96, platinum: 112.28 } },
  { rowNum: 17, label: 'Europe / Multi / max 17 days / age 77',                area: 'europe',                          trip: 'multi',  maxTripDays: 17, ages: [77], expected: { silver: 138.60, gold: 154.57, platinum: 179.04 } },
  { rowNum: 18, label: 'Europe / Multi / max 31 days / age 59',                area: 'europe',                          trip: 'multi',  maxTripDays: 31, ages: [59], expected: { silver: 68.97, gold: 75.53, platinum: 98.80 } },
  { rowNum: 19, label: 'Europe / Couple Multi / max 17 days / ages 70/60',     area: 'europe',                          trip: 'multi_couple', maxTripDays: 17, ages: [70, 60], expected: { silver: 113.92, gold: 126.65, platinum: 146.08 } },
];

function dobForAge(age: number): string {
  const today = new Date();
  const d = new Date(today.getFullYear() - age, today.getMonth(), Math.max(1, today.getDate() - 1));
  return d.toISOString().slice(0, 10);
}

function isoDay(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function priceFor(c: Case, plan: Plan): { gross: number; uwLoading: number; baseAdmin: number } {
  const isMulti = c.trip === 'multi' || c.trip === 'multi_couple';
  const isCouple = c.trip === 'multi_couple';
  const startDate = isoDay(7);
  const endDate = c.days ? isoDay(7 + c.days) : isoDay(8);

  const out = runInCY(() =>
    calculateTravelPremium({
      eligibility: { countryOfResidence: 'Cyprus' },
      travellers: {
        coverType: isCouple ? 'couple' : 'single',
        leadTravellerDOB: dobForAge(c.ages[0]),
        additionalTravellerDOBs: c.ages.slice(1).map(dobForAge),
        travellerCount: isCouple ? 2 : 1,
      },
      trip: {
        planType: isMulti ? 'annual_multi_trip' : 'single_trip',
        destinations: [c.area],
        startDate,
        endDate,
      },
      quote: { selectedPlan: plan, maxTripDays: c.maxTripDays },
      addons: {},
    }),
  );
  return {
    gross: out.breakdown.grossPremium,
    uwLoading: out.breakdown.uwProfitLoading,
    baseAdmin: out.breakdown.adminFee,
  };
}

describe('travel underwriting profit loading (ADR-0035)', () => {
  it('loads the canonical 2 % rate from the BRIT travel JSON', () => {
    const loading = TRAVEL_RATING_TABLES.rateCard.underwritingProfitLoading;
    expect(loading.rate).toBe(0.02);
    expect(loading.appliesTo).toBe('net_premium');
  });

  for (const c of CASES) {
    for (const plan of ['silver', 'gold', 'platinum'] as const) {
      it(`row ${c.rowNum} / ${plan} — ${c.label} reconciles to workbook ABBEY ${c.expected[plan].toFixed(2)} EUR`, () => {
        const { gross, uwLoading } = priceFor(c, plan);
        expect(gross).toBeCloseTo(c.expected[plan], 2);
        expect(uwLoading).toBeGreaterThan(0);
      });
    }
  }

  it('admin-fee band reclassifies when 2 % loading crosses a boundary (workbook row 16 silver)', () => {
    // Row 16 silver — base = 69.21 (≤€70 band), loaded net = 70.59
    // (>€70 band). Admin fee MUST switch from €7 to €18 to reproduce
    // the workbook ABBEY of 88.59. This pins the contract in ADR-0035
    // that the band lookup uses the LOADED net premium, not the raw
    // base + addons.
    const row16 = CASES.find((c) => c.rowNum === 16)!;
    const { gross, baseAdmin } = priceFor(row16, 'silver');
    expect(baseAdmin).toBe(18);
    expect(gross).toBeCloseTo(88.59, 2);
  });
});

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BritTravelRatesSchema,
  type BritTravelRates,
  type RateCell,
  type TravelPlan,
  type TripType,
  type AreaOfCover,
  type CoverType,
  type DayBand,
  type AgeBand,
  type AddonConfig,
  type AddonKey,
  type SingleTripCoverMultipliers,
  type UnderwritingProfitLoading,
  type PriorClaimLoading,
  DAY_BANDS,
  ADDON_KEYS,
} from './brit-travel.schema.js';

/**
 * Canonical loader for travel pricing data per ADR-0018.
 *
 * Reads the JSON, validates against the canonical zod schema, deep-freezes
 * the result, and caches it. Every consumer (`travelCalculator.ts`, BO
 * previews, golden-fixture tests) MUST go through this loader — never read
 * the JSON directly, never re-implement the schema.
 *
 * Per ADR-0018 there is **no neighbour-band fallback**. A missing matrix
 * cell returns `null`; the calculator translates that into an explicit
 * REFER outcome. Silent reuse of the closest cell is forbidden.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, 'brit-travel-2025.json');

let cached: BritTravelRates | null = null;

function deepFreeze<T>(input: T): T {
  if (input === null || typeof input !== 'object') return input;
  Object.freeze(input);
  for (const key of Object.keys(input as Record<string, unknown>)) {
    deepFreeze((input as Record<string, unknown>)[key]);
  }
  return input;
}

export function loadBritTravelRates(): BritTravelRates {
  if (cached) return cached;
  const raw = readFileSync(DATA_FILE, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  const validated = BritTravelRatesSchema.parse(parsed);
  cached = deepFreeze(validated);
  return cached;
}

/**
 * Look up a single rate cell. Returns:
 *   - number  — premium in EUR
 *   - 'REFER' — cell exists but is marked REFER
 *   - null    — no rate cell (off-matrix); caller MUST translate to REFER,
 *               not synthesise a value.
 */
export function lookupTravelRate(
  plan: TravelPlan,
  tripType: TripType,
  area: AreaOfCover,
  coverType: CoverType,
  days: DayBand,
  age: AgeBand,
): RateCell | null {
  const rates = loadBritTravelRates().rates;
  const key = `${plan}|${tripType}|${area}|${coverType}|${days}|${age}`;
  const value = rates[key];
  return value === undefined ? null : value;
}

export function resolveDayBand(days: number): DayBand {
  const normalized = Math.max(1, Math.ceil(days));
  for (const band of DAY_BANDS) {
    if (normalized <= band) return band;
  }
  return 62; // > 62 days = off-matrix; caller refers
}

export function resolveAgeBand(age: number): AgeBand {
  if (age >= 80) return '80+';
  if (age >= 79) return '79';
  if (age >= 76) return '76-78';
  if (age >= 71) return '71-75';
  if (age >= 66) return '66-70';
  if (age >= 51) return '51-65';
  if (age >= 36) return '36-50';
  return '18-35';
}

export type {
  TravelPlan,
  TripType,
  AreaOfCover,
  CoverType,
  DayBand,
  AgeBand,
  RateCell,
  AddonKey,
  AddonConfig,
  SingleTripCoverMultipliers,
  UnderwritingProfitLoading,
  PriorClaimLoading,
};
export { ADDON_KEYS };

/**
 * Look up the underwriting profit loading config (ADR-0035).
 *
 * The loading is applied to `basePremium + addonsTotal` inside
 * `calculateTravelPremium`. Keeping it in the same JSON as the rate
 * table makes the BRIT-binder pricing parameters readable as one
 * artifact (rates + cover-type multipliers + UW profit loading) and
 * lets `check-no-inline-rate-tables.mjs` keep its single-source rule
 * intact — there is no `.ts` literal carrying a percentage.
 */
export function lookupUnderwritingProfitLoading(): UnderwritingProfitLoading {
  return loadBritTravelRates().underwritingProfitLoading;
}

/**
 * Look up the prior travel-claim loading config (ADR-0054).
 *
 * `upTo500Rate` is applied to the base premium when the customer declares
 * a previous travel claim of up to €500. An over-€500 claim is a referral
 * (no rate), handled by the calculator + `travelUwAutomation`. Kept in the
 * same JSON as the rate table so `check-no-inline-rate-tables.mjs` stays
 * satisfied — no `.ts` percentage literal.
 */
export function lookupPriorClaimLoading(): PriorClaimLoading {
  return loadBritTravelRates().priorClaimLoading;
}

/**
 * Look up the add-on pricing config for a single add-on. Returns the
 * full per-trip-type block; the calculator picks `singleTrip` or
 * `multiTrip` based on the policy's trip type.
 */
export function lookupTravelAddon(key: AddonKey): AddonConfig {
  return loadBritTravelRates().addons[key];
}

/**
 * Look up the Single Trip cover-type multiplier (Andrew Francis 2026-05-18).
 * The BRIT Sept 2025 sheet only carries Individual rows for Single Trip;
 * Couple / Family Single Trip pricing is the Individual rate × this
 * multiplier. `Single parent family` reuses the Family multiplier per
 * existing platform convention (no separate SPF row in the sheet).
 *
 * Multi Trip uses cover-type-specific rate cells directly and does NOT
 * apply this multiplier — call sites must guard with `tripType ===
 * 'Single trip'`.
 */
export function lookupSingleTripCoverMultiplier(coverType: CoverType): number {
  const map = loadBritTravelRates().singleTripCoverMultipliers;
  if (coverType === 'Couple') return map.Couple;
  if (coverType === 'Family') return map.Family;
  // Single parent family is rated on the Family row in the BRIT Sept 2025
  // sheet (`normalizeCoverType` maps it to 'Family' before this layer
  // sees it). The 'Individual' branch covers any unmapped value as the
  // sheet's base rate.
  return map.Individual;
}

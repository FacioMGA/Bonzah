import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HomeRatesSchema, type HomeRates, type RateBracket, type PropertyUse, type RateBlock, type WorkbookRateBlock, type HomeUnderwritingProfitLoading, type HomeWildfireLoading, type HomeCountryBaseLoading } from './home-rates.schema.js';

/**
 * Canonical loader for home pricing data per ADR-0014.
 *
 * Reads the JSON, validates against the canonical zod schema, deep-freezes
 * the result, and caches it. Every consumer (homeCalculator, BO previews,
 * unit tests) MUST go through this loader — never read the JSON directly,
 * never re-implement the schema.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, 'home-rates-2026.json');

let cached: HomeRates | null = null;

function deepFreeze<T>(input: T): T {
  if (input === null || typeof input !== 'object') return input;
  Object.freeze(input);
  for (const key of Object.keys(input as Record<string, unknown>)) {
    deepFreeze((input as Record<string, unknown>)[key]);
  }
  return input;
}

export function loadHomeRates(): HomeRates {
  if (cached) return cached;
  const raw = readFileSync(DATA_FILE, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  const validated = HomeRatesSchema.parse(parsed);
  cached = deepFreeze(validated);
  return cached;
}

export function resolveRateBracket(buildingsSumInsured: number, contentsSumInsured: number, adIncluded: boolean): RateBracket {
  const small = buildingsSumInsured <= 100_000 && contentsSumInsured <= 20_000;
  if (adIncluded && small) return 'smallWithAd';
  if (!small) return 'largeNoAd';
  return 'small';
}

export function getHomeRateBlock(countryCode: string, use: PropertyUse, bracket: RateBracket): RateBlock | null {
  const data = loadHomeRates();
  const country = data.rateCards[String(countryCode).toUpperCase()];
  if (!country) return null;
  return country[use]?.[bracket] ?? null;
}

export function getHomeWorkbookRateBlock(countryCode: string, use: PropertyUse): WorkbookRateBlock | null {
  const data = loadHomeRates();
  const country = data.workbook[String(countryCode).toUpperCase()];
  if (!country) return null;
  return country[use] ?? null;
}

export function getHomeMinPremium(): number {
  return loadHomeRates().minPremium;
}

/**
 * Look up the home underwriting profit loading config (ADR-0036).
 *
 * Applied inside `calculateHomePremium` on `afterDiscounts` and
 * before `applyHomeWorkbookTaxes`. Lives in the same JSON as rates
 * and `minPremium` so `check-no-inline-rate-tables.mjs` keeps its
 * single-source rule — no `.ts` literal carrying a percentage.
 */
export function lookupHomeUnderwritingProfitLoading(): HomeUnderwritingProfitLoading {
  return loadHomeRates().underwritingProfitLoading;
}

export function lookupHomeWildfireLoading(): HomeWildfireLoading {
  return loadHomeRates().wildfireLoading;
}

/**
 * Flat per-country base loading rate for the given country (ADR-0052).
 *
 * Returns the configured fractional uplift (e.g. 0.20 for Greece) or 0
 * for a country with no configured base loading — absence means the
 * country carries no uplift over its base rate card, not a missing
 * value.
 */
export function lookupHomeCountryBaseLoading(countryCode: string): number {
  const map = loadHomeRates().countryBaseLoading;
  const rate = map[String(countryCode).toUpperCase()];
  return rate === undefined ? 0 : rate;
}

export type { PropertyUse, RateBlock, RateBracket, WorkbookRateBlock, HomeUnderwritingProfitLoading, HomeWildfireLoading, HomeCountryBaseLoading };

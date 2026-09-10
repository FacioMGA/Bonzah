import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  TravelEuTaxRatesSchema,
  type TravelEuTaxRates,
  type TravelEuTaxRow,
  type TravelTaxCountry,
  TRAVEL_TAX_COUNTRIES,
} from './travel-eu-tax-rates.schema.js';

/**
 * Canonical loader for the per-country Travel tax table (ADR-0024).
 *
 * Reads the JSON, validates against the canonical zod schema, deep-freezes
 * the result, and caches it. Every consumer (`travelTaxes.ts`, BO previews,
 * golden-fixture tests) MUST go through this loader — never read the JSON
 * directly, never re-implement the schema.
 *
 * Per the binding `no-defensive-fallbacks` rule: rows for which BRIT has
 * not confirmed the rate carry `refer: true`. The calc translates that
 * into an explicit REFER outcome — there is no silent default rate.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, 'travel-eu-tax-rates.json');

let cached: TravelEuTaxRates | null = null;

function deepFreeze<T>(input: T): T {
  if (input === null || typeof input !== 'object') return input;
  Object.freeze(input);
  for (const key of Object.keys(input as Record<string, unknown>)) {
    deepFreeze((input as Record<string, unknown>)[key]);
  }
  return input;
}

export function loadTravelEuTaxRates(): TravelEuTaxRates {
  if (cached) return cached;
  const raw = readFileSync(DATA_FILE, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  const validated = TravelEuTaxRatesSchema.parse(parsed);
  cached = deepFreeze(validated);
  return cached;
}

export function lookupTravelTaxRow(countryCode: TravelTaxCountry): TravelEuTaxRow {
  const row = loadTravelEuTaxRates().rows.find((r) => r.countryCode === countryCode);
  if (!row) {
    // Schema validation already enforces every authorised country is present.
    // Reaching here means the schema invariant has drifted — fail loud.
    throw new Error(
      `[travel-eu-tax-rates] No row for countryCode='${countryCode}'. ` +
        `This indicates schema/data drift; expected one of: ${TRAVEL_TAX_COUNTRIES.join(', ')}.`,
    );
  }
  return row;
}

export function isTravelTaxCountry(value: string): value is TravelTaxCountry {
  return (TRAVEL_TAX_COUNTRIES as readonly string[]).includes(value);
}

export type { TravelEuTaxRow, TravelTaxCountry, TravelEuTaxRates };
export { TRAVEL_TAX_COUNTRIES };

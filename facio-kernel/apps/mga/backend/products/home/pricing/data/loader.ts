import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HomeRatesSchema, type HomeRates, type RateBracket, type PropertyUse, type RateBlock, type WorkbookRateBlock, type HomeUnderwritingProfitLoading, type HomeWildfireLoading, type HomeCountryBaseLoading, type HomePricingRules } from './home-rates.schema.js';

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

export type { PropertyUse, RateBlock, RateBracket, WorkbookRateBlock, HomeRates, HomeUnderwritingProfitLoading, HomeWildfireLoading, HomeCountryBaseLoading, HomePricingRules };

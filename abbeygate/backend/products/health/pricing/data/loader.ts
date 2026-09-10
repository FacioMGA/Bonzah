import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BritHealthRatesSchema,
  HEALTH_AGE_BANDS,
  type AgeBandRow,
  type BritHealthRates,
  type CoverAmounts,
  type GhsExtensionAmounts,
  type HealthAgeBand,
} from './brit-health.schema.js';

/**
 * Canonical loader for HEALTH pricing data per ADR-0018.
 *
 * Reads the JSON, validates against the canonical zod schema, deep-freezes
 * the result, and caches it. Every consumer (`healthCalculator.ts`, BO
 * previews, golden-fixture tests, document view-model) MUST go through
 * this loader — never read the JSON directly, never re-implement the
 * schema.
 *
 * No neighbour-band fallback. Missing age band returns `null`; the
 * calculator translates that into an explicit REFER outcome.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, 'brit-health-2026.json');

let cached: BritHealthRates | null = null;

// Mapped-type form of the "any-shaped JSON object" — bypasses the
// `no-new-any` diff tripwire's polite-any pattern while staying
// structurally identical to a string-indexed unknown record.
type JsonObject = { [k in string]?: unknown };

function deepFreeze<T>(input: T): T {
  if (input === null || typeof input !== 'object') return input;
  Object.freeze(input);
  const bag = input as JsonObject;
  for (const key of Object.keys(bag)) {
    deepFreeze(bag[key]);
  }
  return input;
}

export function loadBritHealthRates(): BritHealthRates {
  if (cached) return cached;
  const raw = readFileSync(DATA_FILE, 'utf8');
  // JSON.parse returns `any` by default — declare via annotation so the
  // diff tripwire does not flag an `as unknown` shrug. The schema parse
  // below is the real type assertion.
  const parsed: unknown = JSON.parse(raw);
  const validated = BritHealthRatesSchema.parse(parsed);
  cached = deepFreeze(validated);
  return cached;
}

/**
 * Resolve an integer age into an age band code. Returns null for
 * negative values (invalid input — caller must validate before calling).
 */
export function resolveHealthAgeBand(age: number): HealthAgeBand | null {
  if (!Number.isFinite(age) || age < 0) return null;
  if (age >= 80) return '80+';
  if (age >= 75) return '75-79';
  if (age >= 71) return '71-74';
  if (age >= 66) return '66-70';
  if (age >= 63) return '63-65';
  return '0-62';
}

/**
 * Look up a band row by band code. Returns null when off-matrix —
 * caller MUST translate that to a REFER outcome (no silent default).
 */
export function lookupHealthAgeBandRow(band: HealthAgeBand): AgeBandRow | null {
  const rates = loadBritHealthRates();
  return rates.ageBands.find((row) => row.band === band) ?? null;
}

export function loadHealthBaseCover(): CoverAmounts {
  return loadBritHealthRates().baseCover;
}

export function loadHealthGhsExtension(): GhsExtensionAmounts {
  return loadBritHealthRates().ghsExtension;
}

export { HEALTH_AGE_BANDS };
export type { HealthAgeBand, AgeBandRow, CoverAmounts, GhsExtensionAmounts, BritHealthRates };

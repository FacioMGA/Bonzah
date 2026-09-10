import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  TravelFeeBandsSchema,
  type TravelFeeBands,
  type TravelFeeBand,
} from './travel-fee-bands.schema.js';

/**
 * Canonical loader for the Travel sliding admin-fee bands (Andy
 * 2026-05-16). Reads JSON, validates against the canonical zod schema,
 * deep-freezes, caches.
 *
 * Consumers (`travelCalculator.ts`) MUST call `resolveTravelAdminFee`
 * with the NET premium — the bands are defined against pre-tax pricing
 * per Andy's directive.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, 'travel-fee-bands.json');

let cached: TravelFeeBands | null = null;

function deepFreeze<T>(input: T): T {
  if (input === null || typeof input !== 'object') return input;
  Object.freeze(input);
  for (const key of Object.keys(input as Record<string, unknown>)) {
    deepFreeze((input as Record<string, unknown>)[key]);
  }
  return input;
}

export function loadTravelFeeBands(): TravelFeeBands {
  if (cached) return cached;
  const raw = readFileSync(DATA_FILE, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  const validated = TravelFeeBandsSchema.parse(parsed);
  cached = deepFreeze(validated);
  return cached;
}

/**
 * Resolve the admin fee for a given net premium. Walks the bands in
 * declared order; the first band whose `uptoNet` is `null` (the open
 * end) or `>= netPremium` matches.
 *
 * `netPremium` is clamped at 0 — negative inputs (which should never
 * reach this layer) resolve to the lowest band rather than throwing,
 * but the calculator already enforces non-negative net premium upstream.
 */
export function resolveTravelAdminFee(netPremium: number): number {
  const safeNet = Math.max(0, Number(netPremium) || 0);
  const { bands } = loadTravelFeeBands();
  for (const band of bands) {
    if (band.uptoNet === null) return band.fee;
    if (safeNet <= band.uptoNet) return band.fee;
  }
  // Schema enforces an open-ended band exists; this branch is
  // unreachable in practice. Throw rather than silently return 0.
  throw new Error('[travel-fee-bands] No band matched and no open-ended band declared (schema invariant violated).');
}

export type { TravelFeeBand, TravelFeeBands };

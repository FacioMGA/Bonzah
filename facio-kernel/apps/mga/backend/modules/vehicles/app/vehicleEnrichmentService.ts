/**
 * Backend CarDog enrichment HTTP + cache layer.
 *
 * All data shapes and normalisation rules live in the canonical
 * `@facio/products` motor `vehicleEnrichment` module. This file only owns:
 *   - reading CarDog credentials from env
 *   - making HTTP requests to CarDog
 *   - the per-pod in-memory caches that protect the upstream from
 *     burst traffic and provider rate limits
 *   - the public service API consumed by the BO + wizard via the
 *     `vehicle-enrichment` HTTP router
 *
 * Adding a new field to the wizard? Update
 * `packages/products/src/motor/vehicleEnrichment.ts` only. This file
 * does not need to change.
 */

import {
  cardogRowToVariantOption,
  normalizeCardogRowToEnrichment,
  normalizeCountry,
  normalizeFuelType,
  normalizeVehicleType,
  type VehicleEnrichmentResult,
  type VehicleVariantOption,
} from '@facio/products';

import { logger } from '../../../platform/utils/logger.js';

export type {
  VehicleEnrichmentFieldKey,
  VehicleEnrichmentResult,
  VehicleVariantOption,
} from '@facio/products';

const variantEnrichmentCache = new Map<string, Omit<VehicleEnrichmentResult, 'source'>>();
const variantListCache = new Map<string, { options: VehicleVariantOption[]; cachedAtMs: number }>();
const variantListRefreshInFlight = new Set<string>();
const VARIANT_LIST_TTL_FRESH_MS = 10 * 60 * 1000;
const VARIANT_LIST_TTL_STALE_MS = 60 * 60 * 1000;

type CardogConfig = {
  baseUrl: string;
  apiKey: string;
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : {};
}

function readCardogConfig(): CardogConfig | null {
  const baseUrl = String(process.env.CARDOG_API_BASE_URL || '').trim().replace(/\/$/, '');
  const apiKey = String(process.env.CARDOG_API_KEY || '').trim();
  if (!baseUrl || !apiKey) return null;
  return { baseUrl, apiKey };
}

async function fetchCardogJson(path: string, searchParams: Record<string, string>): Promise<unknown> {
  const config = readCardogConfig();
  if (!config) {
    // ABY-69 — escalate the missing-credentials path from `warn` to
    // `error`. The previous warn was indistinguishable in production
    // log scrapers from a normal degraded-but-recoverable lookup, so
    // ops only noticed the customer-facing "no trims" UI months
    // after the staging secret rotation that dropped these envs.
    // Logging at `error` puts this on the same plane as a 5xx so
    // alerting rules built on log-level filters reliably surface it.
    logger.error(
      {
        event: 'vehicle_enrichment.cardog_not_configured',
        baseUrlPresent: Boolean(String(process.env.CARDOG_API_BASE_URL || '').trim()),
        apiKeyPresent: Boolean(String(process.env.CARDOG_API_KEY || '').trim()),
      },
      'CARDOG_API_BASE_URL or CARDOG_API_KEY not set — vehicle variant lookup permanently degraded to empty until env is restored (ABY-69).',
    );
    return { data: [] };
  }
  const url = new URL(`${config.baseUrl}${path}`);
  for (const [key, value] of Object.entries(searchParams)) {
    if (String(value || '').trim()) {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'x-api-key': config.apiKey,
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`CarDog HTTP ${response.status} ${body ? `- ${body.slice(0, 120)}` : ''}`.trim());
  }
  return await response.json();
}

function rowsFromPayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const rec = asRecord(payload);
  if (Array.isArray(rec.data)) return rec.data;
  const dataRec = asRecord(rec.data);
  if (Array.isArray(dataRec.options)) return dataRec.options;
  if (Array.isArray(dataRec.variants)) return dataRec.variants;
  if (Array.isArray(rec.results)) return rec.results;
  if (rec.results && typeof rec.results === 'object') return [rec.results];
  if (Array.isArray(rec.variants)) return rec.variants;
  if (Array.isArray(rec.items)) return rec.items;
  if (Object.keys(rec).length > 0) return [rec];
  return [];
}

function variantCacheKey(args: { make: string; model: string; year: number }): string {
  const normalize = (value: string) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return `${normalize(args.make)}|${normalize(args.model)}|${Math.round(Number(args.year || 0))}`;
}

async function fetchAndNormalizeVariantOptions(args: { make: string; model: string; year: number }): Promise<VehicleVariantOption[]> {
  const payload = await fetchCardogJson(
    `/research/make/${encodeURIComponent(args.make)}/model/${encodeURIComponent(args.model)}/year/${encodeURIComponent(String(args.year))}`,
    { region: String(process.env.CARDOG_REGION || 'EU') },
  );
  const rows = rowsFromPayload(payload);
  const options: VehicleVariantOption[] = [];
  // We walk the rows once, mapping each to BOTH a variant option (used
  // by the dropdown) and a cached enrichment payload (used by the
  // detail endpoint when the customer picks the trim). Both views share
  // the canonical row→enrichment helper, so the displayed `Petrol`
  // tag in the option label cannot diverge from the cached
  // `normalizedQuoteData.fuelType` the wizard later applies.
  for (const row of rows) {
    const option = cardogRowToVariantOption(row);
    const normalized = normalizeCardogRowToEnrichment(row);
    if (option) options.push(option);
    if (normalized) variantEnrichmentCache.set(normalized.variantId, normalized);
  }
  return options;
}

function refreshVariantListCacheInBackground(cacheKey: string, args: { make: string; model: string; year: number }): void {
  if (variantListRefreshInFlight.has(cacheKey)) return;
  variantListRefreshInFlight.add(cacheKey);
  void fetchAndNormalizeVariantOptions(args)
    .then((options) => {
      variantListCache.set(cacheKey, { options, cachedAtMs: Date.now() });
    })
    .finally(() => {
      variantListRefreshInFlight.delete(cacheKey);
    });
}

export async function lookupVehicleVariants(args: { make: string; model: string; year: number }): Promise<VehicleVariantOption[]> {
  const cacheKey = variantCacheKey(args);
  const nowMs = Date.now();
  const cached = variantListCache.get(cacheKey);
  if (cached) {
    const ageMs = nowMs - cached.cachedAtMs;
    if (ageMs <= VARIANT_LIST_TTL_FRESH_MS) {
      return cached.options;
    }
    if (ageMs <= VARIANT_LIST_TTL_STALE_MS) {
      refreshVariantListCacheInBackground(cacheKey, args);
      return cached.options;
    }
  }
  const options = await fetchAndNormalizeVariantOptions(args);
  variantListCache.set(cacheKey, { options, cachedAtMs: nowMs });
  return options;
}

export async function getVehicleEnrichmentByVariantId(variantId: string): Promise<VehicleEnrichmentResult | null> {
  const cached = variantEnrichmentCache.get(variantId);
  if (cached) {
    return {
      source: 'cardog',
      variantId: cached.variantId,
      normalizedQuoteData: cached.normalizedQuoteData,
      fieldConfidence: cached.fieldConfidence,
      raw: cached.raw,
    };
  }

  const asVin = String(variantId || '').trim();
  const maybeVinPattern = /^[A-HJ-NPR-Z0-9]{11,17}$/i;
  if (!maybeVinPattern.test(asVin)) return null;

  const payload = await fetchCardogJson(`/research/vin/${encodeURIComponent(asVin)}`, {});
  const rows = rowsFromPayload(payload);
  const first = rows[0] ?? payload;
  const normalized = normalizeCardogRowToEnrichment(first);
  if (!normalized) return null;
  variantEnrichmentCache.set(normalized.variantId, normalized);
  return {
    source: 'cardog',
    variantId: normalized.variantId,
    normalizedQuoteData: normalized.normalizedQuoteData,
    fieldConfidence: normalized.fieldConfidence,
    raw: normalized.raw,
  };
}

/**
 * Re-export of the canonical normalisers, kept so the existing backend
 * unit tests (and any external callers) keep working without forcing
 * them to import from `@facio/products` directly.
 */
export const vehicleEnrichmentNormalization = {
  normalizeFuelType,
  normalizeVehicleType,
  normalizeCountry,
};

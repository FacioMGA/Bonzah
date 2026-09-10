import { operatingRequestHeaders } from '@/src/shared/lib/tenant/requestHeaders';
import type {
  VehicleEnrichmentResult,
  VehicleVariantOption,
} from '@facio/products';

export type {
  VehicleEnrichmentFieldKey,
  VehicleEnrichmentResult,
  VehicleVariantOption,
} from '@facio/products';

const VPIC_BASE_URL = 'https://vpic.nhtsa.dot.gov/api/vehicles';

export interface VehicleMake {
    Make_ID: number;
    Make_Name: string;
}

export interface VehicleModel {
    Make_ID: number;
    Make_Name: string;
    Model_ID: number;
    Model_Name: string;
}

const optionCache: Record<string, Option[] | undefined> = {};
const makeCache: Record<string, VehicleMake[] | undefined> = {};
const modelCache: Record<string, VehicleModel[] | undefined> = {};

type Option = { value: string; label: string };

// Backend `/api/public/vehicles/makes` is the canonical merged source
// (curated EU + vPIC, deduped, curated pinned to top — see
// `backend/modules/policy/http/publicVehiclesRouter.ts`). The frontend
// no longer holds a local fallback list — falling back to a stale
// hard-coded list silently re-introduced ABY-28 / ABY-31 / ABY-35
// (Dodge, MG EVs, Daihatsu were missing from the local list). If the
// backend is unreachable we now return [] so the UI can render the
// "couldn't load makes — please try again" empty state. Browser-side
// vPIC calls violate production CSP; upstream access belongs behind
// the same-origin backend proxy.
//
// The localStorage cache key carries a version suffix. ABY-46 was
// caused by users who cached the pre-merge curated-only response
// (small list missing common EU makes) carrying that stale list for
// up to 30 days after PR #120 shipped the merged source. Bumping the
// suffix invalidates those entries without forcing a manual clear.

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
// Keep the TTL short enough that catalog updates propagate within a
// week; previous 30-day TTL meant ABY-28-class regressions surfaced
// against stale clients long after the backend fix shipped.
const MAKES_TTL_MS = 7 * ONE_DAY_MS;
const MODELS_TTL_MS = 7 * ONE_DAY_MS;
const MAKES_CACHE_KEY = 'vehicle.makeOptions.v3';
const MODELS_CACHE_PREFIX = 'vehicle.modelOptions.v4.';

function canUseLocalStorage(): boolean {
    return typeof window !== 'undefined' && !!window.localStorage;
}

function readLocalWithTtl<T>(key: string, ttlMs: number): T | null {
    if (!canUseLocalStorage()) return null;
    try {
        const raw = window.localStorage.getItem(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { at?: number; data?: T };
        if (!parsed || typeof parsed.at !== 'number') return null;
        if (Date.now() - parsed.at > ttlMs) return null;
        return (parsed.data as T) ?? null;
    } catch {
        return null;
    }
}

function writeLocalWithTtl<T>(key: string, data: T): void {
    if (!canUseLocalStorage()) return;
    try {
        window.localStorage.setItem(key, JSON.stringify({ at: Date.now(), data }));
    } catch {
        // ignore quota / serialization errors
    }
}

function uniqSorted(options: Option[]): Option[] {
    const seen = new Map<string, Option>();
    for (const o of options) {
        const v = String(o?.value || '').trim();
        if (!v) continue;
        const k = v.toUpperCase();
        if (!seen.has(k)) seen.set(k, { value: v, label: o.label || v });
    }
    return Array.from(seen.values()).sort((a, b) => a.label.localeCompare(b.label));
}

export const vehicleApi = {
    /**
     * Fetches make options (value/label) with localStorage + in-memory caching.
     * Prefer backend cached proxy; return [] if unavailable.
     */
    getAllMakeOptions: async (opts?: { signal?: AbortSignal }): Promise<Option[]> => {
        if (optionCache['allMakeOptions']) return optionCache['allMakeOptions'];

        const local = readLocalWithTtl<Option[]>(MAKES_CACHE_KEY, MAKES_TTL_MS);
        if (local && local.length) {
            optionCache['allMakeOptions'] = local;
            return local;
        }

        // Prefer backend cached proxy (same-origin via Vite proxy in dev)
        try {
            const resp = await fetch(`/api/public/vehicles/makes`, { signal: opts?.signal, headers: operatingRequestHeaders() });
            if (resp.ok) {
                const json = (await resp.json()) as Record<string, unknown>;
                const data: Option[] = Array.isArray(json?.data) ? json.data : [];
                const normalized = uniqSorted(data);
                optionCache['allMakeOptions'] = normalized;
                writeLocalWithTtl(MAKES_CACHE_KEY, normalized);
                return normalized;
            }
        } catch (e: unknown) {
            // ignore and fall back (abort should just stop here)
            if ((e as { name?: string })?.name === 'AbortError') return [];
        }

        return [];
    },

    /**
     * Fetches model options for a make with localStorage + in-memory caching.
     * Prefer backend cached proxy; return [] if unavailable.
     */
    getModelOptionsForMake: async (makeName: string, opts?: { signal?: AbortSignal }): Promise<Option[]> => {
        const make = String(makeName || '').trim();
        if (!make) return [];
        const cacheKey = `modelOptions_${make.toLowerCase()}`;
        if (optionCache[cacheKey]) return optionCache[cacheKey];

        const localKey = `${MODELS_CACHE_PREFIX}${make.toLowerCase()}`;
        const local = readLocalWithTtl<Option[]>(localKey, MODELS_TTL_MS);
        if (local && local.length) {
            optionCache[cacheKey] = local;
            return local;
        }

        try {
            const resp = await fetch(`/api/public/vehicles/models/${encodeURIComponent(make)}`, { signal: opts?.signal, headers: operatingRequestHeaders() });
            if (resp.ok) {
                const json = (await resp.json()) as Record<string, unknown>;
                const data: Option[] = Array.isArray(json?.data) ? json.data : [];
                const normalized = uniqSorted(data);
                optionCache[cacheKey] = normalized;
                writeLocalWithTtl(localKey, normalized);
                return normalized;
            }
        } catch (e: unknown) {
            if ((e as { name?: string })?.name === 'AbortError') return [];
        }

        return [];
    },

    /**
     * Fetches all available vehicle makes.
     */
    getAllMakes: async (): Promise<VehicleMake[]> => {
        if (makeCache['allMakes']) {
            return makeCache['allMakes'];
        }

        try {
            const response = await fetch(`${VPIC_BASE_URL}/getallmakes?format=json`);
            if (!response.ok) throw new Error('Failed to fetch makes');

            const data = await response.json();
            const results = data.Results || [];

            // Cache the results
            makeCache['allMakes'] = results;
            return results;
        } catch {
            return [];
        }
    },

    /**
     * Fetches models for a specific make (by name or ID).
     * Note: The API supports filtering by Make Name directly.
     */
    getModelsForMake: async (makeName: string): Promise<VehicleModel[]> => {
        // Sanitize make name for cache key
        const cacheKey = `models_${makeName.toLowerCase()}`;

        if (modelCache[cacheKey]) {
            return modelCache[cacheKey];
        }

        try {
            // The API allows getting models for a make by name: /getmodelsformake/honda
            const encodedMake = encodeURIComponent(makeName);
            const response = await fetch(`${VPIC_BASE_URL}/getmodelsformake/${encodedMake}?format=json`);
            if (!response.ok) throw new Error(`Failed to fetch models for ${makeName}`);

            const data = await response.json();
            const results = data.Results || [];

            // Cache the results
            modelCache[cacheKey] = results;
            return results;
        } catch {
            return [];
        }
    },

    getVariantOptions: async (args: { make: string; model: string; year: number }, opts?: { signal?: AbortSignal }): Promise<VehicleVariantOption[]> => {
        const query = new URLSearchParams({
            make: String(args.make || ''),
            model: String(args.model || ''),
            year: String(args.year || ''),
        });
        const response = await fetch(`/api/vehicle-enrichment/variants?${query.toString()}`, { signal: opts?.signal, headers: operatingRequestHeaders() });
        if (!response.ok) {
            let bodyText = '';
            try {
                bodyText = await response.text();
            } catch {
                bodyText = '';
            }
            throw new Error(`Vehicle variant lookup failed (${response.status})${bodyText ? `: ${bodyText}` : ''}`);
        }
        const json = (await response.json()) as Record<string, unknown>;
        const data = (json.data || {}) as Record<string, unknown>;
        return Array.isArray(data.options) ? (data.options as VehicleVariantOption[]) : [];
    },

    getVariantEnrichment: async (variantId: string, opts?: { signal?: AbortSignal }): Promise<VehicleEnrichmentResult> => {
        const response = await fetch(`/api/vehicle-enrichment/variant/${encodeURIComponent(variantId)}`, { signal: opts?.signal, headers: operatingRequestHeaders() });
        if (!response.ok) throw new Error(`Vehicle enrichment lookup failed (${response.status})`);
        const json = (await response.json()) as Record<string, unknown>;
        const data = (json.data || {}) as VehicleEnrichmentResult;
        if (!data || typeof data !== 'object') throw new Error('Invalid vehicle enrichment payload');
        return data;
    },
};

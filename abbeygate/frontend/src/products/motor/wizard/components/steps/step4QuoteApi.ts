import { questionnaireToRating } from '../../questionnaireProjection';
import type { QuoteData } from '../../types';
import { isBreakdownCoverIncluded } from './step4QuoteDomain';
import { buildPublicSessionUrl } from '@/src/shared/lib/wizard/buildPublicSessionUrl';

type RecsApiResponse = {
  success?: boolean;
  data?: RecsPayload;
  error?: { message?: string };
};

type RecommendationsFetchResult = { status: number; ok: boolean; json: RecsApiResponse | null };

const recommendationsInFlight = new Map<string, Promise<RecommendationsFetchResult>>();
const recommendationsRecent = new Map<string, { atMs: number; value: RecommendationsFetchResult }>();
const extrasPricingCache = new Map<string, ExtrasPricingResult>();
const extrasPricingInFlight = new Map<string, Promise<ExtrasPricingResult>>();

const RECOMMENDATIONS_RECENT_TTL_MS = 4000;

export type RecommendationItem = {
  bundleId: string;
  quoteOption?: {
    annualPremium?: number;
    voluntaryExcess?: number;
    totalExcess?: number;
  };
  attrs?: {
    excess?: number;
    claimProtection?: boolean;
    vipRoadside?: boolean;
  };
};

export type RecsPayload = {
  artifactVersion?: string;
  modelKey?: string;
  recommendations?: RecommendationItem[];
};

export type ExtrasPricingResult = {
  baseAnnual: number | null;
  vipAnnual: number | null;
  ncbAnnual: number | null;
};

export type QuoteDocument = {
  type?: string;
  publicUrl?: string;
  storageUri?: string;
};

async function fetchRecommendationsOnce(
  key: string,
  policyId: string,
  deps?: { fetchFn?: typeof fetch; nowMs?: () => number }
): Promise<RecommendationsFetchResult> {
  const fetchFn = deps?.fetchFn ?? fetch;
  const nowMs = deps?.nowMs ?? (() => Date.now());
  const recent = recommendationsRecent.get(key);
  if (recent && nowMs() - recent.atMs <= RECOMMENDATIONS_RECENT_TTL_MS) {
    return recent.value;
  }
  const existing = recommendationsInFlight.get(key);
  if (existing) return await existing;
  const request = (async () => {
    const response = await fetchFn(buildPublicSessionUrl('motor', policyId, 'recommendations'));
    const json = (await response.json().catch(() => null)) as RecsApiResponse | null;
    const value = { status: response.status, ok: response.ok, json };
    if (response.ok && json && typeof json === 'object' && Boolean((json as { success?: boolean }).success)) {
      recommendationsRecent.set(key, { atMs: nowMs(), value });
    }
    return value;
  })();
  recommendationsInFlight.set(key, request);
  try {
    return await request;
  } finally {
    recommendationsInFlight.delete(key);
  }
}

export async function loadStep4Recommendations(params: {
  key: string;
  policyId: string;
  maxAttempts?: number;
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  fetchFn?: typeof fetch;
  nowMs?: () => number;
}): Promise<RecsPayload | null> {
  const maxAttempts = params.maxAttempts ?? 4;
  const retryDelayMs = params.retryDelayMs ?? 1200;
  const sleep = params.sleep ?? ((ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms)));
  let attempts = 0;
  while (true) {
    const { status, ok, json } = await fetchRecommendationsOnce(params.key, params.policyId, {
      fetchFn: params.fetchFn,
      nowMs: params.nowMs,
    });
    if (status === 422) {
      attempts += 1;
      if (attempts < maxAttempts) {
        await sleep(retryDelayMs);
        continue;
      }
      throw new Error('Recommendations are not ready yet. Please retry in a moment.');
    }
    if (!ok || !json?.success) throw new Error(json?.error?.message || 'Failed to load recommendations');
    return json.data || null;
  }
}

export async function postStep4RecommendationsDisplayed(params: {
  policyId: string;
  quoteReference: string;
  shownBundleIds: string[];
  artifactVersion?: string;
  modelKey?: string;
  fetchFn?: typeof fetch;
}): Promise<void> {
  const fetchFn = params.fetchFn ?? fetch;
  if (!params.shownBundleIds.length) return;
  await fetchFn(buildPublicSessionUrl('motor', params.policyId, 'recommendations/events'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'display',
      quoteRef: params.quoteReference,
      artifactVersion: params.artifactVersion,
      modelKey: params.modelKey,
      shownBundleIds: params.shownBundleIds,
      uiContext: { placement: 'step4_other_options' },
    }),
  }).catch(() => undefined);
}

export function getCachedStep4ExtrasPricing(cacheKey: string): ExtrasPricingResult | null {
  return extrasPricingCache.get(cacheKey) || null;
}

function toCoverageSelectionPayload(selectedOptions: Record<string, boolean>) {
  return {
    selected: selectedOptions,
    source: 'CUSTOMER_RECS',
  };
}

async function rateAnnualPreview(args: {
  policyId: string;
  data: QuoteData;
  baseExcess: number;
  selectedOptions: Record<string, boolean>;
  fetchFn?: typeof fetch;
}): Promise<number | null> {
  const fetchFn = args.fetchFn ?? fetch;
  try {
    const response = await fetchFn(buildPublicSessionUrl('motor', args.policyId, 'rate'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteData: questionnaireToRating(args.data).quoteData,
        previewOnly: true,
        overrideExcess: args.baseExcess,
        coverageSelection: toCoverageSelectionPayload(args.selectedOptions),
      }),
    });
    const json = await response.json().catch(() => null);
    if (!response.ok || !json?.success) return null;
    const annual = Number(json?.data?.primaryOption?.annualPremium ?? 0);
    return Number.isFinite(annual) && annual > 0 ? annual : null;
  } catch {
    return null;
  }
}

export async function loadStep4ExtrasPricing(params: {
  cacheKey: string;
  policyId: string;
  data: QuoteData;
  baseExcess: number;
  baseAnnual: number | null;
  currentHasNcbFromQuote: boolean;
  currentHasVipFromQuote: boolean;
  currentHasRoadsideFromQuote: boolean;
  isComprehensiveCover: boolean;
  fetchFn?: typeof fetch;
}): Promise<ExtrasPricingResult> {
  const cached = extrasPricingCache.get(params.cacheKey);
  if (cached) return cached;
  const existing = extrasPricingInFlight.get(params.cacheKey);
  if (existing) return await existing;
  const task = (async () => {
    const [vipAnnual, ncbAnnual] = await Promise.all([
      rateAnnualPreview({
        policyId: params.policyId,
        data: params.data,
        baseExcess: params.baseExcess,
        selectedOptions: {
          'CV 172': Boolean(params.currentHasNcbFromQuote),
          'COV-ROADSIDE': true,
          'COV-ROADSIDE-VIP': true,
        },
        fetchFn: params.fetchFn,
      }),
      rateAnnualPreview({
        policyId: params.policyId,
        data: params.data,
        baseExcess: params.baseExcess,
        selectedOptions: {
          'CV 172': true,
          'COV-ROADSIDE': isBreakdownCoverIncluded({
            isComprehensiveCover: params.isComprehensiveCover,
            vipRoadsideSelected: false,
            alreadyOnQuote: Boolean(params.currentHasRoadsideFromQuote),
          }),
          'COV-ROADSIDE-VIP': Boolean(params.currentHasVipFromQuote),
        },
        fetchFn: params.fetchFn,
      }),
    ]);
    return { baseAnnual: params.baseAnnual, vipAnnual, ncbAnnual };
  })();
  extrasPricingInFlight.set(params.cacheKey, task);
  try {
    const result = await task;
    extrasPricingCache.set(params.cacheKey, result);
    return result;
  } finally {
    extrasPricingInFlight.delete(params.cacheKey);
  }
}

export async function verifyUserSession(authToken: string, fetchFn?: typeof fetch): Promise<boolean> {
  const request = fetchFn ?? fetch;
  try {
    const response = await request('/api/users/me', {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function sendStep4QuoteEmail(params: {
  policyId: string;
  verifiedEmail?: string;
  quoteEmailProof?: string;
  authToken?: string;
  fetchFn?: typeof fetch;
}): Promise<{ success: true } | { success: false; message: string }> {
  const request = params.fetchFn ?? fetch;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (params.authToken) headers.Authorization = `Bearer ${params.authToken}`;
  const body: Record<string, string> = {};
  if (params.verifiedEmail) body.verifiedEmail = params.verifiedEmail;
  if (params.quoteEmailProof) body.quoteEmailProof = params.quoteEmailProof;
  const response = await request(buildPublicSessionUrl('motor', params.policyId, 'quote/send'), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok || !json?.success) {
    const serverMessage = String(json?.error?.message || '').trim();
    return { success: false, message: serverMessage || 'Quote email could not be sent. Please try again.' };
  }
  return { success: true };
}

export async function generateStep4QuoteDocuments(params: {
  policyId: string;
  fetchFn?: typeof fetch;
}): Promise<{ success: true; documents: QuoteDocument[] } | { success: false; message: string }> {
  const request = params.fetchFn ?? fetch;
  const response = await request(buildPublicSessionUrl('motor', params.policyId, 'documents/generate'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ docPack: 'QUOTE_PACK' }),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok || !json?.success) {
    return { success: false, message: String(json?.error?.message || 'Error') };
  }
  return { success: true, documents: (json?.data?.documents || []) as QuoteDocument[] };
}

export async function postStep4RecommendationSelected(params: {
  policyId: string;
  quoteRef: string | undefined;
  artifactVersion?: string;
  modelKey?: string;
  shownBundleIds?: string[];
  selectedBundleId: string;
  fetchFn?: typeof fetch;
}): Promise<void> {
  const request = params.fetchFn ?? fetch;
  await request(buildPublicSessionUrl('motor', params.policyId, 'recommendations/events'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'select',
      quoteRef: params.quoteRef,
      artifactVersion: params.artifactVersion,
      modelKey: params.modelKey,
      shownBundleIds: params.shownBundleIds,
      selectedBundleId: params.selectedBundleId,
      uiContext: { placement: 'step4_other_options' },
    }),
  }).catch(() => undefined);
}

export async function rateStep4BundleSelection(params: {
  policyId: string;
  quoteData: unknown;
  overrideExcess: number;
  selectedOptions: Record<string, boolean>;
  fetchFn?: typeof fetch;
}): Promise<{ success: true; data: unknown } | { success: false; message: string }> {
  const request = params.fetchFn ?? fetch;
  const response = await request(buildPublicSessionUrl('motor', params.policyId, 'rate'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteData: params.quoteData,
      overrideExcess: params.overrideExcess,
      coverageSelection: toCoverageSelectionPayload(params.selectedOptions),
    }),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok || !json?.success) {
    return { success: false, message: String(json?.error?.message || 'Failed to apply option') };
  }
  return { success: true, data: json?.data };
}

export function __resetStep4QuoteApiCaches() {
  recommendationsInFlight.clear();
  recommendationsRecent.clear();
  extrasPricingCache.clear();
  extrasPricingInFlight.clear();
}

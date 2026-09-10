import type { QuoteResponse } from '../../../platform/types/autoInsurance.js';
import { extractAutoRecsFeatures } from '../domain/featureExtractor.js';
import { getCatalog, getModelProvider } from '../domain/registry.js';
import { banditReRank, shouldApplyBanditForSeed } from './bandit.js';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import type { CatalogRecommendation, QuoteOptionLike } from '../domain/catalog/catalog.js';

export type RecsEngineResult = {
  artifactVersion: string;
  modelKey: string;
  segmentUsed: { schemaLevel: string; key: string };
  segmentSampleSize: number;
  recommendations: Array<{
    bundleId: string;
    attrs: Record<string, unknown>;
    probability: number;
    confidence?: number;
    reason?: string;
    quoteOption?: QuoteOptionLike;
    optionKey?: string;
  }>;
};

type UnknownRecord = Record<string, unknown>;
type QuoteDataLike = UnknownRecord & { requiredExcess?: unknown; __meta?: unknown };

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : {};
}

function parseRequestedExcess(quoteData: QuoteDataLike): number {
  const raw = quoteData.requiredExcess;
  const n = parseInt(String(raw || '').replace(/[^0-9]/g, '') || '0', 10);
  return Number.isFinite(n) && n > 0 ? n : 250;
}

function tierFor(attrs: Record<string, unknown>): 'cheap' | 'balanced' | 'premium' {
  const excess = Number(attrs.excess ?? 0) || 0;
  const cp = Boolean(attrs.claimProtection);
  const vip = Boolean(attrs.vipRoadside);
  if (vip) return 'premium';
  if (cp && excess >= 750) return 'premium';
  if (excess >= 1000) return 'premium';
  if (excess >= 750) return 'balanced';
  return 'cheap';
}

export class RecommendationsEngine {
  static async recommendForWorkspace(args: {
    tenantId: string;
    quoteData: QuoteDataLike;
    quoteResponse: QuoteResponse | null;
    programId?: string | null;
    productType?: string;
  }): Promise<RecsEngineResult> {
    const tenantId = String(args.tenantId || '').trim();
    if (!tenantId) throw new Error('tenantId is required for recommendations');
    const productType = String(args?.productType || '').toUpperCase();
    if (!productType) throw new Error('productType is required for recommendations');

    const catalog = getCatalog({ tenantId, productType });
    if (!catalog) return {
      artifactVersion: 'none', modelKey: 'none',
      segmentUsed: { schemaLevel: 'none', key: '' },
      segmentSampleSize: 0, recommendations: [],
    };
    const provider = getModelProvider();
    const modelKey = provider.key;

    let mbeProductConfig: unknown = asRecord(args.quoteData.__meta).mbeProductConfig;
    try {
      if (!mbeProductConfig) {
        const prog = args.programId
          ? await tenantScopedPrisma.program.findUnique({ where: { id: args.programId }, select: { metadata: true } })
          : await tenantScopedPrisma.program.findFirst({ where: { status: 'ACTIVE' }, orderBy: { updatedAt: 'desc' }, select: { metadata: true } });
        mbeProductConfig = asRecord(prog?.metadata).mbeProductConfig;
      }
    } catch {
      // best-effort
    }
    const quoteData: QuoteDataLike = mbeProductConfig
      ? { ...args.quoteData, __meta: { ...asRecord(args.quoteData.__meta), mbeProductConfig } }
      : args.quoteData;

    const candidates = catalog.listCandidates({ quoteData, quoteResponse: args.quoteResponse });
    const candidateBundleIds = candidates.map((c) => String(c.bundleId));

    const features = extractAutoRecsFeatures(quoteData);
    const scored = await provider.infer({
      features,
      candidateBundleIds,
      context: { tenantId, productType, modelKey },
    });

    const scoreById = new Map(scored.scores.map((s) => [String(s.bundleId), Number(s.probability || 0)]));
    const confById = new Map(scored.scores.map((s) => [String(s.bundleId), Number(asRecord(s).confidence ?? 0)]));
    const reasonById = new Map(scored.scores.map((s) => [String(s.bundleId), String(asRecord(s).reason ?? '')]));

    type ResolvedCandidate = {
      resolved: CatalogRecommendation & { quoteOption: QuoteOptionLike };
      p: number;
      confidence?: number;
      reason?: string;
      tier: 'cheap' | 'balanced' | 'premium';
      attrs: Record<string, unknown>;
      bandit?: number;
    };

    let resolvedCandidates: ResolvedCandidate[] = [];
    for (const c of candidates) {
      const p = scoreById.get(String(c.bundleId)) ?? 0;
      const resolved = catalog.resolveQuoteOption({
        quoteData,
        quoteResponse: args.quoteResponse,
        candidate: c,
      });
      if (!resolved?.quoteOption) continue;
      const attrs = asRecord(resolved.attrs);
      resolvedCandidates.push({
        resolved: { ...resolved, quoteOption: resolved.quoteOption },
        p,
        confidence: confById.get(String(c.bundleId)) ?? undefined,
        reason: reasonById.get(String(c.bundleId)) || undefined,
        tier: tierFor(attrs),
        attrs,
      });
    }

    resolvedCandidates.sort((a, b) => b.p - a.p);

    const banditSeed = String(args.quoteResponse?.reference || '') || String(parseRequestedExcess(quoteData));
    if (shouldApplyBanditForSeed(banditSeed)) {
      const topN = resolvedCandidates.slice(0, 8);
      const samples = await banditReRank({
        tenantId,
        productType,
        bundleIds: topN.map((x) => String(x.resolved.bundleId)),
      });
      const byId = new Map(samples.map((s) => [String(s.bundleId), Number(s.sample || 0)]));
      topN.forEach((x) => {
        x.bandit = byId.get(String(x.resolved.bundleId)) ?? 0;
      });
      topN.sort((a, b) => Number(b.bandit || 0) - Number(a.bandit || 0));
      resolvedCandidates = [...topN, ...resolvedCandidates.slice(8)];
    }

    const picked: ResolvedCandidate[] = [];
    const byTier: Record<'cheap' | 'balanced' | 'premium', ResolvedCandidate[]> = { cheap: [], balanced: [], premium: [] };
    resolvedCandidates.forEach((x) => {
      (byTier[x.tier] || byTier.cheap).push(x);
    });

    (['cheap', 'balanced', 'premium'] as const).forEach((t) => {
      if (byTier[t].length) picked.push(byTier[t][0]);
    });
    for (const x of resolvedCandidates) {
      if (picked.length >= 4) break;
      if (picked.some((p) => String(p.resolved.bundleId) === String(x.resolved.bundleId))) continue;
      picked.push(x);
    }

    const requestedExcess = parseRequestedExcess(quoteData);
    const requestedId = `EX${requestedExcess}_CP0_VIP0`;
    if (!picked.some((p) => String(p.resolved.bundleId) === requestedId)) {
      const req = resolvedCandidates.find((x) => String(x.resolved.bundleId) === requestedId);
      if (req) {
        if (picked.length < 4) picked.push(req);
        else {
          const lowestIdx = picked.reduce((acc, cur, idx) => (cur.p < picked[acc].p ? idx : acc), 0);
          picked[lowestIdx] = req;
        }
      }
    }

    const out = picked
      .slice(0, 4)
      .map((x) => ({
        bundleId: String(x.resolved.bundleId),
        attrs: x.attrs,
        probability: x.p,
        confidence: x.confidence,
        reason: x.reason,
        quoteOption: x.resolved.quoteOption,
        optionKey: x.resolved.optionKey,
      }));

    return {
      artifactVersion: scored.artifactVersion,
      modelKey,
      segmentUsed: scored.segmentUsed,
      segmentSampleSize: scored.segmentSampleSize,
      recommendations: out,
    };
  }
}

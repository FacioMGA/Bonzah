import type { RecommendationCatalog, CatalogCandidate, QuoteResponseLike, QuoteOptionLike, AutoBundleAttrs } from '../catalog.js';
import { makeAutoBundleId } from '../catalog.js';
type UnknownRecord = Record<string, unknown>;
const asRecord = (value: unknown): UnknownRecord =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : {};

function ratedExcesses(quoteResponse: QuoteResponseLike | null): number[] {
  if (!quoteResponse) return [];
  return [...new Set(
    [quoteResponse.primaryOption, ...quoteResponse.alternatives]
      .map((option) => Number(option.voluntaryExcess))
      .filter((excess) => Number.isFinite(excess) && excess > 0),
  )].sort((left, right) => left - right);
}

/**
 * Abbeygate Motor (MOTOR) bundle catalog.
 *
 * v1 bundle space:
 * - Excess (pricing dimension)\n+ * - Claim protection (CV 172)\n+ * - VIP Roadside (COV-ROADSIDE + COV-ROADSIDE-VIP)\n+ *
 * The catalog produces candidates broadly, then `resolveQuoteOption` computes a priced QuoteOption for
 * candidates that are eligible and realizable under MBE + pricing.
 */
export const abbeygateAutoCatalogV1: RecommendationCatalog = {
  key: 'abbeygate:auto',
  version: '1',
  context: { tenantId: 'default', productType: 'MOTOR' },

  listCandidates(args: { quoteData: unknown; quoteResponse: QuoteResponseLike | null }): CatalogCandidate[] {
    const candidates: CatalogCandidate[] = [];
    const availableExcesses = ratedExcesses(args.quoteResponse);

    // Recommendations can only expose options returned by the canonical quote
    // response, which was calculated with the mapped programme model.
    for (const excess of availableExcesses) {
      for (const claimProtection of [false, true]) {
        for (const vipRoadside of [false, true]) {
          const attrs: AutoBundleAttrs = { excess, claimProtection, vipRoadside };
          candidates.push({ bundleId: makeAutoBundleId(attrs), attrs, optionKey: makeAutoBundleId(attrs) });
        }
      }
    }

    return candidates;
  },

  resolveQuoteOption(args: {
    quoteData: unknown;
    quoteResponse: QuoteResponseLike | null;
    candidate: CatalogCandidate;
  }) {
    const c = args.candidate;
    const attrs = asRecord(c.attrs);
    const excess = Number(attrs.excess);
    const claimProtection = Boolean(attrs.claimProtection);
    const vipRoadside = Boolean(attrs.vipRoadside);

    if (!Number.isFinite(excess) || excess <= 0) return null;
    // Try to map to an existing priced option by excess if the bundle has no add-ons.
    // This preserves UX parity with the current quote response while we expand the bundle space.
    if (!claimProtection && !vipRoadside && args.quoteResponse) {
      const all = [args.quoteResponse.primaryOption, ...(args.quoteResponse.alternatives || [])].filter(Boolean);
      const hit = all.find((o) => Number(o?.voluntaryExcess ?? 0) === excess);
      if (hit) {
        return {
          bundleId: c.bundleId,
          attrs: { excess, claimProtection, vipRoadside },
          quoteOption: hit as QuoteOptionLike,
          optionKey: `excess=${excess}`,
        };
      }
    }

    // Recommendations may only surface a price produced by the canonical
    // quote response. Re-rating a bundle here would bypass the programme's
    // active model and silently use a deployed matrix.
    return null;
  },
};

import type { QuoteOptionDTO, QuoteResponseDTO } from '../../../../platform/types/contracts.js';

export type TenantId = string;
export type ProductType = string;

export type BundleId = string;

export type AutoBundleAttrs = {
  excess: number;
  claimProtection: boolean;
  vipRoadside: boolean;
};

export type BundleAttrs = Record<string, unknown>;

export type BundleDefinition<TAttrs extends BundleAttrs = BundleAttrs> = {
  bundleId: BundleId;
  attrs: TAttrs;
};

export type QuoteOptionLike = QuoteOptionDTO;
export type QuoteResponseLike = QuoteResponseDTO;

export type CatalogContext = {
  tenantId: TenantId;
  productType: ProductType;
};

export type CatalogCandidate = BundleDefinition & {
  /**
   * Optional key to map a recommendation to an already-priced quote alternative.
   * If absent, the recommendation engine may compute a priced option for this bundle.
   */
  optionKey?: string;
};

export type CatalogRecommendation = {
  bundleId: BundleId;
  attrs: BundleAttrs;
  /**
   * Quote option that the UI can render (same shape as primary/alternatives).
   * If absent, the UI must not display the recommendation.
   */
  quoteOption?: QuoteOptionLike;
  /**
   * A stable key for correlating to existing quote options when possible.
   * Example: `excess=750` or `EX750_CP0_VIP0`.
   */
  optionKey?: string;
};

export interface RecommendationCatalog {
  key: string;
  version: string;
  context: CatalogContext;

  listCandidates(args: { quoteData: unknown; quoteResponse: QuoteResponseLike | null }): CatalogCandidate[];

  /**
   * Given a bundle/candidate, attempt to map it to a realizable priced option.
   * Implementations may:\n+   * - map to an existing `quoteResponse.alternatives` entry, OR\n+   * - compute a new priced option (preferred for rich bundle spaces).\n+   */
  resolveQuoteOption(args: {
    quoteData: unknown;
    quoteResponse: QuoteResponseLike | null;
    candidate: CatalogCandidate;
  }): CatalogRecommendation | null;
}

export function bool01(v: unknown): '0' | '1' {
  return v ? '1' : '0';
}

export function makeAutoBundleId(attrs: AutoBundleAttrs): BundleId {
  return `EX${Number(attrs.excess)}_CP${bool01(attrs.claimProtection)}_VIP${bool01(attrs.vipRoadside)}`;
}


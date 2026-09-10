import type { PremiumCalculation } from '../../../platform/types/index.js';
import type {
  BuildQuoteResponseContext,
  DocPackGenerationArgs,
  DocPackGenerationResult,
  EndorsementPremiumResult,
  ProductViewModelBuilderParams,
  QuoteResponseResult,
} from './productContracts.js';

export type ProductEngineKind = 'compiled' | 'table' | 'template';

export type RatingEngineCalculateInput = {
  productType: string;
  quoteData: unknown;
  options?: { overrideExcess?: number | string | null };
  ratingModel?: BuildQuoteResponseContext['ratingModel'];
  context?: BuildQuoteResponseContext;
  uwDecision?: unknown;
};

export type RatingEngineCalculateResult = {
  premiumCalculation: PremiumCalculation;
  trace?: Record<string, unknown>;
};

export interface IRatingEngine {
  readonly engineId: string;
  readonly kind: ProductEngineKind;
  calculate(input: RatingEngineCalculateInput): Promise<RatingEngineCalculateResult> | RatingEngineCalculateResult;
  buildQuoteResponse(input: RatingEngineCalculateInput): Promise<QuoteResponseResult>;
  /** Validates a persisted programme model before it can become ACTIVE. */
  validateProgramRatingModel?(model: unknown): void;
  calculateEndorsementPremium(
    quoteData: unknown,
    appliedEndorsements: Array<{ code: string; params?: unknown }>,
    context?: BuildQuoteResponseContext,
  ): Promise<EndorsementPremiumResult>;
}

export type UwEngineInput = {
  productType: string;
  quoteData: unknown;
  context?: BuildQuoteResponseContext;
};

export type UwEngineResult = {
  decision: Record<string, unknown>;
  analysis?: Record<string, unknown>;
  trace?: Record<string, unknown>;
};

export interface IUwEngine {
  readonly engineId: string;
  readonly kind: ProductEngineKind;
  evaluate(input: UwEngineInput): Promise<UwEngineResult> | UwEngineResult;
  /** Validates the complete persisted programme underwriting authority. */
  validateProgramUwConfig?(config: unknown): void;
}

export interface IWordingEngine {
  readonly engineId: string;
  readonly kind: ProductEngineKind;
  getDocPackJobName(): string;
  render(args: DocPackGenerationArgs): Promise<DocPackGenerationResult>;
  buildDocViewModel?(params: ProductViewModelBuilderParams): Record<string, unknown> | null;
}

export type ProductEngines = {
  rating: IRatingEngine;
  underwriting: IUwEngine;
  wording: IWordingEngine;
};

export type EngineContext = {
  programId?: string | null;
  binderId?: string | null;
  tenantId?: string | null;
};

export type ProductEngineProvider = ProductEngines | ((ctx: EngineContext) => ProductEngines);

export function resolveProductEngines(provider: ProductEngineProvider, ctx: EngineContext = {}): ProductEngines {
  return typeof provider === 'function' ? provider(ctx) : provider;
}

import type {
  BindRulesResult,
  BuildQuoteResponseContext,
  BuildVersionRowsArgs,
  CustomerJourneyMeta,
  DocPackGenerationArgs,
  DocPackGenerationResult,
  EndorsementPremiumResult,
  ProductViewModelBuilderParams,
  QuoteResponseResult,
  ProductGoldenFixtures,
  UwNormalizationResult,
  VersionMeta,
  VersionRow,
} from './productContracts.js';
import type { PremiumCalculation } from '../../../platform/types/index.js';
import type { ClaimsContract } from '../../claims/domain/claimsContract.js';
import type { ProductManifest } from '@facio/products';
import type { ProductDiscoverabilityInput, ProductDiscoverabilityProjection } from '../app/discoverability/types.js';
import type { ProductEngineProvider } from './productEngines.js';

export type ProductRuntimeExecutionMode = 'manifest_only' | 'runtime_config' | 'plugin';

export type RatingFrameworkDefinition = {
  framework: 'unified-rating';
  mode: 'table_assets' | 'plugin';
  assetRefs: string[];
  pluginKey?: string;
  traceSchemaVersion: string;
};

export type IntakeRuntimeDefinition = {
  publicSessionSlug: string;
  publicEntryPath: string;
  firstStep: string;
  validationMode: 'manifest_only' | 'product_schema';
};

export type ProductRuntimeDefinition = {
  productType: string;
  displayName: string;
  executionMode: ProductRuntimeExecutionMode;
  manifest: ProductManifest;
  defaultClaimsContract: ClaimsContract;
  requiredIssuedDocTypes: string[];
  goldenFixtures: ProductGoldenFixtures;
  customerJourney: CustomerJourneyMeta;
  intake: IntakeRuntimeDefinition;
  rating: RatingFrameworkDefinition;
  engines: ProductEngineProvider;
  getDocPackJobName(): string;
  calculatePremium(data: unknown, options?: { overrideExcess?: number | string | null }): PremiumCalculation;
  buildQuoteResponse(quoteData: unknown, programMeta: unknown, context?: BuildQuoteResponseContext): Promise<QuoteResponseResult>;
  validateBindRules(quoteData: unknown, binderConfig: unknown): BindRulesResult;
  normalizeUwData(quoteData: unknown): UwNormalizationResult;
  buildVersionMeta(quoteData: unknown): VersionMeta;
  buildVersionRows(args: BuildVersionRowsArgs): VersionRow[];
  buildProductFields?(quoteData: unknown): Record<string, unknown>;
  getCustomerJourneyMeta(): CustomerJourneyMeta;
  buildDocViewModel?(params: ProductViewModelBuilderParams): Record<string, unknown> | null;
  buildDiscoverabilityProjection?(input: ProductDiscoverabilityInput): ProductDiscoverabilityProjection;
  generateDocPack(args: DocPackGenerationArgs): Promise<DocPackGenerationResult>;
  getRatingMatrixSnapshot(): Promise<Record<string, unknown> | null>;
  calculateEndorsementPremium(
    quoteData: unknown,
    appliedEndorsements: Array<{ code: string; params?: unknown }>,
  ): Promise<EndorsementPremiumResult>;
};

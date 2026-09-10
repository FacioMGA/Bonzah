import type {
  BindRulesResult,
  BuildQuoteResponseContext,
  BuildVersionRowsArgs,
  CustomerJourneyMeta,
  DocPackGenerationArgs,
  DocPackGenerationResult,
  EndorsementPremiumResult,
  QuoteResponseResult,
  UwNormalizationResult,
  VersionMeta,
  VersionRow,
} from './productContracts.js';
import type { PremiumCalculation } from '../../../platform/types/index.js';
import { BaseManifestProductAdapter } from './BaseManifestProductAdapter.js';
import type { ProductRuntimeDefinition } from './productRuntimeDefinition.js';
import { resolveProductEngines } from './productEngines.js';

export type ManifestProductRuntimeConfig = ProductRuntimeDefinition;

export class ManifestRuntimeProductAdapter extends BaseManifestProductAdapter {
  readonly productType: string;
  readonly displayName: string;

  constructor(private readonly config: ManifestProductRuntimeConfig) {
    super(config.manifest, config.defaultClaimsContract, config.requiredIssuedDocTypes);
    this.productType = config.productType;
    this.displayName = config.displayName;
  }

  getRuntimeDefinition(): ProductRuntimeDefinition {
    return this.config;
  }

  getDocPackJobName(): string {
    return resolveProductEngines(this.config.engines).wording.getDocPackJobName();
  }

  calculatePremium(data: unknown, options?: { overrideExcess?: number | string | null }): PremiumCalculation {
    const result = resolveProductEngines(this.config.engines).rating.calculate({ productType: this.productType, quoteData: data, options });
    if (result instanceof Promise) throw new Error(`${this.productType} rating engine returned async result for calculatePremium`);
    return result.premiumCalculation;
  }

  buildQuoteResponse(quoteData: unknown, programMeta: unknown, context?: BuildQuoteResponseContext): Promise<QuoteResponseResult> {
    return this.config.buildQuoteResponse(quoteData, programMeta, context);
  }

  validateBindRules(quoteData: unknown, binderConfig: unknown): BindRulesResult {
    return this.config.validateBindRules(quoteData, binderConfig);
  }

  normalizeUwData(quoteData: unknown): UwNormalizationResult {
    return this.config.normalizeUwData(quoteData);
  }

  buildVersionMeta(quoteData: unknown): VersionMeta {
    return this.config.buildVersionMeta(quoteData);
  }

  buildProductFields(quoteData: unknown): Record<string, unknown> {
    return this.config.normalizeUwData(quoteData).productFields || {};
  }

  getCustomerJourneyMeta(): CustomerJourneyMeta {
    return this.config.getCustomerJourneyMeta();
  }

  buildVersionRows(args: BuildVersionRowsArgs): VersionRow[] {
    return this.config.buildVersionRows(args);
  }

  generateDocPack(args: DocPackGenerationArgs): Promise<DocPackGenerationResult> {
    return this.config.generateDocPack(args);
  }

  getRatingMatrixSnapshot(): Promise<Record<string, unknown> | null> {
    return this.config.getRatingMatrixSnapshot();
  }

  calculateEndorsementPremium(
    quoteData: unknown,
    appliedEndorsements: Array<{ code: string; params?: unknown }>,
  ): Promise<EndorsementPremiumResult> {
    return this.config.calculateEndorsementPremium(quoteData, appliedEndorsements);
  }
}

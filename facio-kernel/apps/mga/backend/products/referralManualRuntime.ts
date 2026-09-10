import type {
  BindRulesResult,
  BuildQuoteResponseContext,
  BuildVersionRowsArgs,
  CustomerJourneyMeta,
  DocPackGenerationArgs,
  DocPackGenerationResult,
  EndorsementPremiumResult,
  QuoteResponseResult,
  ProductGoldenFixtures,
  UwNormalizationResult,
  VersionMeta,
  VersionRow,
} from '../modules/policy/domain/productContracts.js';
import type { ManifestProductRuntimeConfig } from '../modules/policy/domain/ManifestRuntimeProductAdapter.js';
import { defineProgrammeDefinitionEditor } from '../modules/policy/domain/productRuntimeDefinition.js';
import type { ProductEngines, UwEngineResult } from '../modules/policy/domain/productEngines.js';
import { resolveProductEngines } from '../modules/policy/domain/productEngines.js';
import type { PremiumCalculation } from '../platform/types/index.js';
import type { ProductManifest } from '@facio/products';

type JsonObject = { [k: string]: unknown };

type ManualRuntimeArgs = {
  productType: string;
  displayName: string;
  manifest: ProductManifest;
  publicSessionSlug: string;
  publicEntryPath: string;
  firstStep: string;
  customerJourney: CustomerJourneyMeta;
  versionSection: string;
  versionCoverageLabel: string;
  bdxClassOfBusiness: string;
  goldenFixtures?: ProductGoldenFixtures;
  premiumFromQuoteData?: (quoteData: unknown) => number;
  normalizeProductFields?: (quoteData: JsonObject) => Record<string, unknown>;
  buildInsuredValueDisplay?: (quoteData: JsonObject) => string;
};

export function buildManualReferralRuntimeConfig(args: ManualRuntimeArgs): ManifestProductRuntimeConfig {
  const engines = buildManualReferralEngines(args);

  const config: ManifestProductRuntimeConfig = {
    productType: args.productType,
    displayName: args.displayName,
    executionMode: 'runtime_config',
    manifest: args.manifest,
    goldenFixtures: args.goldenFixtures ?? {
      minimumValid: {},
      minimumIssuable: {},
      referral: {},
    },
    customerJourney: args.customerJourney,
    intake: {
      publicSessionSlug: args.publicSessionSlug,
      publicEntryPath: args.publicEntryPath,
      firstStep: args.firstStep,
      validationMode: 'manifest_only',
    },
    rating: {
      framework: 'unified-rating',
      mode: 'plugin',
      source: 'program_model',
      assetRefs: [],
      pluginKey: `${args.productType.toLowerCase()}.manual`,
      traceSchemaVersion: 'v1',
    },
    programmeDefinitionEditor: defineProgrammeDefinitionEditor({
      productType: args.productType,
      pricingModes: ['MANUAL'],
    }),
    engines,
    getDocPackJobName(): string {
      return resolveProductEngines(config.engines).wording.getDocPackJobName();
    },
    calculatePremium(data: unknown): PremiumCalculation {
      const result = resolveProductEngines(config.engines).rating.calculate({ productType: args.productType, quoteData: data });
      if (result instanceof Promise) throw new Error(`${args.productType} manual rating engine returned async result`);
      return result.premiumCalculation;
    },
    async buildQuoteResponse(quoteData: unknown, context?: BuildQuoteResponseContext): Promise<QuoteResponseResult> {
      requireManualProgrammeDefinition(args.productType, context);
      return resolveProductEngines(config.engines).rating.buildQuoteResponse({ productType: args.productType, quoteData, context });
    },
    validateBindRules(): BindRulesResult {
      return { valid: true, errors: [] };
    },
    normalizeUwData(quoteData: unknown): UwNormalizationResult {
      const qd = asRecord(quoteData);
      return {
        normalizedQuoteData: qd,
        productFields: args.normalizeProductFields?.(qd) || qd,
      };
    },
    buildVersionMeta(quoteData: unknown): VersionMeta {
      const qd = asRecord(quoteData);
      return {
        sectionLabel: args.versionSection,
        coverageLabel: args.versionCoverageLabel,
        insuredValueDisplay: args.buildInsuredValueDisplay?.(qd) || 'Manual review',
        bdxClassOfBusiness: args.bdxClassOfBusiness,
      };
    },
    getCustomerJourneyMeta(): CustomerJourneyMeta {
      return config.customerJourney;
    },
    buildVersionRows(versionArgs: BuildVersionRowsArgs): VersionRow[] {
      return [{
        section: args.versionSection,
        riskTransType: versionArgs.riskTransTypeLabel,
        limitText: versionArgs.versionMeta?.insuredValueDisplay || 'Manual review',
        excessText: 'As agreed',
        premium: versionArgs.premiumDeltaTotal,
        currency: 'EUR',
      }];
    },
    async generateDocPack(_args: DocPackGenerationArgs): Promise<DocPackGenerationResult> {
      return { version: 1, documents: [] };
    },
    async calculateEndorsementPremium(quoteData: unknown): Promise<EndorsementPremiumResult> {
      return { premium: premiumFrom(args, quoteData), policyExcess: 0 };
    },
  };

  return config;
}

function buildManualReferralEngines(args: ManualRuntimeArgs): ProductEngines {
  return {
    rating: {
      engineId: `${args.productType.toLowerCase()}.manual.rating`,
      kind: 'compiled',
      calculate(input) {
        return { premiumCalculation: buildPremiumCalculation(args, input.quoteData) };
      },
      buildQuoteResponse(input) {
        const premium = premiumFrom(args, input.quoteData);
        const quoteResponse = {
          status: premium > 0 ? 'QUOTED' : 'REFERRAL',
          reference: input.context?.reference || `${args.productType}-${Date.now()}`,
          currency: input.context?.currency || 'EUR',
          pricingMode: 'manual',
          message: premium > 0
            ? 'Manual proposal assembled by staff.'
            : 'Manual review required. No automated premium is available for this product.',
          primaryOption: premium > 0
            ? {
                id: 'manual',
                label: 'Manual proposal',
                annualPremium: premium,
                costDetails: { totalPremium: premium },
              }
            : null,
        };
        return Promise.resolve({
          quoteResponse,
          underwritingAnalysis: {
            lane: premium > 0 ? 'manual_quote' : 'referral',
            reasons: [{ code: 'MANUAL_MARKET', message: 'Operator-managed product' }],
          },
        });
      },
      calculateEndorsementPremium(quoteData) {
        return Promise.resolve({ premium: premiumFrom(args, quoteData), policyExcess: 0 });
      },
    },
    underwriting: {
      engineId: `${args.productType.toLowerCase()}.manual.uw`,
      kind: 'compiled',
      evaluate(): UwEngineResult {
        return {
          decision: { lane: 'referral', reasons: [{ code: 'MANUAL_REVIEW', message: 'Manual underwriting required' }] },
          analysis: { lane: 'referral' },
        };
      },
    },
    wording: {
      engineId: `${args.productType.toLowerCase()}.manual.wording`,
      kind: 'compiled',
      getDocPackJobName() {
        return `DOC.GENERATE_${args.productType}_DOC_PACK`;
      },
      render() {
        return Promise.resolve({ version: 1, documents: [] });
      },
    },
  };
}

function requireManualProgrammeDefinition(productType: string, context: BuildQuoteResponseContext | undefined): void {
  const definition = context?.programDefinition;
  if (!definition) throw new Error(`${productType} requires a published programme definition.`);
  if (definition.pricingMode !== 'MANUAL') {
    throw new Error(`${productType} requires a manually priced programme definition.`);
  }
}

function premiumFrom(args: ManualRuntimeArgs, quoteData: unknown): number {
  const value = args.premiumFromQuoteData?.(quoteData) ?? 0;
  return Number.isFinite(value) && value > 0 ? Number(value.toFixed(2)) : 0;
}

function buildPremiumCalculation(args: ManualRuntimeArgs, quoteData: unknown): PremiumCalculation {
  const premium = premiumFrom(args, quoteData);
  return {
    premium,
    basis: 'FIXED_COVERAGE',
    calculationDetails: {
      fixedAmount: premium,
      calculatorVersion: `${args.productType.toLowerCase()}-manual@1.0.0`,
      steps: [
        {
          id: 'manual-premium',
          name: 'Manual premium',
          kind: 'total',
          output: premium,
        },
      ],
    },
  };
}

function asRecord(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

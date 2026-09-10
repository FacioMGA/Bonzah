import type {
  BuildVersionRowsArgs,
  BuildQuoteResponseContext,
  CustomerJourneyMeta,
  DocPackGenerationArgs,
  DocPackGenerationResult,
  EndorsementGroup,
  EndorsementPremiumResult,
  IProductAdapter,
  IssuanceValidationResult,
  ProductViewModelBuilderParams,
  QuoteResponseResult,
  ProductGoldenFixtures,
  VersionMeta,
  VersionRow,
} from './productContracts.js';
import type { ProductManifest } from '@facio/products';
import type { ProductRuntimeDefinition } from './productRuntimeDefinition.js';
import { defaultRiskIdentity, type RiskIdentity } from './riskIdentity.js';
import { buildGroupsFromManifest, buildTemplatesFromManifest } from '../../mbe/domain/manifestTemplates.js';
import type { EndorsementTemplate } from '../../mbe/domain/types.js';
import type { ProductDiscoverabilityInput, ProductDiscoverabilityProjection } from '../app/discoverability/types.js';
import { selectQuoteReadyFieldKeys } from './productFieldRequirements.js';

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : {};
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

function extractPolicyholderContact(policyHolder: ProductDiscoverabilityInput['policyHolder']): UnknownRecord {
  return asRecord(policyHolder?.contact);
}

function extractPrimaryOption(quoteResponse: unknown): UnknownRecord {
  return asRecord(asRecord(quoteResponse).primaryOption);
}

export abstract class BaseManifestProductAdapter implements IProductAdapter {
  abstract readonly productType: string;
  abstract readonly displayName: string;

  protected constructor(
    private readonly manifest: ProductManifest,
  ) {}

  getManifest(): ProductManifest {
    return this.manifest;
  }

  getRuntimeDefinition(): ProductRuntimeDefinition | null {
    return null;
  }

  getRiskIdentity(data: unknown): RiskIdentity {
    return defaultRiskIdentity(this.manifest, data);
  }

  getEndorsementCatalog(): EndorsementTemplate[] {
    return buildTemplatesFromManifest(this.manifest);
  }

  getEndorsementTemplate(code: string): EndorsementTemplate | undefined {
    return this.getEndorsementCatalog().find((template) => template.code === code);
  }

  getEndorsementGroups(): EndorsementGroup[] {
    return buildGroupsFromManifest(this.manifest);
  }

  buildDocViewModel(params: ProductViewModelBuilderParams): Record<string, unknown> | null {
    const snapshotRecord = asRecord(params.snapshotRecord);
    return {
      policy: params.policyRecord,
      quoteData: asRecord(snapshotRecord.quoteData),
    };
  }

  buildDiscoverabilityProjection(input: ProductDiscoverabilityInput): ProductDiscoverabilityProjection {
    const quoteData = asRecord(input.quoteData);
    const proposer = asRecord(quoteData.proposer);
    const contact = extractPolicyholderContact(input.policyHolder);
    const riskIdentity = this.getRiskIdentity(quoteData);
    const primaryOption = extractPrimaryOption(input.quoteResponse);
    const insuredName = firstText(
      input.policyHolder?.name,
      [proposer.firstName, proposer.lastName].filter(Boolean).join(' '),
      riskIdentity.primary,
      this.displayName,
    );
    const email = firstText(proposer.email, contact.email) || null;
    const phone = firstText(proposer.phone, contact.phone) || null;
    return {
      insuredName,
      insuredDisplay: insuredName,
      vehicleDisplay: riskIdentity.primary || null,
      policyholderDisplay: insuredName,
      policyholderEmail: email,
      policyholderPhone: phone,
      coverageStart: input.inceptionDate,
      coverageEnd: input.expiryDate,
      vehicleSearch: riskIdentity.primary || null,
      address: firstText(input.policyHolder?.address) || null,
      segment: this.displayName,
      totalPremium: Number(primaryOption.annualPremium ?? primaryOption.totalPremium ?? 0),
      renewalDate: input.expiryDate,
      quoteExpiryDate: null,
    };
  }

  getDocumentTypes(): Record<string, string> {
    return { ...this.manifest.documentTypes };
  }

  getGoldenFixtures(): ProductGoldenFixtures {
    const runtime = this.getRuntimeDefinition();
    if (!runtime?.goldenFixtures?.minimumValid) {
      throw new Error(`Product '${this.productType}' does not expose golden fixtures.`);
    }
    return runtime.goldenFixtures;
  }

  getQuoteReadyFieldKeys(): string[] {
    return selectQuoteReadyFieldKeys(this.productType);
  }

  async validateForIssuance(quoteData: unknown): Promise<IssuanceValidationResult> {
    // Single validation funnel (`spine/v2` Wave 5): every product —
    // Motor / Home / Travel / runtime-registered — routes issuance
    // validation through `validateDraftQuote`. That function performs
    // the canonical composition:
    //   1. productType + adapter assertions (PRODUCT_TYPE_REQUIRED /
    //      PRODUCT_ADAPTER_MISSING)
    //   2. `adapter.normalizeQuoteDataForValidation` pre-pass (motor's
    //      cabrio + EV + named-rider coercions, identity for others)
    //   3. `validateForContext({ stage: 'issuance' })` for schema rules
    //      (email shape, postcode-per-country, DOB range, …)
    //   4. `validateManifestRequiredFields(…, 'ISSUED_POLICY_PACK')` for
    //      required-field gaps not covered by stage refinements; the
    //      structured array is exposed as `manifestMissingFields` so
    //      this method does NOT re-run it (the prior duplicate call
    //      was deleted in Wave 5).
    const { validateDraftQuote } = await import('../../quotes/app/validator.js');
    const validation = validateDraftQuote({
      quoteData: asRecord(quoteData),
      mode: 'issuance',
      productType: this.productType,
    });
    return {
      valid: validation.valid,
      schemaIssues: validation.schemaIssues || [],
      missingSlugs: validation.missingSlugs || [],
      missingForQuotePack: validation.manifestMissingFields,
      missingForIssuedPack: validation.manifestMissingFields,
      conditionalRequirements: [],
    };
  }

  computeNonRefundableFloor(_args: { snapshot: unknown; registryFallbackPrice: number }): number {
    return 0;
  }

  isUwComplete(_quoteData: unknown, missingForIssuedPack: unknown[]): boolean {
    return Array.isArray(missingForIssuedPack) && missingForIssuedPack.length === 0;
  }

  hasValidQuoteResponse(quoteResponse: unknown): boolean {
    const primary = extractPrimaryOption(quoteResponse);
    return typeof primary.annualPremium === 'number' && Number(primary.annualPremium) > 0;
  }

  getManualUwApprovalCustomerCompletionPaths(): string[] {
    return [];
  }

  // Default identity transform: products without legacy payload variants
  // pass quote data through untouched. Motor overrides this to coerce
  // BO/wizard quirks (cabrio Yes/No, requiredExcess number→string,
  // electric vehicle engine size, motorcycle named-rider) before the
  // canonical Zod tree parses the payload.
  normalizeQuoteDataForValidation(quoteData: Record<string, unknown>): Record<string, unknown> {
    return { ...quoteData };
  }

  abstract getDocPackJobName(): string;
  abstract calculatePremium(data: unknown, options?: { overrideExcess?: number | string | null }): import('../../../platform/types/index.js').PremiumCalculation;
  abstract buildQuoteResponse(quoteData: unknown, context?: BuildQuoteResponseContext): Promise<QuoteResponseResult>;
  abstract validateBindRules(quoteData: unknown, binderConfig: unknown): { valid: boolean; errors: Array<{ field: string; message: string }> };
  abstract normalizeUwData(quoteData: unknown): { normalizedQuoteData: Record<string, unknown>; productFields?: Record<string, unknown> };
  abstract buildVersionMeta(quoteData: unknown): VersionMeta;
  abstract buildProductFields(quoteData: unknown): Record<string, unknown>;

  /**
   * Default: products do not own any legacy top-level Policy columns.
   * Motor overrides to project `vehicleInfo` and `driverInfo`.
   * See ADR-0015.
   */
  getLegacyPolicyColumnFields(_productFields: Record<string, unknown>): Record<string, unknown> {
    return {};
  }

  abstract getCustomerJourneyMeta(): CustomerJourneyMeta;
  abstract buildVersionRows(args: BuildVersionRowsArgs): VersionRow[];
  abstract generateDocPack(args: DocPackGenerationArgs): Promise<DocPackGenerationResult>;
  abstract calculateEndorsementPremium(
    quoteData: unknown,
    appliedEndorsements: Array<{ code: string; params?: unknown }>,
    context?: BuildQuoteResponseContext,
  ): Promise<EndorsementPremiumResult>;
}

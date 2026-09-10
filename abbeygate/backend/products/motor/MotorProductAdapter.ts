import type {
  IProductAdapter,
  ProductViewModelBuilderParams,
  QuoteResponseResult,
  BindRulesResult,
  UwNormalizationResult,
  VersionMeta,
  VersionRow,
  BuildVersionRowsArgs,
  IssuanceValidationResult,
  CustomerJourneyMeta,
  DocPackGenerationArgs,
  DocPackGenerationResult,
  EndorsementPremiumResult,
  EndorsementGroup,
  ProductIpidAsset,
} from '../../modules/policy/domain/productContracts.js';
import type { PremiumCalculation } from '../../platform/types/index.js';
import type { ProductDiscoverabilityInput, ProductDiscoverabilityProjection } from '../../modules/policy/app/discoverability/types.js';
import type { ProductManifest } from '@facio/products';
import { defaultRiskIdentity, type RiskIdentity } from '../../modules/policy/domain/riskIdentity.js';
import type { ClaimsContract } from '../../modules/claims/domain/claimsContract.js';
import { buildAutoInsuranceDiscoverability } from '../../modules/policy/app/discoverability/adapters/autoInsurance.js';
import { motorManifest } from '@facio/products';
import {
  TEMPLATES as MOTOR_ENDORSEMENT_TEMPLATES,
  ENDORSEMENT_GROUPS as MOTOR_ENDORSEMENT_GROUPS,
} from '../../modules/mbe/domain/endorsementTemplates.js';
import type { EndorsementTemplate } from '../../modules/mbe/domain/types.js';
import { motorDefaultClaimsContract } from './claims/defaultClaimsContract.js';
import { selectQuoteReadyFieldKeys } from '../../modules/policy/domain/productFieldRequirements.js';
import { roadsideNonRefundableFloorFromSnapshot } from '../../modules/policy/domain/billing/refundPolicy.js';
import { motorProductRuntimeDefinition } from './runtime.js';
import { buildMotorVersionRows } from './versionRows.js';
import { resolveProductEngines } from '../../modules/policy/domain/productEngines.js';
import {
  normalizeBoQuoteDataCompatibility,
  normalizeDriverRestrictionCompatibility,
  normalizeElectricVehicleCompatibility,
  normalizeMotorcycleNamedRidersOnly,
} from './quotes/quoteDataGuards.js';
import { resolveMotorIpid } from './documents/policyWording.js';

export class MotorProductAdapter implements IProductAdapter {
  readonly productType = 'MOTOR';
  readonly displayName = 'Motor Insurance';

  getManifest(): ProductManifest {
    return motorManifest;
  }

  getRuntimeDefinition() {
    return motorProductRuntimeDefinition;
  }

  getRiskIdentity(data: unknown): RiskIdentity {
    return defaultRiskIdentity(motorManifest, data);
  }

  /**
   * Motor endorsement catalog: hand-curated, rules-rich (MBE DSL with effects,
   * prerequisites, document templates). Sourced from endorsementTemplates.ts.
   */
  getEndorsementCatalog(): EndorsementTemplate[] {
    return MOTOR_ENDORSEMENT_TEMPLATES;
  }

  getEndorsementTemplate(code: string): EndorsementTemplate | undefined {
    return MOTOR_ENDORSEMENT_TEMPLATES.find((t) => t.code === code);
  }

  getEndorsementGroups(): EndorsementGroup[] {
    return MOTOR_ENDORSEMENT_GROUPS.map((g) => ({ id: g.id, title: g.title, templates: [...g.templates] }));
  }

  calculatePremium(data: unknown, options?: { overrideExcess?: number | string | null }): PremiumCalculation {
    return motorProductRuntimeDefinition.calculatePremium(data, options);
  }

  buildDocViewModel(params: ProductViewModelBuilderParams): Record<string, unknown> | null {
    return resolveProductEngines(motorProductRuntimeDefinition.engines).wording.buildDocViewModel?.(params) ?? null;
  }

  buildDiscoverabilityProjection(input: ProductDiscoverabilityInput): ProductDiscoverabilityProjection {
    return buildAutoInsuranceDiscoverability(input);
  }

  getDocPackJobName(): string {
    return motorProductRuntimeDefinition.getDocPackJobName();
  }

  getDocumentTypes(): Record<string, string> {
    return { ...motorManifest.documentTypes };
  }

  resolveIpidAsset(countryCode: string): ProductIpidAsset | null {
    const asset = resolveMotorIpid(countryCode);
    return { absolutePath: asset.staticPdfPath, filename: asset.filename };
  }

  getGoldenFixtures() {
    return motorProductRuntimeDefinition.goldenFixtures;
  }

  async buildQuoteResponse(quoteData: unknown, programMeta: unknown, context?: { resolvedCoverageSet?: import('../../modules/mbe/domain/programProduct.js').ResolvedCoverageSet | null }): Promise<QuoteResponseResult> {
    return motorProductRuntimeDefinition.buildQuoteResponse(quoteData, programMeta, context);
  }

  validateBindRules(quoteData: unknown, binderConfig: unknown): BindRulesResult {
    return motorProductRuntimeDefinition.validateBindRules(quoteData, binderConfig);
  }

  // Pre-validation shape coercion: motor wizard / BO payloads carry a
  // few legacy variants (`cabrio: true` ⇄ `'Yes'`, `requiredExcess: 500`
  // ⇄ `'500'`, electric vehicle 0cc → 1cc, motorcycle named-rider) that
  // the canonical Zod tree refuses to accept. Centralising the
  // normalization on the adapter lets `validatorImpl` call it via the
  // `IProductAdapter` interface — no `if (productType === 'MOTOR')`
  // branch survives in shared code.
  normalizeQuoteDataForValidation(quoteData: Record<string, unknown>): Record<string, unknown> {
    return normalizeDriverRestrictionCompatibility(
      normalizeElectricVehicleCompatibility(
        normalizeMotorcycleNamedRidersOnly(
          normalizeBoQuoteDataCompatibility(quoteData),
        ),
      ),
    );
  }

  normalizeUwData(quoteData: unknown): UwNormalizationResult {
    return motorProductRuntimeDefinition.normalizeUwData(quoteData);
  }

  buildVersionMeta(quoteData: unknown): VersionMeta {
    return motorProductRuntimeDefinition.buildVersionMeta(quoteData);
  }

  buildProductFields(quoteData: unknown): Record<string, unknown> {
    return this.normalizeUwData(quoteData).productFields || {};
  }

  /**
   * Motor projects `vehicleInfo` and `driverInfo` into the legacy top-level
   * Policy columns. Per ADR-0015 these columns are slated for extraction into
   * a generic `Policy.productData JSON?` column in the next release; until
   * then this method gives BDX import a single product-aware mapper instead
   * of a `productType === 'MOTOR'` branch in shared code.
   */
  getLegacyPolicyColumnFields(productFields: Record<string, unknown>): Record<string, unknown> {
    return {
      vehicleInfo: productFields.vehicleInfo
        ? JSON.parse(JSON.stringify(productFields.vehicleInfo))
        : undefined,
      driverInfo: productFields.driverInfo
        ? JSON.parse(JSON.stringify(productFields.driverInfo))
        : undefined,
    };
  }

  getRequiredIssuedDocTypes(): string[] {
    return [...motorProductRuntimeDefinition.requiredIssuedDocTypes];
  }

  getQuoteReadyFieldKeys(): string[] {
    return selectQuoteReadyFieldKeys(this.productType);
  }

  async validateForIssuance(quoteData: unknown): Promise<IssuanceValidationResult> {
    // Single validation funnel (`spine/v2` Wave 5): Motor — like every
    // other product — routes issuance validation through the canonical
    // `validateDraftQuote` composition (productType assertion, adapter
    // normalize pre-pass, validateForContext stage rules, manifest
    // required-field check). Motor adds product-specific doc-pack
    // required-field projections and the named-driver conditional rule
    // on top of the canonical result.
    const { validateDraftQuote } = await import('../../modules/quotes/app/validator.js');
    const { requiredFieldsForDocPack } = await import('../../modules/policy/domain/docRequirements.js');
    const { missingFieldsFromRequirements } = await import('../../modules/policy/domain/productFieldRequirements.js');
    const { additionalDriversConditionalRequirements } = await import('./motorReadinessHelpers.js');
    const qd = (quoteData && typeof quoteData === 'object') ? quoteData as Record<string, unknown> : {};
    const validation = validateDraftQuote({
      quoteData: qd,
      mode: 'issuance',
      productType: this.productType,
    });
    return {
      valid: validation.valid,
      schemaIssues: validation.schemaIssues || [],
      missingSlugs: validation.missingSlugs || [],
      missingForQuotePack: missingFieldsFromRequirements(qd, requiredFieldsForDocPack(this.productType, 'QUOTE_PACK')),
      missingForIssuedPack: missingFieldsFromRequirements(qd, requiredFieldsForDocPack(this.productType, 'ISSUED_POLICY_PACK')),
      conditionalRequirements: additionalDriversConditionalRequirements(qd),
    };
  }

  getDefaultClaimsContract(): ClaimsContract {
    return motorDefaultClaimsContract;
  }

  computeNonRefundableFloor(args: { snapshot: unknown; registryFallbackPrice: number }): number {
    const fromSnapshot = roadsideNonRefundableFloorFromSnapshot(args.snapshot);
    if (fromSnapshot > 0) return fromSnapshot;
    const fallback = Number(args.registryFallbackPrice);
    if (!Number.isFinite(fallback) || fallback < 0) {
      throw new Error('[MotorProductAdapter] computeNonRefundableFloor: registryFallbackPrice must be a non-negative finite number — refusing silent 0 floor.');
    }
    return fallback;
  }

  isUwComplete(_quoteData: unknown, missingForIssuedPack: unknown[]): boolean {
    return Array.isArray(missingForIssuedPack) && missingForIssuedPack.length === 0;
  }

  hasValidQuoteResponse(quoteResponse: unknown): boolean {
    if (!quoteResponse || typeof quoteResponse !== 'object') return false;
    const qr = quoteResponse as Record<string, unknown>;
    const primary = qr.primaryOption && typeof qr.primaryOption === 'object' ? qr.primaryOption as Record<string, unknown> : null;
    return Boolean(primary && typeof primary.annualPremium === 'number' && primary.annualPremium > 0);
  }

  getCustomerJourneyMeta(): CustomerJourneyMeta {
    return motorProductRuntimeDefinition.getCustomerJourneyMeta();
  }

  buildVersionRows(args: BuildVersionRowsArgs): VersionRow[] {
    return buildMotorVersionRows(args);
  }

  async generateDocPack(args: DocPackGenerationArgs): Promise<DocPackGenerationResult> {
    return motorProductRuntimeDefinition.generateDocPack(args);
  }

  async getRatingMatrixSnapshot(): Promise<Record<string, unknown> | null> {
    return motorProductRuntimeDefinition.getRatingMatrixSnapshot();
  }

  async calculateEndorsementPremium(
    quoteData: unknown,
    appliedEndorsements: Array<{ code: string; params?: unknown }>,
  ): Promise<EndorsementPremiumResult> {
    return motorProductRuntimeDefinition.calculateEndorsementPremium(quoteData, appliedEndorsements);
  }
}

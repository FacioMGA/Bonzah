import type { ProductDiscoverabilityInput, ProductDiscoverabilityProjection } from '../app/discoverability/types.js';
import type { PremiumCalculation } from '../../../platform/types/index.js';
import type { ProductManifest } from '@facio/products';
import type { ProductRuntimeDefinition } from './productRuntimeDefinition.js';
import type { RiskIdentity } from './riskIdentity.js';
import type { EndorsementTemplate } from '../../mbe/domain/types.js';
import type { ResolvedCoverageSet } from '../../mbe/domain/programProduct.js';
import type { ClaimsContract } from '../../claims/domain/claimsContract.js';

export interface EndorsementGroup {
  id: string;
  title: string;
  /** Ordered list of template codes this group contains. */
  templates: string[];
}

export interface ProductViewModelBuilderParams {
  policyRecord: Record<string, unknown>;
  snapshotRecord: Record<string, unknown>;
  binder: unknown;
  activeEndorsements: unknown;
  programMeta: Record<string, unknown>;
  brand: unknown;
  normalizedMbeCfg: unknown;
  mbeSections: unknown;
}

export interface QuoteResponseResult {
  quoteResponse: Record<string, unknown>;
  underwritingAnalysis?: Record<string, unknown>;
}

export interface BuildQuoteResponseContext {
  /**
   * Unified coverage engine output. This is the single coverage truth the
   * adapter should price from. `quoteData` still carries the base product
   * facts; optional/configurable cover comes through here.
   */
  resolvedCoverageSet?: ResolvedCoverageSet | null;
  /**
   * Optional quote reference surfaced on the response top-level
   * (`quoteResponse.reference`). Consumers like document generation read
   * this field. Pass the policy number when a stable per-policy quote
   * reference is required; otherwise the leaf calculator falls back to a
   * timestamped placeholder.
   */
  reference?: string;
  /**
   * Currency code surfaced on the response top-level
   * (`quoteResponse.currency`). Defaults to `'EUR'` inside the leaf when
   * omitted.
   */
  currency?: string;
  /**
   * Excess override (BO underwriter or override-flow). Routed through to
   * the rating engine's `options.overrideExcess`. Plumbed via the
   * canonical road so callers don't reach into the leaf calculator
   * directly.
   */
  overrideExcess?: number | string | null;
}

export interface BindRulesResult {
  valid: boolean;
  errors: Array<{ field: string; message: string }>;
}

export interface UwNormalizationResult {
  normalizedQuoteData: Record<string, unknown>;
  productFields?: Record<string, unknown>;
}

export interface VersionMeta {
  sectionLabel: string;
  coverageLabel: string;
  insuredValueDisplay: string;
  bdxClassOfBusiness?: string;
}

export interface IssuanceValidationResult {
  valid: boolean;
  schemaIssues: Array<{ slug: string; message: string; path?: string }>;
  missingSlugs: string[];
  missingForQuotePack: Array<{ slug: string; label: string; customerHash?: string; boTab?: string }>;
  missingForIssuedPack: Array<{ slug: string; label: string; customerHash?: string; boTab?: string }>;
  conditionalRequirements: Array<{ code: string; message: string; severity?: string }>;
}

export interface CustomerJourneyMeta {
  pricingStep?: string;
  uwStep?: string;
  detailsStep?: string;
}

export interface VersionRow {
  section: string;
  riskTransType: string;
  limitText: string;
  excessText: string;
  premium: number;
  currency: string;
}

export interface BuildVersionRowsArgs {
  quoteData: Record<string, unknown>;
  quoteResponse: Record<string, unknown>;
  pricing: Record<string, unknown>;
  previousQuoteResponse: Record<string, unknown> | null;
  previousPricing: Record<string, unknown> | null;
  transactionType: string;
  isCancellation: boolean;
  riskTransTypeLabel: string;
  isFullPremium: boolean;
  premiumDeltaTotal: number;
  versionMeta: VersionMeta | null;
}

export interface DocPackGenerationArgs {
  policyId: string;
  riskTransactionId?: string | null;
  docPack: string;
  source: string;
  generatedByUserId?: string | null;
  templateVersion?: string;
  db?: unknown;
}

export interface DocPackGenerationResult {
  version: number;
  documents: Array<{
    id: string;
    type: string;
    storageUri: string;
    filename: string;
    fileHash?: string | null;
    status: string;
    version: number;
    docPack?: string | null;
    templateVersion?: string | null;
    riskTransactionId?: string | null;
  }>;
}

export type ProductGoldenFixtures = {
  minimumValid: Record<string, unknown>;
  minimumIssuable?: Record<string, unknown>;
  referral?: Record<string, unknown>;
  decline?: Record<string, unknown>;
  endorsementCases?: Array<{
    label: string;
    apply: Array<{ code: string; params?: unknown }>;
  }>;
};

/**
 * A product's Insurance Product Information Document (IPID) as a static PDF
 * asset, resolved for pre-purchase (quote-stage) display.
 */
export interface ProductIpidAsset {
  absolutePath: string;
  filename: string;
}

/**
 * Product-owned wording for the generic quote-email template. The policy
 * module renders the email shell; a product owns any cover-specific labels
 * and disclosure values that cannot be derived from the shared Policy shape.
 */
export interface ProductQuoteEmailPresentation {
  coverLabel: string;
  excessLabel: string;
}

export interface IProductAdapter {
  readonly productType: string;
  readonly displayName: string;

  /** Declarative product manifest (rendering authority for all BO surfaces). */
  getManifest(): ProductManifest;
  getRuntimeDefinition(): ProductRuntimeDefinition | null;

  /**
   * Returns the canonical RiskIdentity for a policy snapshot / quote data.
   * The default implementation on `BaseProductAdapter` reads from the manifest;
   * products with conditional identity (e.g. Travel: annual vs single-trip)
   * override and can delegate to `defaultRiskIdentity` for fallback branches.
   */
  getRiskIdentity(data: unknown): RiskIdentity;

  calculatePremium(data: unknown, options?: { overrideExcess?: number | string | null }): PremiumCalculation;

  buildDocViewModel(params: ProductViewModelBuilderParams): Record<string, unknown> | null;
  buildDiscoverabilityProjection(input: ProductDiscoverabilityInput): ProductDiscoverabilityProjection;
  getDocPackJobName(): string;
  getDocumentTypes(): Record<string, string>;
  getGoldenFixtures(): ProductGoldenFixtures;

  buildQuoteResponse(quoteData: unknown, programMeta: unknown, context?: BuildQuoteResponseContext): Promise<QuoteResponseResult>;
  validateBindRules(quoteData: unknown, binderConfig: unknown): BindRulesResult;
  normalizeUwData(quoteData: unknown): UwNormalizationResult;
  /**
   * Pre-validation shape normalization. Motor coerces a few BO/wizard
   * payload variants (`cabrio: true` → `'Yes'`, `requiredExcess: 500` →
   * `'500'`, electric vehicle 0cc → 1cc, motorcycle riders-named) so
   * the canonical `validateForContext` Zod tree never has to know
   * about those legacy shapes. Other products are no-ops and inherit
   * the identity from `BaseProductAdapter`.
   */
  normalizeQuoteDataForValidation(quoteData: Record<string, unknown>): Record<string, unknown>;
  buildVersionMeta(quoteData: unknown): VersionMeta;
  buildProductFields(quoteData: unknown): Record<string, unknown>;

  /**
   * Returns the subset of `productFields` that should be persisted into the
   * legacy top-level Policy columns (`vehicleInfo`, `driverInfo`, ...) on
   * insert. Per ADR-0015 this is a transitional surface — the next release
   * after PR8 introduces a `Policy.productData JSON?` column and drops the
   * legacy ones; until then, this method gives us a single product-aware
   * mapper so shared code (BDX import, etc.) does not need to branch on
   * `productType === 'MOTOR'`.
   *
   * Default: `{}` (no legacy top-level columns). Motor overrides to project
   * `vehicleInfo` and `driverInfo`. Home and travel deliberately return `{}`.
   */
  getLegacyPolicyColumnFields(productFields: Record<string, unknown>): Record<string, unknown>;

  getRequiredIssuedDocTypes(): string[];
  /**
   * Optional product projection for quote-email cover and excess fields.
   * A product that supplies this must derive both fields from its canonical
   * quote data; the shared email layer must not branch on product type.
   */
  buildQuoteEmailPresentation?(quoteData: unknown): ProductQuoteEmailPresentation;
  /**
   * Resolve the product's IPID static PDF for a tenant territory, for
   * pre-purchase display at quote stage (Peter, 2026-07-21). Returns null when
   * the product has no IPID (e.g. Motor). Home is territory-aware; Travel and
   * Health are single-asset. Optional: only products with an IPID implement it.
   */
  resolveIpidAsset?(countryCode: string): ProductIpidAsset | null;
  getQuoteReadyFieldKeys(): string[];
  validateForIssuance(quoteData: unknown): Promise<IssuanceValidationResult>;
  getDefaultClaimsContract(): ClaimsContract;
  computeNonRefundableFloor(args: { snapshot: unknown; registryFallbackPrice: number }): number;
  isUwComplete(quoteData: unknown, missingForIssuedPack: unknown[]): boolean;
  hasValidQuoteResponse(quoteResponse: unknown): boolean;
  getCustomerJourneyMeta(): CustomerJourneyMeta;
  buildVersionRows(args: BuildVersionRowsArgs): VersionRow[];
  generateDocPack(args: DocPackGenerationArgs): Promise<DocPackGenerationResult>;
  getRatingMatrixSnapshot(): Promise<Record<string, unknown> | null>;
  calculateEndorsementPremium(
    quoteData: unknown,
    appliedEndorsements: Array<{ code: string; params?: unknown }>,
  ): Promise<EndorsementPremiumResult>;

  /**
   * Product-owned Modular Binder Endorsement (MBE) catalog.
   *
   * Motor returns a hand-curated list with rich rules (effects, prerequisites,
   * document templates). Home / Travel / future products return catalogs
   * synthesized from `manifest.coverageCatalog` — simple COVERAGE-type toggles
   * whose pricing impact is realized through `calculateEndorsementPremium`.
   *
   * These are the authoritative sources for the MBE HTTP routes and for
   * `MagicBService` — there is no cross-product fallback.
   */
  getEndorsementCatalog(): EndorsementTemplate[];
  getEndorsementTemplate(code: string): EndorsementTemplate | undefined;
  getEndorsementGroups(): EndorsementGroup[];
}

export interface EndorsementPremiumResult {
  premium: number;
  policyExcess: number;
}

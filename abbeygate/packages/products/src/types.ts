/**
 * Product Manifest — the single declarative contract every insurance product
 * implements. The BO (policy list, detail page, UW tab, MBE, program editor)
 * and the public wizard render exclusively from manifest data; there are no
 * motor/home/travel literals in shared BO/wizard code.
 *
 * Manifests live in code (one per product) under `packages/products/src/{code}/
 * manifest.ts`. Each side wires the manifest to its registry on bootstrap:
 *   - backend: `backend/products/registerProducts.ts` → `ProductRegistry.register`
 *   - frontend: `frontend/src/products/{code}/register.ts` → `ProductRegistry.register`
 *
 * Phase 4 (2026-04 consolidation): the previous two mirrors
 * (`backend/modules/policy/domain/productManifest.ts` and
 * `frontend/src/shared/products/manifest.types.ts`) were deleted in favour
 * of this single declaration. Re-creating either is blocked by
 * `tools/quality/check-products-single-source.mjs`.
 *
 * Responsibility split:
 *   - Manifest = rendering authority (what to show, where, with what labels).
 *   - Validation profile = data authority (what's allowed, when, by whom).
 *   - Backend adapters = pricing + issuance authority (how to quote, bind, issue).
 */

export type FieldKind =
  | 'text'
  | 'textarea'
  | 'number'
  | 'currency'
  | 'percent'
  | 'date'
  | 'select'
  | 'multiselect'
  | 'boolean'
  | 'object'
  | 'list';

export interface SelectOption {
  value: string;
  label: string;
}

export interface FieldDef {
  /** dot-path into the data record (e.g. "vehicleValue" or "addresses.0.city"). */
  path: string;
  label: string;
  type: FieldKind;
  description?: string;
  placeholder?: string;
  options?: SelectOption[];
  /** Soft validation hints — backend validateForIssuance is the authority. */
  min?: number;
  max?: number;
  pattern?: string;
  required?: boolean;
  /** UI hint: render selects with type-ahead search. */
  searchable?: boolean;
  /** Key of another field; when present, this field is hidden/required based on it. */
  visibleWhenKey?: string;
  visibleWhenValue?: unknown;
  requiredWhenKey?: string;
  requiredWhenValue?: unknown;
}

export interface SectionDef {
  id: string;
  title: string;
  description?: string;
  fields: FieldDef[];
  /** Optional stable order hint; lower first. */
  order?: number;
}

export interface QuestionnaireDef {
  sections: SectionDef[];
}

/** Describes the "thing being insured" for this product (vehicle / home / traveler). */
export interface InsuredObjectSchema {
  /** Semantic name: 'vehicle', 'property', 'traveler', etc. */
  kind: string;
  /** Is it one-per-policy or many? (MBE scope RISK_OBJECT needs this to be 'many'.) */
  cardinality: 'one' | 'many';
  /** Display label singular/plural. */
  label: { singular: string; plural: string };
  /** The fields that identify the insured object (plate, address, passport). */
  fields: FieldDef[];
}

/** Which quoteData fields drive the headline / policy card subtitle for this product. */
export interface SummaryFieldsDef {
  /** Title expression: comma-separated data paths joined by space. */
  titlePaths: string[];
  /** Subtitle paths joined by " · ". */
  subtitlePaths: string[];
  /** Optional currency value path (rendered as €X). */
  insuredValuePath?: string;
  /**
   * Optional programmatic title builder. When returned string is non-empty it
   * wins over `titlePaths`; returning null|undefined falls back to titlePaths.
   */
  buildTitle?(data: Record<string, unknown>): string | null | undefined;
  /** Optional programmatic subtitle builder. */
  buildSubtitle?(data: Record<string, unknown>): string | null | undefined;
}

/** Declarative spec for a list column rendered in the BO policy list. */
export interface ListColumnSpec {
  /** Paths to include on the primary line. */
  primaryPaths: string[];
  /** Paths on the secondary line (e.g., subtitle). */
  secondaryPaths?: string[];
  /** Optional tertiary line (e.g., value). */
  tertiaryPath?: string;
  /** Formatter hints — raw / currency / joined. */
  primaryFormat?: 'joined' | 'text';
  tertiaryFormat?: 'currency' | 'text';
  /**
   * Optional programmatic builder for the primary line. When a non-empty
   * string is returned it wins over `primaryPaths`; returning null /
   * undefined / empty string falls back to the path-based projection.
   */
  buildPrimary?(data: Record<string, unknown>): string | null | undefined;
  /** Same semantics as buildPrimary, for the secondary line. */
  buildSecondary?(data: Record<string, unknown>): string | null | undefined;
  /**
   * Optional display-period start override for the coverage block.
   * Returning a non-empty string wins over the policy row's generic
   * `start` date. Use when the visible coverage period is product-owned
   * (e.g. a travel trip window) rather than the policy's annual term.
   */
  buildStartDate?(data: Record<string, unknown>): string | null | undefined;
  /** Same semantics as buildStartDate, for the display-period end date. */
  buildEndDate?(data: Record<string, unknown>): string | null | undefined;
}

export interface ListColumnsDef {
  insured: ListColumnSpec;
  coverage: ListColumnSpec;
}

/** A coverage template exposed by the product (MBE endorsement catalog entry). */
export interface CoverageSpec {
  code: string;
  label: string;
  description?: string;
  scope: 'POLICY' | 'RISK_OBJECT' | 'OCCURRENCE';
  /** Fields the user configures when selecting this coverage. */
  paramsSchema?: FieldDef[];
  /** Whether the coverage is a "core" (always-on) or optional. */
  required?: boolean;
  /** Optional group id for UI grouping (e.g. "core" | "extras"). */
  group?: string;
}

/** A single UW config field in the program editor. */
export interface UwConfigFieldDef extends FieldDef {
  /** Categorizes where this field lives in the program editor. */
  category?: string;
}

export interface UwConfigSchemaDef {
  /** Groups of UW config fields (e.g. "Vehicle thresholds", "Driver thresholds"). */
  groups: Array<{
    id: string;
    title: string;
    description?: string;
    fields: UwConfigFieldDef[];
  }>;
}

/** Which fields feed the BO underwriting risk chips. */
export interface RiskModelHints {
  /** Field paths that are required for underwriting completeness. */
  requiredForUw: Array<{ path: string; label: string }>;
  /** Boolean fields that, when true, trigger a referral. */
  referralFlags: Array<{ path: string; label: string; points?: number; reason?: string }>;
  /** Paths shown in the "Rating inputs" snapshot modal. */
  ratingInputs: Array<{ path: string; label: string; format?: 'currency' | 'text' | 'boolean' }>;
}

/** Per-product rules for BO workflows that aren't just schema. */
export interface ProductRules {
  /** Minimum policy units before a non-auto UW batch can be sent (see usePolicyFollowUps). */
  batchRules?: {
    minUnits?: number;
  };
}

/** Icon, color, labels for BO rendering. */
export interface ProductTheme {
  iconKey: string;
  segmentLabel: string;
}

export interface ProductManifest {
  productType: string;
  displayName: string;

  insuredObject: InsuredObjectSchema;
  questionnaire: QuestionnaireDef;
  questionnaireHiddenKeys?: string[];
  summaryFields: SummaryFieldsDef;
  listColumns: ListColumnsDef;
  coverageCatalog: CoverageSpec[];
  uwConfigSchema: UwConfigSchemaDef;
  documentTypes: Record<string, string>;
  riskModelHints: RiskModelHints;
  rules: ProductRules;
  theme: ProductTheme;
}

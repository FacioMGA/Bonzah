import { ProductRegistry } from '../../policy/domain/ProductRegistry.js';
import { validateManifestRequiredFields } from '../../policy/domain/productFieldRequirements.js';
import type { QuoteData } from '../../../platform/types/autoInsurance.js';
import { validateForContext, type LifecycleStageId } from '@facio/validation/backend';

type DraftQuoteValidationResultBase = {
  blockingErrors: Array<{ slug: string; status: 'FAIL'; message: string }>;
  missingSlugs: string[];
  warnings: Array<{ slug: string; status: 'WARN'; message?: string }>;
  schemaIssues: Array<{ slug: string; message: string; path: string }>;
  /**
   * Structured manifest-required fields that were absent at issuance.
   * Empty for non-issuance modes. Exposed in the result so callers
   * (e.g. `BaseManifestProductAdapter.validateForIssuance`) don't
   * re-run `validateManifestRequiredFields` themselves — `spine/v2`
   * Wave 5 collapsed that duplication into this single funnel.
   */
  manifestMissingFields: Array<{ slug: string; label: string; customerHash?: string; boTab?: string }>;
};

type DraftQuoteValidationResult =
  | (DraftQuoteValidationResultBase & { valid: true; normalizedQuoteData: QuoteData })
  | (DraftQuoteValidationResultBase & { valid: false; normalizedQuoteData: Record<string, unknown> | QuoteData });

function modeToStage(mode: 'draft' | 'quote' | 'issuance' | 'api'): LifecycleStageId {
  if (mode === 'issuance') return 'issuance';
  if (mode === 'quote' || mode === 'api') return 'quote';
  return 'draft';
}

/**
 * Canonical draft / bind / issuance validation entry point.
 *
 * `spine/v2` Wave 2 (2026-04-29) collapsed the previous
 * `validationMode === 'product_schema'` vs `'manifest_only'` branch into
 * a single canonical pipeline:
 *
 *   1. Normalise motor BO/wizard payload variants (cabrio, requiredExcess,
 *      EV engine size, motorcycle named-rider).
 *   2. Run `validateForContext({ stage })` against the product's
 *      `ValidationProfile` — every product (Motor, Home, Travel, …)
 *      registers one in `backend/products/registerProducts.ts`.
 *   3. For issuance, also run `validateManifestRequiredFields(…,
 *      'ISSUED_POLICY_PACK')` so required-doc fields surface as
 *      structured blockers regardless of which Zod issued the field
 *      shape error.
 *
 * The `productSchema`/`manifestOnly` dichotomy and the `validateUnified-
 * QuoteData` shim are gone. `evaluateIssueReadiness` is the issuance
 * funnel; this function is the validator everyone behind that funnel
 * (and the wizard `handleNext` guards) calls.
 */
export function validateDraftQuote(args: {
  quoteData: Record<string, unknown>;
  step?: string | null;
  mode?: 'draft' | 'quote' | 'issuance' | 'api';
  productType?: string;
}): DraftQuoteValidationResult {
  const pt = String(args.productType || '').toUpperCase();
  if (!pt) {
    return {
      valid: false,
      normalizedQuoteData: args.quoteData,
      blockingErrors: [{ slug: 'PRODUCT_TYPE_REQUIRED', status: 'FAIL', message: 'productType is required to validate quote data' }],
      missingSlugs: ['productType'],
      warnings: [],
      schemaIssues: [{ slug: 'productType', message: 'productType is required to validate quote data', path: 'productType' }],
      manifestMissingFields: [],
    };
  }

  const adapter = ProductRegistry.getInstance().getAdapter(pt);
  if (!adapter) {
    return {
      valid: false,
      normalizedQuoteData: args.quoteData,
      blockingErrors: [{ slug: 'PRODUCT_ADAPTER_MISSING', status: 'FAIL', message: `No product adapter registered for: ${pt}` }],
      missingSlugs: [],
      warnings: [],
      schemaIssues: [{ slug: 'productType', message: `No product adapter registered for: ${pt}`, path: 'productType' }],
      manifestMissingFields: [],
    };
  }

  const mode = args.mode ?? 'draft';
  const stageId = modeToStage(mode);

  // Pre-validation shape coercion is delegated to the adapter — there
  // is no `if (productType === 'MOTOR')` branch in shared validator
  // code. The default adapter implementation is identity.
  const normalized: Record<string, unknown> = adapter.normalizeQuoteDataForValidation(args.quoteData);

  // No `ValidationRegistry.has(pt)` safety belt: `validateForContext`
  // throws if a profile is missing (Wave 5/A1 loud-fail). Every product
  // surfaced by `ProductRegistry` MUST also register a `ValidationProfile`
  // in `backend/products/registerProducts.ts`. Drift is caught at boot.
  const fieldErrors = validateForContext({
    productCode: pt,
    stage: { kind: 'stage', id: stageId },
    actor: 'server',
    data: normalized,
  });

  const manifestMissing =
    stageId === 'issuance'
      ? validateManifestRequiredFields(pt, normalized, 'ISSUED_POLICY_PACK')
      : [];

  const schemaIssues: Array<{ slug: string; message: string; path: string }> = [];
  const missingSlugSet = new Set<string>();
  for (const [path, message] of Object.entries(fieldErrors)) {
    schemaIssues.push({ slug: path, message, path });
    missingSlugSet.add(path);
  }
  for (const issue of manifestMissing) {
    if (missingSlugSet.has(issue.slug)) continue;
    schemaIssues.push({ slug: issue.slug, message: `${issue.label} is required`, path: issue.slug });
    missingSlugSet.add(issue.slug);
  }

  const isValid = schemaIssues.length === 0;
  const base = {
    blockingErrors: schemaIssues.map((issue) => ({ slug: issue.slug, status: 'FAIL' as const, message: issue.message })),
    warnings: [] as Array<{ slug: string; status: 'WARN'; message?: string }>,
    missingSlugs: Array.from(missingSlugSet),
    schemaIssues,
    manifestMissingFields: manifestMissing,
  };

  if (isValid) {
    const typedQuoteData = normalized as unknown as QuoteData; // TODO(FAC-9001): replace with typed validateForContext output once profile-driven runner emits a discriminated payload.
    return { ...base, valid: true as const, normalizedQuoteData: typedQuoteData };
  }
  return { ...base, valid: false as const, normalizedQuoteData: normalized };
}

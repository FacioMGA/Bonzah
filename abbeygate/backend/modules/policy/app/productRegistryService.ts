import { ProductRegistry } from '../domain/ProductRegistry.js';
import { buildCoverageOptionsView } from './coverageOptionsView.js';
import type { ResolvedCoverageSet } from '../../mbe/domain/programProduct.js';
import type { BuildVersionRowsArgs, ProductIpidAsset } from '../domain/productContracts.js';
import { validateDraftQuote } from '../../quotes/app/validatorImpl.js';

type UnknownRecord = Record<string, unknown>;

function requireProductAdapter(productType: string) {
  const normalized = String(productType || '').trim().toUpperCase();
  const adapter = ProductRegistry.getInstance().getAdapter(normalized);
  if (!adapter) throw new Error(`No product adapter for '${normalized || productType}'`);
  return adapter;
}

export function productAdapterExists(productType: string): boolean {
  return Boolean(ProductRegistry.getInstance().getAdapter(String(productType || '').trim().toUpperCase()));
}

export function getProductSegmentLabel(productType: string): string {
  return requireProductAdapter(productType).getManifest().theme.segmentLabel;
}

export function getProductDisplaySection(productType: string): string {
  return requireProductAdapter(productType).displayName.split(' ')[0] || '—';
}

export function buildProductVersionMeta(productType: string, quoteData: unknown) {
  return requireProductAdapter(productType).buildVersionMeta(quoteData);
}

export function buildProductVersionRows(productType: string, args: BuildVersionRowsArgs) {
  return requireProductAdapter(productType).buildVersionRows(args);
}

export function getRequiredIssuedDocTypesForProduct(productType: string): string[] {
  return requireProductAdapter(productType).getRequiredIssuedDocTypes();
}

/**
 * Resolve a product's IPID static asset for the given territory, for
 * pre-purchase display at quote stage (Peter, 2026-07-21). Returns null when
 * the product does not exist or has no IPID (e.g. Motor). May throw for a
 * product whose IPID is territory-configured and the territory is unknown
 * (Home) — the caller (public IPID route) turns that into a 404.
 */
export function resolveProductIpidAsset(productType: string, countryCode: string): ProductIpidAsset | null {
  const adapter = ProductRegistry.getInstance().getAdapter(String(productType || '').trim().toUpperCase());
  if (!adapter || typeof adapter.resolveIpidAsset !== 'function') return null;
  return adapter.resolveIpidAsset(countryCode);
}

export async function getFirstProductRatingMatrixSnapshot() {
  const adapter = ProductRegistry.getInstance().getAllAdapters()[0] || null;
  if (!adapter) throw new Error('No product adapter registered');
  return adapter.getRatingMatrixSnapshot();
}

export async function buildQuoteResponseForProduct(args: {
  productType: string;
  quoteData: unknown;
  programMeta?: UnknownRecord;
  resolvedCoverageSet?: unknown;
}) {
  const adapter = requireProductAdapter(args.productType);
  return adapter.buildQuoteResponse(
    args.quoteData,
    args.programMeta || {},
    args.resolvedCoverageSet ? { resolvedCoverageSet: args.resolvedCoverageSet as ResolvedCoverageSet } : {},
  );
}

/**
 * Canonical rating-time validation funnel for the public quote-session
 * `/rate` endpoint shared by Home, Travel, and any future product
 * (`backend/modules/quotes/http/genericPublicQuoteRouter.ts`). The motor
 * service equivalent lives in `backend/products/motor/quotes/service.ts`
 * — both routes converge on the same `validateDraftQuote({ mode:
 * 'quote' })` spine, which dispatches to `validateForContext({ stage:
 * 'quote', actor: 'server' })` against the registered product profile
 * (`docs/architecture/contracts/validation.md` "single source of
 * truth"). The wizard's pre-rate gate
 * (`useQuoteWizardController.rateQuote` etc.) calls the same canonical
 * runner from the browser with `actor: 'customer'`, so a wizard that
 * says "ready" CAN'T be rejected here unless the contract drifts —
 * pinned by `packages/products/src/motor/__tests__/quote-readiness.
 * contract.test.ts`.
 *
 * Returns `{ ok: false, error }` for any structured validation failure
 * so the router stays as a thin HTTP boundary (the
 * `check-product-engine-contract` guard forbids the router file from
 * calling `validateDraftQuote` directly — keep that contract intact).
 */
export type ProductRateValidationResult =
  | { ok: true; normalizedQuoteData: unknown }
  | {
      ok: false;
      error: {
        code: 'INVALID_QUOTE_DATA';
        message: string;
        details: {
          missingSlugs: string[];
          blockingErrors: Array<{ slug: string; status: 'FAIL'; message: string }>;
        };
      };
    };

export function validateProductQuoteForRating(args: {
  productType: string;
  quoteData: Record<string, unknown>;
}): ProductRateValidationResult {
  const verdict = validateDraftQuote({
    quoteData: args.quoteData,
    mode: 'quote',
    productType: args.productType,
  });
  if (verdict.valid) {
    // Type the public surface as `unknown` — the validator's
    // `normalizedQuoteData` is the motor-shape `QuoteData` legacy seam
    // (this funnel pre-dates Home/Travel) and callers narrow when they
    // need a specific shape. `unknown` keeps the canonical-spine
    // surface honest and avoids the no-new-any ratchet.
    return { ok: true, normalizedQuoteData: verdict.normalizedQuoteData };
  }
  return {
    ok: false,
    error: {
      code: 'INVALID_QUOTE_DATA',
      message: 'Quote data failed validation for rating',
      details: {
        missingSlugs: verdict.missingSlugs,
        blockingErrors: verdict.blockingErrors,
      },
    },
  };
}

export async function validateProductQuoteForIssuance(productType: string, quoteData: unknown) {
  return requireProductAdapter(productType).validateForIssuance(quoteData);
}

export function normalizeUwDataForProduct(productType: string, quoteData: unknown) {
  return requireProductAdapter(productType).normalizeUwData(quoteData);
}

function parsePolicyPeriodDate(value: unknown): Date | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T00:00:00.000Z`)
    : new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export function resolvePolicyPeriodForProduct(productType: string, quoteData: unknown): {
  inceptionDate: Date;
  expiryDate: Date;
} | null {
  const manifest = requireProductAdapter(productType).getManifest();
  const coverage = manifest.listColumns.coverage;
  const start = parsePolicyPeriodDate(coverage.buildStartDate?.(quoteData as UnknownRecord));
  const end = parsePolicyPeriodDate(coverage.buildEndDate?.(quoteData as UnknownRecord));
  if (!start || !end || end.getTime() < start.getTime()) return null;
  return { inceptionDate: start, expiryDate: end };
}

export function buildCoverageOptionsViewForProduct(args: {
  productType: string;
  programCode: string;
  contract: Parameters<typeof buildCoverageOptionsView>[0]['contract'];
  activeInstances: Parameters<typeof buildCoverageOptionsView>[0]['activeInstances'];
  quoteData: unknown;
}) {
  const adapter = requireProductAdapter(args.productType);
  const templates = adapter
    .getEndorsementCatalog()
    .filter((template) => String(template.program_code || '').trim() === String(args.programCode || '').trim());
  return buildCoverageOptionsView({
    manifest: adapter.getManifest(),
    groups: adapter.getEndorsementGroups(),
    templates,
    contract: args.contract,
    activeInstances: args.activeInstances,
    quoteData: args.quoteData,
  });
}

export function buildProductDocumentViewModel(args: {
  productType: string;
  policyRecord: UnknownRecord;
  snapshotRecord: UnknownRecord;
  binder: unknown;
  activeEndorsements: unknown[];
  programMeta: UnknownRecord;
  brand: unknown;
  normalizedMbeCfg: unknown;
  mbeSections: unknown;
}) {
  return requireProductAdapter(args.productType).buildDocViewModel({
    policyRecord: args.policyRecord,
    snapshotRecord: args.snapshotRecord,
    binder: args.binder,
    activeEndorsements: args.activeEndorsements,
    programMeta: args.programMeta,
    brand: args.brand,
    normalizedMbeCfg: args.normalizedMbeCfg,
    mbeSections: args.mbeSections,
  });
}

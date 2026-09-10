/**
 * Quote-Data Issuance Validation — lower-level pure helper.
 *
 * Thin wrapper over `IProductAdapter.validateForIssuance(...)` that
 * resolves the registered adapter from `ProductRegistry` for a given
 * `productType` and returns the structured `IssuanceValidationResult`.
 *
 * This helper is deliberately NOT named "issue readiness". Per
 * `docs/architecture/contracts/canonical-ownership.md`,
 * `evaluateIssueReadiness` is the single canonical owner of issue-
 * readiness derivation. Callers that need only the schema/required
 * field verdict (e.g. BDX import constructing its own gap rows) MUST
 * use this helper rather than building a parallel readiness pipeline.
 *
 * Replaces `evaluateIssueReadinessForQuoteData`, whose name implied a
 * second readiness engine and whose divergent blocker shape was the
 * root cause of the duplicated `QUOTE_DATA_INVALID` formatting bug.
 */

import { ProductRegistry } from './ProductRegistry.js';
import type { IssuanceValidationResult } from './productContracts.js';

export class QuoteDataIssuanceValidationError extends Error {
  readonly code: 'PRODUCT_NOT_ASSIGNED' | 'PRODUCT_NOT_SUPPORTED';
  constructor(code: 'PRODUCT_NOT_ASSIGNED' | 'PRODUCT_NOT_SUPPORTED', message: string) {
    super(message);
    this.code = code;
    this.name = 'QuoteDataIssuanceValidationError';
  }
}

/**
 * Run an adapter's `validateForIssuance` for an in-memory `quoteData`
 * payload and return the structured result. Throws a typed error if no
 * product type is supplied or the registered adapter cannot be
 * resolved — the previous "blocker"-shaped error envelope leaked the
 * issue-readiness vocabulary into callers that have no business
 * speaking it.
 */
export async function validateQuoteDataForIssuanceCanonical(
  quoteData: unknown,
  productType: string | null | undefined,
): Promise<IssuanceValidationResult> {
  const normalizedProductType = String(productType || '').trim().toUpperCase();
  if (!normalizedProductType) {
    throw new QuoteDataIssuanceValidationError(
      'PRODUCT_NOT_ASSIGNED',
      'No product type supplied for quote-data issuance validation.',
    );
  }
  const adapter = ProductRegistry.getInstance().getAdapter(normalizedProductType);
  if (!adapter) {
    throw new QuoteDataIssuanceValidationError(
      'PRODUCT_NOT_SUPPORTED',
      `Product type '${normalizedProductType}' does not have a registered adapter.`,
    );
  }
  return adapter.validateForIssuance(quoteData);
}

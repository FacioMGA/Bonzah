/**
 * QUOTE_DATA_INVALID Issue-Readiness Blocker — canonical builder.
 *
 * Single source of truth for the readiness blocker emitted when a
 * product adapter's `validateForIssuance(...)` returns schema-level
 * issues. Owns:
 *
 *   - the blocker `code` (`'QUOTE_DATA_INVALID'`)
 *   - the blocker `group` (`'UNDERWRITING'` — invalid quote data is an
 *     underwriting concern, not a pricing concern; the divergent
 *     `'PRICING'` group used by the now-deleted
 *     `evaluateIssueReadinessForQuoteData` was the symptom of the
 *     duplication this module exists to prevent)
 *   - the blocker `message` format, including humanization of dotted
 *     field paths (`proposer.address.country` → manifest label like
 *     `Country` when one exists, else the dotted path with camelCase
 *     segments expanded)
 *   - the blocker `details` shape (`{ schemaIssues, missingSlugs }`)
 *   - the deduplication and ordering of the missing-fields list
 *
 * Per `docs/architecture/contracts/canonical-ownership.md`,
 * `evaluateIssueReadiness` is the only sanctioned issue-readiness
 * derivation. This helper is its internal collaborator. No other
 * module is permitted to construct a `QUOTE_DATA_INVALID` readiness
 * blocker — call this builder instead. (HTTP error envelopes that
 * happen to reuse the `QUOTE_DATA_INVALID` string as a status / error
 * code — `bindingRouter.ts`, `BindPolicy.ts`, `CreateFromQuote.ts`,
 * `policyCompliance.ts` — are a different contract and out of scope.)
 *
 * The previous regression: `humanizeIssueSlug` truncated every dotted
 * path to its first segment, collapsing `proposer.address.country`,
 * `proposer.address.city`, `proposer.firstName` etc. to a single
 * `"proposer"` token. Operators saw "Missing or invalid: proposer."
 * with no way to know which subfield was wrong. The current
 * implementation preserves the full path and prefers the canonical
 * manifest label (sourced from `selectFieldLabelsByPath`).
 */

import type { IssueBlocker } from './issueReadinessTypes.js';
import { selectFieldLabelsByPath } from './productFieldRequirements.js';

export type QuoteDataSchemaIssue = {
  slug: string;
  message: string;
  path?: string;
};

export type BuildQuoteDataInvalidBlockerInput = {
  productType: string | null;
  schemaIssues: ReadonlyArray<QuoteDataSchemaIssue>;
  /**
   * Customer-flow hash (e.g. `journeyMeta.detailsStep`) to deep-link
   * the operator from the BO blocker action back to the right step in
   * the customer wizard. Optional — the blocker still renders without
   * it.
   */
  detailsStepHash?: string;
};

const READINESS_FIELD_LABEL_OVERRIDES: Record<string, string> = {
  fairProcessingAccepted: 'Fair processing declaration',
  infoTrueAndAccurate: 'Information is true and accurate confirmation',
  'proposer.privacyPolicyAccepted': 'Privacy policy acceptance',
};

/**
 * Format a single validation slug for the blocker message.
 *
 * Slugs from `BaseManifestProductAdapter.validateForIssuance` are full
 * dotted paths. This helper:
 *
 *   1. Returns `'unknown field'` for an empty slug (defensive).
 *   2. Returns `'form-level rule'` for the reserved `'form'` slug used
 *      by cross-field refinements.
 *   3. Returns the manifest label for the exact path when one is
 *      registered (one-source-truth: the same string the operator
 *      sees in the BO form).
 *   4. Otherwise returns the full dotted path with each segment's
 *      camelCase boundary expanded to a space (lower-cased) — so
 *      paths without a manifest entry still expose *which* field is
 *      bad.
 *
 * Exported for unit tests only. Production callers should go through
 * `buildQuoteDataInvalidBlocker`.
 */
export function humanizeIssueSlug(
  slug: string,
  labels?: Record<string, string>,
): string {
  const normalized = String(slug || '').trim();
  if (!normalized) return 'unknown field';
  if (normalized === 'form') return 'form-level rule';
  if (READINESS_FIELD_LABEL_OVERRIDES[normalized]) return READINESS_FIELD_LABEL_OVERRIDES[normalized];
  if (labels && labels[normalized]) return labels[normalized];
  return normalized
    .split('.')
    .filter(Boolean)
    .map((segment) =>
      segment.replace(/([A-Z])/g, ' $1').replace(/\s+/g, ' ').trim().toLowerCase(),
    )
    .join('.');
}

/**
 * Build the canonical `QUOTE_DATA_INVALID` readiness blocker.
 *
 * Caller is responsible for skipping the call when `schemaIssues` is
 * empty (the helper still produces a sensible fallback message in that
 * case so it never silently emits an empty blocker, but the canonical
 * orchestrator should not push a blocker when no issues exist).
 */
export function buildQuoteDataInvalidBlocker(
  input: BuildQuoteDataInvalidBlockerInput,
): IssueBlocker {
  const labels = input.productType
    ? selectFieldLabelsByPath(input.productType)
    : {};
  const dedupedSlugs = Array.from(
    new Set(
      input.schemaIssues
        .map((issue) => String(issue.slug || issue.path || '').trim())
        .filter(Boolean),
    ),
  );
  const humanizedFields = Array.from(
    new Set(dedupedSlugs.map((slug) => humanizeIssueSlug(slug, labels))),
  );
  const missingFieldsText = humanizedFields.join(', ');
  return {
    code: 'QUOTE_DATA_INVALID',
    message: missingFieldsText
      ? `Required customer confirmations or risk details are missing: ${missingFieldsText}. Complete them before issuing.`
      : 'Required quote details are missing. Complete the customer quote before issuing.',
    group: 'UNDERWRITING',
    severity: 'BLOCK',
    actions: [
      {
        label: 'Open customer quote',
        actionId: 'BO.OPEN_CUSTOMER_QUOTE',
        hash: input.detailsStepHash || '',
      },
    ],
    details: {
      schemaIssues: [...input.schemaIssues],
      missingSlugs: dedupedSlugs,
    },
  };
}

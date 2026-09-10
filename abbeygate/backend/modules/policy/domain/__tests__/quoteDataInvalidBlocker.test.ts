/**
 * QUOTE_DATA_INVALID readiness blocker — canonical contract.
 *
 * Pins the single source of truth for the BO-facing
 * "Required customer confirmations or risk details are missing: …"
 * blocker. Operators were previously shown the useless string
 * "Missing or invalid: proposer." for any number of distinct
 * `proposer.*` schema failures because the legacy humanizer truncated
 * dotted paths to their first segment AND a parallel orchestrator
 * (`evaluateIssueReadinessForQuoteData`) emitted a divergent blocker
 * shape (group `'PRICING'`, no humanized message at all). This file
 * locks the contract:
 *
 *   1. `humanizeIssueSlug` preserves the full dotted path, prefers the
 *      manifest label for known fields, reserves the `'form'` slug,
 *      and never collapses distinct subfields to a shared token.
 *   2. `buildQuoteDataInvalidBlocker` is the only producer of the
 *      readiness blocker, with stable code / group / message / details
 *      shape. Adding a parallel implementation re-introduces the
 *      regression.
 *   3. End-to-end via `evaluateIssueReadiness`: a Home payload with an
 *      empty `proposer.address.country` surfaces the exact field path
 *      to the operator (no "proposer" collapse).
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { registerAllProducts } from '../../../../products/registerProducts.js';
import {
  buildQuoteDataInvalidBlocker,
  humanizeIssueSlug,
} from '../quoteDataInvalidBlocker.js';

beforeAll(() => {
  registerAllProducts();
});

describe('humanizeIssueSlug', () => {
  it('preserves the full dotted path for nested fields when no label map is supplied', () => {
    expect(humanizeIssueSlug('proposer.address.country')).toBe('proposer.address.country');
    // camelCase is expanded per-segment, lower-cased
    expect(humanizeIssueSlug('proposer.firstName')).toBe('proposer.first name');
  });

  it('prefers the manifest label when one exists for the exact path', () => {
    const labels = { 'proposer.domicileCountry': 'Country of domicile' };
    expect(humanizeIssueSlug('proposer.domicileCountry', labels)).toBe('Country of domicile');
  });

  it('falls back to the humanized dotted path when the label map has no entry', () => {
    const labels = { 'proposer.firstName': 'First name' };
    expect(humanizeIssueSlug('proposer.address.country', labels)).toBe('proposer.address.country');
  });

  it("renders the reserved 'form' slug as a cross-field rule label, not as a literal token", () => {
    expect(humanizeIssueSlug('form')).toBe('form-level rule');
  });

  it('returns a stable placeholder for empty / whitespace-only slugs', () => {
    expect(humanizeIssueSlug('')).toBe('unknown field');
    expect(humanizeIssueSlug('   ')).toBe('unknown field');
  });

  it('does NOT collapse distinct proposer subfields to a single "proposer" token (regression guard)', () => {
    const collapsed = new Set([
      humanizeIssueSlug('proposer.address.country'),
      humanizeIssueSlug('proposer.address.city'),
      humanizeIssueSlug('proposer.firstName'),
    ]);
    expect(collapsed.size).toBe(3);
    expect(collapsed.has('proposer')).toBe(false);
  });
});

describe('buildQuoteDataInvalidBlocker (canonical builder — single source of truth)', () => {
  it('emits the canonical code, group, severity, and action for the BO blocker', () => {
    const blocker = buildQuoteDataInvalidBlocker({
      productType: 'HOME',
      schemaIssues: [
        { slug: 'proposer.address.country', message: 'Required', path: 'proposer.address.country' },
      ],
      detailsStepHash: 'policy-holder',
    });

    expect(blocker.code).toBe('QUOTE_DATA_INVALID');
    expect(blocker.group).toBe('UNDERWRITING');
    expect(blocker.severity).toBe('BLOCK');
    expect(blocker.actions).toEqual([
      { label: 'Open customer quote', actionId: 'BO.OPEN_CUSTOMER_QUOTE', hash: 'policy-holder' },
    ]);
  });

  it('lists each invalid field distinctly and never collapses to a top-level token', () => {
    const blocker = buildQuoteDataInvalidBlocker({
      productType: 'HOME',
      schemaIssues: [
        { slug: 'proposer.address.country', message: 'Required' },
        { slug: 'proposer.address.line1', message: 'Required' },
        { slug: 'proposer.domicileCountry', message: 'Required' },
      ],
    });

    expect(blocker.message).toContain('Country');
    expect(blocker.message).toContain('Address');
    // domicileCountry has a manifest label → operator-friendly form is preferred
    expect(blocker.message).toContain('Country of domicile');
    expect(blocker.details?.missingSlugs).toEqual([
      'proposer.address.country',
      'proposer.address.line1',
      'proposer.domicileCountry',
    ]);
    // Regression guard: no bare "proposer" token (would mean a path collapsed)
    const proposerOccurrences = (blocker.message.match(/(?<![.\w])proposer(?![.\w])/g) || []).length;
    expect(proposerOccurrences).toBe(0);
  });

  it('dedupes humanized fields when several slugs map to the same display value', () => {
    const blocker = buildQuoteDataInvalidBlocker({
      productType: null,
      schemaIssues: [
        { slug: 'proposer.firstName', message: 'Required' },
        { slug: 'proposer.firstName', message: 'Too short' },
        { slug: 'proposer.firstName', message: 'Required' },
      ],
    });
    // The "Missing or invalid: …" segment lists `proposer.first name` once
    const occurrences = (blocker.message.match(/proposer\.first name/g) || []).length;
    expect(occurrences).toBe(1);
  });

  it('falls back to a generic message (no missing-fields suffix) when schemaIssues is empty', () => {
    const blocker = buildQuoteDataInvalidBlocker({
      productType: 'HOME',
      schemaIssues: [],
    });
    expect(blocker.message).toBe(
      'Required quote details are missing. Complete the customer quote before issuing.',
    );
    expect(blocker.details).toMatchObject({ schemaIssues: [], missingSlugs: [] });
  });

  it('preserves schemaIssues and missingSlugs in details for downstream consumers', () => {
    const issues = [
      { slug: 'proposer.address.country', message: 'Required', path: 'proposer.address.country' },
      { slug: 'proposer.address.line1', message: 'Required' },
    ];
    const blocker = buildQuoteDataInvalidBlocker({ productType: 'HOME', schemaIssues: issues });
    expect(blocker.details?.schemaIssues).toEqual(issues);
    expect(blocker.details?.missingSlugs).toEqual([
      'proposer.address.country',
      'proposer.address.line1',
    ]);
  });

  it('omits the action hash gracefully when no detailsStepHash is supplied', () => {
    const blocker = buildQuoteDataInvalidBlocker({
      productType: 'HOME',
      schemaIssues: [{ slug: 'proposer.firstName', message: 'Required' }],
    });
    expect(blocker.actions?.[0]?.hash).toBe('');
  });

  it('uses operator-facing labels for customer declaration fields', () => {
    const blocker = buildQuoteDataInvalidBlocker({
      productType: 'MOTOR',
      schemaIssues: [
        { slug: 'fairProcessingAccepted', message: 'Required' },
        { slug: 'infoTrueAndAccurate', message: 'Required' },
        { slug: 'proposer.privacyPolicyAccepted', message: 'Required' },
      ],
    });

    expect(blocker.message).toBe(
      'Required customer confirmations or risk details are missing: Fair processing declaration, Information is true and accurate confirmation, Privacy policy acceptance. Complete them before issuing.',
    );
  });
});

// End-to-end wiring (canonical orchestrator → buildQuoteDataInvalidBlocker)
// is pinned by `quoteDataInvalidBlocker.endToEnd.test.ts`, which sits in
// a dedicated file because vitest's policy-repository mock is module-
// scoped. The pure tests above pin the message contract; the
// end-to-end test pins the wiring; the guardrail test
// (`quoteDataInvalidBlocker.guardrail.test.ts`) pins the
// "exactly one producer" canonical-ownership invariant.

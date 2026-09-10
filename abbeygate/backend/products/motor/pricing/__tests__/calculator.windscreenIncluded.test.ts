/**
 * Windscreen Cover (CV 24) pricing — ABY-265 regression.
 *
 * Locks both invariants of the on-spine fix:
 *
 *   1. The canonical `CV 24` endorsement template (in
 *      `backend/modules/mbe/domain/endorsementTemplates.ts`) defaults
 *      `premium_eur` to `0`. Peter confirmed that Windscreen is part
 *      of the core Comprehensive premium at no separate charge; the
 *      legacy `25 × termFactor` charge that surfaced on the wizard
 *      payment step (€25 on top of base + ULR + MIF) is gone.
 *
 *   2. When CV 24 is applied to a quote, the calculator still emits
 *      a `coverage.windscreen` step in the trace with `amount === 0`,
 *      so consumers (wizard `Step5Payment`, BO Premium tab, PDF
 *      schedule) can render a "Windscreen Cover — Included" row.
 *      Hiding the cover entirely would lose the customer signal that
 *      the windscreen IS covered, just at no extra charge.
 *
 * These invariants are the contract behind the canonical-ownership
 * rule for the motor windscreen line: the template + the calculator
 * step are the single source for "is windscreen covered?" and "how
 * much does it cost?". Every UI surface reads from there.
 */
import { describe, expect, it } from 'vitest';
import { calculateAutoInsuranceQuoteResponse } from '../autoInsuranceCalculator.js';
import {
  normalizeProgramMbeProductConfig,
  resolveCoverageV1,
} from '../../../../modules/mbe/domain/programProduct.js';
import { registerAllProducts } from '../../../registerProducts.js';
import { runWithOperatingTenant } from '../../../../platform/tenant/tenantAls.js';
import { getTenantFixtures } from '../../../testHelpers/tenantFixtures.js';
import { RERATE_CASES } from '../../../../test/fixtures/motor/rerate/cases.js';
import { TEMPLATES as ENDORSEMENT_TEMPLATES } from '../../../../modules/mbe/domain/endorsementTemplates.js';

registerAllProducts();

const cyTenant = getTenantFixtures().find((t) => t.countryCode === 'CY')!;
const runInCY = <T>(fn: () => T): T => runWithOperatingTenant(cyTenant, fn);

function pickComprehensiveCase() {
  // Use the first Comprehensive synthetic rerate fixture — it carries
  // CV 24 by default via the program's enabled-by-default option.
  const tc = RERATE_CASES.find((c) => /comprehensive/i.test(c.band));
  if (!tc) throw new Error('No Comprehensive rerate fixture available');
  return tc;
}

function priceComprehensiveQuote() {
  const tc = pickComprehensiveCase();
  const cfg = normalizeProgramMbeProductConfig(
    {},
    { productType: 'MOTOR', programCode: 'abbeygate_motor' },
  );
  const resolvedCoverageSet = resolveCoverageV1({
    productType: 'MOTOR',
    quoteData: tc.quoteData,
    cfg,
    selectedOptions: tc.selectedOptions,
  });
  return calculateAutoInsuranceQuoteResponse(
    tc.quoteData,
    undefined,
    { reference: `ABY-265-${tc.ref}`, currency: 'EUR' },
    resolvedCoverageSet.applied,
  );
}

describe('Windscreen Cover (CV 24) — ABY-265', () => {
  it('canonical CV 24 template default_params.premium_eur is 0 (no separate charge)', () => {
    // Narrow inline shapes for the params we actually read — keeps the
    // assertion strict without re-introducing a broad map cast at the
    // boundary (forbidden by the `no-new-any` diff ratchet outside
    // its sanctioned narrowing helper).
    type Cv24DefaultParams = { premium_eur?: unknown };
    type Cv24ComputedParam = { param?: unknown; defaultValue?: unknown };
    const cv24 = ENDORSEMENT_TEMPLATES.find((t) => String(t.code).trim().toUpperCase() === 'CV 24');
    expect(cv24, 'CV 24 (Windscreen) template must remain in the canonical catalogue').toBeDefined();
    const defaults = (cv24?.default_params ?? {}) as Cv24DefaultParams;
    expect(
      Number(defaults.premium_eur),
      'CV 24 must default to premium_eur=0 — Windscreen is included in the Comprehensive core premium',
    ).toBe(0);
    const computed: Cv24ComputedParam[] = Array.isArray(cv24?.computed_params)
      ? (cv24!.computed_params as Cv24ComputedParam[])
      : [];
    const premiumComputed = computed.find((entry) => String(entry.param || '') === 'premium_eur');
    expect(
      Number(premiumComputed?.defaultValue),
      'CV 24 computed_params defaultValue must also be 0 — otherwise pro-rating reintroduces the legacy charge',
    ).toBe(0);
  });

  it('emits a coverage.windscreen step with amount=0 on a Comprehensive quote', () => {
    const qr = runInCY(priceComprehensiveQuote);
    const steps = ((qr.primaryOption?.calculationTrace as { steps?: Array<{ id?: string; amount?: number; notes?: string }> } | undefined)?.steps) || [];
    const windscreenStep = steps.find((step) => String(step.id || '') === 'coverage.windscreen');
    expect(
      windscreenStep,
      'coverage.windscreen step must be emitted whenever CV 24 is applied, so consumers can render "Included"',
    ).toBeDefined();
    expect(Number(windscreenStep?.amount ?? 0)).toBe(0);
    expect(String(windscreenStep?.notes ?? '').toLowerCase()).toContain('included');
  });

  it('does not add a €25 (or pro-rated) windscreen charge to the total', () => {
    const qr = runInCY(priceComprehensiveQuote);
    const breakdown = (qr.primaryOption as { breakdown?: { windscreen?: number } } | undefined)?.breakdown;
    // `breakdown.windscreen` is the per-quote resolved amount; for the
    // canonical template it must be 0 (the legacy fallback of 25 ×
    // termFactor is gone, see `resolveEmbeddedWindscreenPremium`).
    expect(Number(breakdown?.windscreen ?? 0)).toBe(0);
  });
});

describe('Windscreen Cover (CV 24) — motorbike exclusion (ABY-340)', () => {
  const cfg = normalizeProgramMbeProductConfig(
    {},
    { productType: 'MOTOR', programCode: 'abbeygate_motor' },
  );
  const hasCv24 = (applied: Array<{ code: string }>) =>
    applied.some((a) => String(a.code).trim().toUpperCase() === 'CV 24');

  it('applies CV 24 to a Comprehensive car', () => {
    const tc = pickComprehensiveCase();
    const resolved = resolveCoverageV1({
      productType: 'MOTOR',
      quoteData: tc.quoteData,
      cfg,
      selectedOptions: tc.selectedOptions,
    });
    expect(hasCv24(resolved.applied)).toBe(true);
  });

  it('excludes CV 24 from a Comprehensive motorbike even when explicitly selected', () => {
    const tc = pickComprehensiveCase();
    const motorbikeQuote = { ...tc.quoteData, vehicleType: 'Motorbike' };
    const resolved = resolveCoverageV1({
      productType: 'MOTOR',
      quoteData: motorbikeQuote,
      cfg,
      selectedOptions: { ...(tc.selectedOptions || {}), 'CV 24': true },
    });
    expect(hasCv24(resolved.applied)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { calculateAutoInsuranceQuoteResponse as calculateMotorQuoteResponse } from '../autoInsuranceCalculator.js';
import { loadAbbeygateAutoCyprus2022Matrix } from '../data/loader.js';
import {
  normalizeProgramMbeProductConfig,
  resolveCoverageV1,
} from '../../../../modules/mbe/domain/programProduct.js';
import { registerAllProducts } from '../../../registerProducts.js';
import { runWithOperatingTenant } from '../../../../platform/tenant/tenantAls.js';
import { getTenantFixtures } from '../../../testHelpers/tenantFixtures.js';
import { RERATE_CASES } from '../../../../test/fixtures/motor/rerate/cases.js';
import { evaluateMotorUwFixture } from '../../underwriting/__tests__/fixtureHelper.js';

registerAllProducts();
const motorModel = loadAbbeygateAutoCyprus2022Matrix();
const calculateAutoInsuranceQuoteResponse = (...[quoteData, overrideExcess, opts, appliedEndorsements = []]: Parameters<typeof calculateMotorQuoteResponse>) =>
  calculateMotorQuoteResponse(quoteData, overrideExcess, opts, appliedEndorsements, motorModel);

/**
 * Scheme-alignment re-rate (post ADR-0023) against SYNTHETIC fixtures.
 *
 * The fixtures live at backend/test/fixtures/motor/rerate/ and carry no
 * customer PII. Each pinned total is the value the current motor engine
 * emits for that synthetic input; regenerate via the steps in
 * backend/test/fixtures/motor/rerate/README.md when an ADR intentionally
 * shifts the ladder.
 *
 * Unlike the prior /tmp/policies-dependent version, this suite must
 * always run — no `it.skip` fallbacks. ADR-amended rating changes
 * surface here.
 */

const cyTenant = getTenantFixtures().find((t) => t.countryCode === 'CY')!;
const runInCY = <T>(fn: () => T): T => runWithOperatingTenant(cyTenant, fn);

type ExpectedByRef = Record<string, number>;

// Pinned totals — the current motor engine output for each synthetic
// fixture. Updated only when an ADR intentionally amends the ladder.
//
// ABY-265 — Windscreen (CV 24) `premium_eur` default reset from 25 to
// 0 in the canonical `endorsementTemplates.ts` (Windscreen is now
// included in the core Comprehensive premium at no separate charge,
// per Peter's directive). The pro-rated €25 charge is removed from
// every Comprehensive fixture below; SYN-SMALL-CAR-NO-CP and the
// CV-172 fixtures both drop by ~€9.63 (= 25 × policy-term-factor).
const EXPECTED: ExpectedByRef = {
  'SYN-SMALL-CAR-NO-CP': 335.58,
  'SYN-MID-SALOON-CP': 412.65,
  'SYN-LARGER-CP': 464.34,
  'SYN-PREMIUM-CP': 495.85,
  'SYN-MATURE-CP': 406.96,
};

function computeTotal(caseInput: typeof RERATE_CASES[number]): number {
  const cfg = normalizeProgramMbeProductConfig(
    {},
    { productType: 'MOTOR', programCode: 'abbeygate_motor' },
  );
  const resolvedCoverageSet = resolveCoverageV1({
    productType: 'MOTOR',
    quoteData: caseInput.quoteData,
    cfg,
    selectedOptions: caseInput.selectedOptions,
  });
  const qr = calculateAutoInsuranceQuoteResponse(
    caseInput.quoteData,
    undefined,
    { reference: `RERATE-${caseInput.ref}`, currency: 'EUR', uwDecision: evaluateMotorUwFixture(caseInput.quoteData) },
    resolvedCoverageSet.applied,
  );
  const primary = qr.primaryOption || {};
  const costDetails = primary.costDetails as { totalPremium?: number } | undefined;
  return Number(costDetails?.totalPremium ?? primary.annualPremium ?? 0);
}

describe('scheme-alignment re-rate (post ADR-0023, synthetic fixtures)', () => {
  for (const tc of RERATE_CASES) {
    it(`${tc.ref} (${tc.band}) matches pinned total within EUR 0.01`, () => {
      const actual = runInCY(() => computeTotal(tc));
      // Bootstrap helper: when an EXPECTED value is left at the 0
      // sentinel (e.g. after adding a new case), the failed assertion
      // below prints both numbers, which is enough for the
      // regenerator to copy the actual into EXPECTED. No console line
      // needed (the structured logger guard rejects console.* in
      // backend code, and that's the right rule).
      expect(actual).toBeCloseTo(EXPECTED[tc.ref], 2);
    });
  }
});

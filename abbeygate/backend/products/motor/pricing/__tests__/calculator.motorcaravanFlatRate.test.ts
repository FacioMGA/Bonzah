/**
 * Motorcaravan flat-rate scheme — ABY-353 regression.
 *
 * The Abbeygate motorcaravan scheme is a FLAT km-banded rate per the rate
 * sheet (Peter Sheppard): €450 (<=10k km), €500 (<=20k km), €600 (>20k km),
 * each "+ tax + breakdown". Like the motorcycle scheme it carries NO
 * No-Claims-Discount scale.
 *
 * The live bug (quote ABQ/PT1000174): a 30,000 km/year motorcaravan with
 * "5+ Years" NCB priced at €341.99 because the 65% NCD was applied on top
 * of the €600 flat band (600 -> 210 net, then tax). This test locks the
 * fix: NCD (and the online discount) are suppressed for motorcaravans, so
 * the net premium equals the flat band rate.
 */
import { describe, expect, it } from 'vitest';
import { calculateAutoInsuranceQuoteResponse } from '../autoInsuranceCalculator.js';
import { registerAllProducts } from '../../../registerProducts.js';
import { runWithOperatingTenant } from '../../../../platform/tenant/tenantAls.js';
import { getTenantFixtures } from '../../../testHelpers/tenantFixtures.js';
import { RERATE_CASES } from '../../../../test/fixtures/motor/rerate/cases.js';

registerAllProducts();

const cyTenant = getTenantFixtures().find((t) => t.countryCode === 'CY')!;
const runInCY = <T>(fn: () => T): T => runWithOperatingTenant(cyTenant, fn);

type Trace = { steps?: Array<{ id?: string; output?: number; factor?: number }> };
type CostDetails = { subtotalNetPremium?: number; ncdAmount?: number; grossPremium?: number };

function priceMotorcaravan(overrides: Record<string, unknown>) {
  const base = RERATE_CASES.find((c) => /comprehensive/i.test(c.band));
  if (!base) throw new Error('No Comprehensive rerate fixture available');
  const quoteData = {
    ...base.quoteData,
    vehicleType: 'Motorcaravan',
    coverRequired: 'Comprehensive',
    ncb: '5+ Years',
    protectNCB: true,
    ...overrides,
  };
  return calculateAutoInsuranceQuoteResponse(
    quoteData,
    undefined,
    { reference: 'ABY-353', currency: 'EUR' },
  );
}

describe('Motorcaravan flat-rate scheme (ABY-353)', () => {
  it('prices the flat km band with NO NCD discount even at 5+ years NCB', () => {
    const qr = runInCY(() => priceMotorcaravan({ kmsPerYear: '30,000' }));
    const po = qr.primaryOption as { calculationTrace?: Trace; costDetails?: CostDetails; breakdown?: { finalPremium?: number } } | undefined;
    const steps = po?.calculationTrace?.steps || [];

    const band = steps.find((s) => String(s.id || '') === 'motorcaravan.base');
    expect(Number(band?.output), '30,000 km/year must resolve to the €600 band').toBe(600);

    // The bug: a discount.ncd step (factor 0.35) was applied. After the
    // fix there must be NO NCD discount on the flat scheme.
    const ncd = steps.find((s) => String(s.id || '') === 'discount.ncd');
    expect(ncd, 'motorcaravans must not receive an NCD discount').toBeUndefined();

    expect(Number(po?.costDetails?.ncdAmount ?? 0)).toBe(0);
    // Net premium = the flat band rate (no discount erosion).
    expect(Number(po?.costDetails?.subtotalNetPremium)).toBe(600);
  });

  it('resolves the lower mileage bands flat (10k -> 450, 20k -> 500)', () => {
    const lo = runInCY(() => priceMotorcaravan({ kmsPerYear: '10,000' }));
    const mid = runInCY(() => priceMotorcaravan({ kmsPerYear: '20,000' }));
    const stepOut = (qr: unknown) =>
      Number(((qr as { primaryOption?: { calculationTrace?: Trace } }).primaryOption?.calculationTrace?.steps || [])
        .find((s) => String(s.id || '') === 'motorcaravan.base')?.output);
    expect(stepOut(lo)).toBe(450);
    expect(stepOut(mid)).toBe(500);
    expect(Number((lo.primaryOption as { costDetails?: CostDetails }).costDetails?.subtotalNetPremium)).toBe(450);
    expect(Number((mid.primaryOption as { costDetails?: CostDetails }).costDetails?.subtotalNetPremium)).toBe(500);
  });
});

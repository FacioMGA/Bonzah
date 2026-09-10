import { describe, expect, it } from 'vitest';
import { calculateTravelTaxes } from '../travelTaxes.js';
import { resolveJurisdictionProductConfig } from '../../../../modules/jurisdiction/domain/productConfiguration.js';

/**
 * Per-country Travel tax goldens (ADR-0024 + Peter 2026-05-16).
 *
 * Each test asserts the headline IPT and any parafiscal levies / flat
 * stamp duty / minimum duty for a given country at a fixed net premium.
 * These are the canonical source of truth for "what tax does an X-resident
 * Travel customer see at net=Y" — drift in the JSON file flips these tests.
 */

function configFor(country: string) {
  return resolveJurisdictionProductConfig({
    productCode: 'TRAVEL',
    tenant: { countryCode: 'CY' },
    customerCountryOfResidence: country,
  });
}

describe('calculateTravelTaxes — per-country goldens', () => {
  it('Cyprus: 0% IPT (no stamp duty per Peter 2026-05-16)', () => {
    const result = calculateTravelTaxes({ config: configFor('Republic of Cyprus'), netPremium: 100 });
    expect(result.refer).toBe(false);
    expect(result.iptAmount).toBe(0);
    expect(result.parafiscalAmount).toBe(0);
    expect(result.flatStampDuty).toBe(0);
    expect(result.totalTaxAmount).toBe(0);
  });

  it('Portugal: 9% stamp duty on net premium', () => {
    const result = calculateTravelTaxes({ config: configFor('Portugal'), netPremium: 100 });
    expect(result.iptAmount).toBe(9);
    expect(result.totalTaxAmount).toBe(9);
  });

  it('Greece: 15% IPT + 0.4% pension fund levy', () => {
    const result = calculateTravelTaxes({ config: configFor('Greece'), netPremium: 100 });
    expect(result.iptAmount).toBe(15);
    expect(result.parafiscalAmount).toBe(0.4);
    expect(result.totalTaxAmount).toBe(15.4);
    const pension = result.rows.find((r) => r.code === 'PENSION_FUND');
    expect(pension?.amount).toBe(0.4);
    expect(pension?.rate).toBe(0.004);
  });

  it('Spain: 8% IPT + 0.15% winding-up fund', () => {
    const result = calculateTravelTaxes({ config: configFor('Spain'), netPremium: 100 });
    expect(result.iptAmount).toBe(8);
    expect(result.parafiscalAmount).toBe(0.15);
    expect(result.totalTaxAmount).toBe(8.15);
  });

  it('Belgium: 9.25% IPT', () => {
    const result = calculateTravelTaxes({ config: configFor('Belgium'), netPremium: 100 });
    expect(result.iptAmount).toBe(9.25);
    expect(result.totalTaxAmount).toBe(9.25);
  });

  it('Italy: 21.25% IPT flagged as interim conservative', () => {
    const result = calculateTravelTaxes({ config: configFor('Italy'), netPremium: 100 });
    expect(result.iptAmount).toBe(21.25);
    expect(result.totalTaxAmount).toBe(21.25);
    expect(result.interimConservative).toBe(true);
  });

  it('France: 9% IPT + €6.50 flat terrorism levy per policy', () => {
    const result = calculateTravelTaxes({ config: configFor('France'), netPremium: 100 });
    expect(result.iptAmount).toBe(9);
    expect(result.flatStampDuty).toBe(6.5);
    expect(result.totalTaxAmount).toBe(15.5);
  });

  it('Malta: 11% document duty with €13 minimum applied to small premiums', () => {
    const small = calculateTravelTaxes({ config: configFor('Malta'), netPremium: 50 });
    // 50 * 0.11 = 5.5 → bumped to €13 minimum.
    expect(small.iptAmount).toBe(13);
    expect(small.totalTaxAmount).toBe(13);

    const large = calculateTravelTaxes({ config: configFor('Malta'), netPremium: 200 });
    // 200 * 0.11 = 22 → above the minimum, applied as-is.
    expect(large.iptAmount).toBe(22);
    expect(large.totalTaxAmount).toBe(22);
  });

  it('Netherlands: REFER (partial-exemption pending BRIT confirmation)', () => {
    const result = calculateTravelTaxes({ config: configFor('Netherlands'), netPremium: 100 });
    expect(result.refer).toBe(true);
    expect(result.referReason).toMatch(/partial-exemption/i);
    expect(result.totalTaxAmount).toBe(0);
  });

  it('rounds amounts to 2dp with EXCEL_COMPAT metadata', () => {
    const result = calculateTravelTaxes({ config: configFor('Greece'), netPremium: 73.33 });
    expect(result.iptAmount).toBe(11);
    expect(result.parafiscalAmount).toBe(0.29);
    expect(result.rows.every((r) => r.rounding?.mode === 'EXCEL_COMPAT' && r.rounding.precision === 2)).toBe(true);
  });
});

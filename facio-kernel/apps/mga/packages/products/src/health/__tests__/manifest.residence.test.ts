import { describe, expect, it } from 'vitest';
import { HEALTH_RESIDENCE_COUNTRY_OPTIONS } from '../manifest';
import { healthValidationProfile } from '../profile';

/**
 * ABY-284 — Country-of-residence dropdown was hardcoded to a single
 * "Republic of Cyprus" entry, so non-CY customers (a) couldn't see
 * the question's discriminating shape and (b) silently received the
 * prefilled value without confirming. The fix exposes the full
 * country list and routes the eligibility decline through
 * `healthUwAutomation.evaluateHealthUw`'s `allowedResidenceCountries`
 * server-side check. These tests pin both ends of that contract so a
 * future regression to a single-country whitelist surfaces here.
 */
describe('HEALTH_RESIDENCE_COUNTRY_OPTIONS (ABY-284)', () => {
  it('exposes far more than one country (the regression was a single-CY entry)', () => {
    expect(HEALTH_RESIDENCE_COUNTRY_OPTIONS.length).toBeGreaterThan(50);
  });

  it('still includes the eligible Cyprus entry so the canonical CY answer is selectable', () => {
    expect(HEALTH_RESIDENCE_COUNTRY_OPTIONS.some((opt) => opt.value === 'Cyprus')).toBe(true);
  });

  it('includes typical ineligible Phase-1 choices so the customer can self-select and the server-side UW decline can fire', () => {
    const values = HEALTH_RESIDENCE_COUNTRY_OPTIONS.map((opt) => opt.value);
    // These countries should be present so the customer can ANSWER
    // honestly; eligibility decline happens server-side at rate time
    // (`healthUwAutomation.evaluateHealthUw` →
    // `allowedResidenceCountries: ['Cyprus']`), NOT via
    // a client-side dropdown filter.
    expect(values.some((v) => /United Kingdom|England|UK/i.test(v))).toBe(true);
    expect(values.some((v) => /Germany/i.test(v))).toBe(true);
    expect(values.some((v) => /Greece/i.test(v))).toBe(true);
  });
});

describe('healthValidationProfile.fields["eligibility.countryOfResidence"] (ABY-284)', () => {
  it('uses the generic countryName rule, NOT a single-country oneOf whitelist', () => {
    const field = healthValidationProfile.fields['eligibility.countryOfResidence'];
    expect(field).toBeDefined();
    expect(field?.rule).toBe('countryName');
    expect(field?.required).toBe(true);
  });
});

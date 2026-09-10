import { describe, expect, it } from 'vitest';
import { isUkOrEuLicenceCountry, requiresForeignLicenceConfirmation } from '../licenceCountry.js';

describe('licenceCountry classification (non-UK/EU confirmation)', () => {
  it('treats the UK and EU-27 (and "Other EU") as accepted without confirmation', () => {
    for (const country of [
      'United Kingdom', 'UK', 'England', 'Scotland', 'Wales', 'Northern Ireland',
      'Cyprus', 'Portugal', 'Spain', 'Greece', 'Ireland', 'France', 'Germany', 'Malta',
      'Other EU',
    ]) {
      expect(isUkOrEuLicenceCountry(country)).toBe(true);
      expect(requiresForeignLicenceConfirmation(country)).toBe(false);
    }
  });

  it('requires confirmation for non-UK/EU licences', () => {
    for (const country of ['Russia', 'United States', 'USA', 'Switzerland', 'Norway', 'Australia', 'Ukraine']) {
      expect(isUkOrEuLicenceCountry(country)).toBe(false);
      expect(requiresForeignLicenceConfirmation(country)).toBe(true);
    }
  });

  it('does not require confirmation when the country is empty / not yet answered', () => {
    for (const value of ['', '   ', null, undefined]) {
      expect(requiresForeignLicenceConfirmation(value)).toBe(false);
    }
  });
});

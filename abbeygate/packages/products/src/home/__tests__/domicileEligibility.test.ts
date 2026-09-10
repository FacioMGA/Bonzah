import { describe, expect, it } from 'vitest';
import { isUkOrEuDomicileCountry } from '../domicileEligibility.js';

describe('isUkOrEuDomicileCountry', () => {
  it('treats the UK and EU-27 as eligible for online holiday-home bind', () => {
    for (const country of [
      'United Kingdom', 'UK', 'England', 'Scotland', 'Wales', 'Northern Ireland',
      'Cyprus', 'Portugal', 'Spain', 'Greece', 'Ireland', 'France', 'Germany', 'Malta',
    ]) {
      expect(isUkOrEuDomicileCountry(country)).toBe(true);
    }
  });

  it('treats non-UK/EU domiciles as outside online holiday-home appetite', () => {
    for (const country of ['United States of America', 'Russia', 'Switzerland', 'Norway', 'Australia', 'United Arab Emirates']) {
      expect(isUkOrEuDomicileCountry(country)).toBe(false);
    }
  });

  it('returns false for empty / unknown values', () => {
    for (const value of ['', '   ', null, undefined]) {
      expect(isUkOrEuDomicileCountry(value)).toBe(false);
    }
  });
});

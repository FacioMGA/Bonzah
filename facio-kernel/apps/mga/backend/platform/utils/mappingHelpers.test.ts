import { describe, expect, it } from 'vitest';
import {
  resolveInceptionDateFromRenewalDate,
  resolvePolicyIssuanceDates,
} from './mappingHelpers.js';

function daysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

describe('resolvePolicyIssuanceDates', () => {
  it('incepts a HOME policy on the requested policy.startDate, not the purchase date', () => {
    const start = daysFromNow(7);
    const { inceptionDate, expiryDate } = resolvePolicyIssuanceDates(
      'HOME',
      { policy: { startDate: start } },
      resolveInceptionDateFromRenewalDate,
    );
    expect(inceptionDate.toISOString().slice(0, 10)).toBe(start);
    // Annual: expiry is +365 days from the requested start.
    const expectedExpiry = new Date(start);
    expectedExpiry.setDate(expectedExpiry.getDate() + 365);
    expect(expiryDate.toISOString().slice(0, 10)).toBe(expectedExpiry.toISOString().slice(0, 10));
  });

  it('incepts a TRAVEL single trip on trip.startDate and expires on trip.endDate', () => {
    const start = daysFromNow(7);
    const end = daysFromNow(21);
    const { inceptionDate, expiryDate } = resolvePolicyIssuanceDates(
      'TRAVEL',
      { trip: { planType: 'single_trip', startDate: start, endDate: end } },
      resolveInceptionDateFromRenewalDate,
    );
    expect(inceptionDate.toISOString().slice(0, 10)).toBe(start);
    expect(expiryDate.toISOString().slice(0, 10)).toBe(end);
  });

  it('gives an annual multi-trip TRAVEL policy a +365-day expiry from the requested start', () => {
    const start = daysFromNow(7);
    const { inceptionDate, expiryDate } = resolvePolicyIssuanceDates(
      'TRAVEL',
      { trip: { planType: 'annual_multi_trip', startDate: start, endDate: '' } },
      resolveInceptionDateFromRenewalDate,
    );
    expect(inceptionDate.toISOString().slice(0, 10)).toBe(start);
    const expectedExpiry = new Date(start);
    expectedExpiry.setDate(expectedExpiry.getDate() + 365);
    expect(expiryDate.toISOString().slice(0, 10)).toBe(expectedExpiry.toISOString().slice(0, 10));
  });

  it('clamps a requested start date in the past to now (cover never begins before issuance)', () => {
    const { inceptionDate } = resolvePolicyIssuanceDates(
      'HOME',
      { policy: { startDate: '2020-01-01' } },
      resolveInceptionDateFromRenewalDate,
    );
    expect(inceptionDate.getTime()).toBeGreaterThan(new Date('2020-01-02').getTime());
  });

  it('falls back to renewalDate resolution when no requested start date exists (motor/legacy)', () => {
    const renewal = daysFromNow(10);
    const { inceptionDate } = resolvePolicyIssuanceDates(
      'MOTOR',
      { renewalDate: renewal },
      resolveInceptionDateFromRenewalDate,
    );
    expect(inceptionDate.toISOString().slice(0, 10)).toBe(renewal);
  });
});

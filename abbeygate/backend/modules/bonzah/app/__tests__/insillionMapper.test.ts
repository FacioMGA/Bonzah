import { describe, expect, it } from 'vitest';
import { goldenRentalQuote } from '../../../../products/rental/goldenFixtures.js';
import { coverageFlags, insillionDate, insillionState, toInsillionFinalQuote, toInsillionPremium } from '../insillionMapper.js';

describe('Insillion Bonzah mapping', () => {
  it('preserves birthdays and formats instants in the explicit booking timezone', () => {
    expect(insillionDate('1990-07-29')).toBe('07/29/1990');
    expect(insillionDate('2026-09-18T02:30:00Z', true, 'America/Denver')).toBe('09/17/2026 20:30:00');
    expect(insillionDate('2026-09-18T00:30:00+03:00')).toBe('09/18/2026');
    expect(() => insillionDate('2026-09-18T02:30:00Z', true, 'invalid/zone')).toThrow();
  });

  it.each([['10:30:00', 'Later'], ['09:30:00', 'Same'], ['10:00:00', 'Same']])('compares complete wall times for return at %s', (time, expected) => {
    const request = { ...goldenRentalQuote, risk: { ...goldenRentalQuote.risk, rentalStart: '2026-09-18T10:00:00-06:00', rentalEnd: `2026-09-22T${time}-06:00` } };
    expect(toInsillionPremium(request).drop_off_time).toBe(expected);
  });
  it('maps canonical coverage and jurisdiction values to exact provider keys', () => {
    expect(coverageFlags(['CDW', 'RCLI', 'SLI', 'PAI_PEI'])).toEqual({ cdw_cover: true, rcli_cover: true, sli_cover: true, pai_cover: true });
    expect(insillionState('CA')).toBe('California');
    expect(toInsillionPremium(goldenRentalQuote)).toMatchObject({
      trip_start_date: '09/18/2026', trip_end_date: '09/22/2026', pickup_country: 'United States', pickup_state: 'Colorado',
      drop_off_time: 'Same', cdw_cover: true, rcli_cover: true, sli_cover: true, pai_cover: true, skip_validation: false,
    });
  });

  it('isolates the provider licence spelling and emits a complete finalization payload', () => {
    const payload = toInsillionFinalQuote(goldenRentalQuote, {
      integrityToken: '1234567890123456', payment: { provider: 'HOSTED', token: 'provider-token' },
      policyholder: { firstName: 'Alex', lastName: 'Morgan', dateOfBirth: '1991-06-15', email: 'alex@example.test', phone: '+15550102040', address: { line1: '1 Main St', city: 'Denver', state: 'CA', postalCode: '01061', country: 'US' }, licence: { number: 'D123', state: 'CA' } },
      rentalAgreement: { rentalCompany: 'Summit' }, inspectionRecipient: 'Renter', policyBookingTimeZone: 'America/Denver',
      additionalDrivers: [{ firstName: 'Sam', lastName: 'Lee', email: 'sam@example.test', dateOfBirth: '1990-07-29', phone: '13251233246' }],
      consents: { electronicDelivery: true, termsAndPrivacyAccepted: true, exclusionsAccepted: true, truthfulnessAccepted: true, liabilityNoticeAccepted: true, wordingVersion: 'v1', acceptedAt: '2026-09-07T10:00:00Z' },
    });
    expect(payload).toMatchObject({ licence_no: 'D123', drivers_license_state: 'California', year: 2025, make: 'Toyota', model: 'RAV4', ev_classification: 'Hybrid', rental_use: 'Pleasure/Personal', finalize: 1 });
    expect(payload).not.toHaveProperty('license_no');
  });
});

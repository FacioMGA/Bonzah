import { describe, expect, it } from 'vitest';
import { goldenRentalQuote } from '../../../../products/rental/goldenFixtures.js';
import { rentalBindBodySchema, rentalQuoteBodySchema } from '../schemas.js';

describe('Bonzah partner API schemas', () => {
  const validBind = { integrityToken: '1234567890123456', payment: { provider: 'SIMULATED', token: 'simulated-payment-token' }, policyholder: { firstName: 'Alex', lastName: 'Morgan', dateOfBirth: '1991-06-15', email: 'alex.morgan@example.test', phone: '+15550102040', address: { line1: '123 Summit Demo Way', city: 'Denver', state: 'CA', postalCode: '80202', country: 'US' }, licence: { number: 'D0000000', state: 'CA' } }, rentalAgreement: { rentalCompany: 'Summit Rentals' }, consents: { electronicDelivery: true, termsAndPrivacyAccepted: true, exclusionsAccepted: true, truthfulnessAccepted: true, liabilityNoticeAccepted: true, wordingVersion: 'bonzah-rental-us-2026.1', acceptedAt: '2026-09-07T10:00:00.000Z' } };
  it('accepts the golden partner quote contract', () => {
    expect(rentalQuoteBodySchema.safeParse({ ...goldenRentalQuote, channel: 'API' }).success).toBe(true);
  });

  it('rejects missing or malformed rental and vehicle data', () => {
    expect(rentalQuoteBodySchema.safeParse({ ...goldenRentalQuote, risk: { ...goldenRentalQuote.risk, rentalEnd: 'not-a-date' } }).success).toBe(false);
    expect(rentalQuoteBodySchema.safeParse({ ...goldenRentalQuote, risk: { ...goldenRentalQuote.risk, vehicle: { ...goldenRentalQuote.risk.vehicle, declaredValue: -1 } } }).success).toBe(false);
  });

  it('accepts only simulated verified payment at bind', () => {
    expect(rentalBindBodySchema.safeParse(validBind).success).toBe(true);
    expect(rentalBindBodySchema.safeParse({ ...validBind, payment: { provider: 'SIMULATED', token: 'short' } }).success).toBe(false);
    expect(rentalBindBodySchema.safeParse({ ...validBind, policyholder: undefined }).success).toBe(false);
  });

  it('rejects rental-commerce presentation fields in a rating vehicle', () => {
    expect(rentalQuoteBodySchema.safeParse({ ...goldenRentalQuote, risk: { ...goldenRentalQuote.risk, vehicle: { ...goldenRentalQuote.risk.vehicle, dailyRentalPrice: 69 } } }).success).toBe(false);
  });
});

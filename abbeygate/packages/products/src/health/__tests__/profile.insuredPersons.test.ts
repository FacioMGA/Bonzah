import { afterEach, describe, expect, it } from 'vitest';
import { ValidationRegistry, validateForContext } from '@facio/validation/frontend';
import { healthValidationProfile } from '../profile.js';

describe('healthValidationProfile lead insured contact (ABY-517)', () => {
  afterEach(() => {
    ValidationRegistry._resetForTests();
  });

  it('declares required email and phone on insureds.persons.0', () => {
    expect(healthValidationProfile.fields['insureds.persons.0.email']).toMatchObject({
      rule: 'email',
      required: true,
    });
    expect(healthValidationProfile.fields['insureds.persons.0.phone']).toMatchObject({
      rule: 'phoneE164',
      required: true,
    });
  });

  it('includes lead insured contact fields on the insured-persons step', () => {
    const step = healthValidationProfile.steps.find((entry) => entry.id === 'insured-persons');
    expect(step?.fields).toContain('insureds.persons.0.email');
    expect(step?.fields).toContain('insureds.persons.0.phone');
  });

  it('requires lead insured email and phone when validating the insured-persons step', () => {
    ValidationRegistry.register(healthValidationProfile);
    const errors = validateForContext({
      productCode: 'HEALTH',
      stage: { kind: 'wizardStep', id: 'insured-persons' },
      actor: 'customer',
      data: {
        insureds: {
          coverType: 'single',
          personCount: 1,
          persons: [{
            firstName: 'Effie',
            lastName: 'Pavlou',
            dob: '1985-04-20',
            gender: 'female',
            idType: 'passport',
            idNumber: 'CY-12345678',
            occupation: 'student',
            email: '',
            phone: '',
          }],
        },
      },
    });

    expect(errors['insureds.persons.0.email']).toMatch(/email/i);
    expect(errors['insureds.persons.0.phone']).toMatch(/phone/i);
  });
});

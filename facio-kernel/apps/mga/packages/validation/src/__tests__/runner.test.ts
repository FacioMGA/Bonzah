import { afterEach, describe, expect, it } from 'vitest';
import { ValidationRegistry, validateForContext } from '../adapters/frontend.js';
import type { ValidationProfile } from '../types.js';
import { requiredIf } from '../rules-pure.js';

function registerProfile(profile: ValidationProfile) {
  ValidationRegistry.register(profile);
  return profile;
}

const baseProfile = (): ValidationProfile => ({
  productCode: 'TEST',
  fields: {
    'proposer.firstName': { path: 'proposer.firstName', rule: 'name', required: true, label: 'First name' },
    'proposer.lastName': { path: 'proposer.lastName', rule: 'name', required: true, label: 'Last name' },
    'proposer.email': { path: 'proposer.email', rule: 'email', required: true, label: 'Email' },
    'proposer.dateOfBirth': { path: 'proposer.dateOfBirth', rule: 'dob:18-85', required: true, label: 'DOB' },
    'proposer.address.postcode': { path: 'proposer.address.postcode', rule: 'postcode:portugal', required: true },
    'proposer.marketingConsent': { path: 'proposer.marketingConsent', rule: 'bool', audience: 'customer' },
    'claims.hasClaims': { path: 'claims.hasClaims', rule: 'bool' },
    'claims.claimsDetails': { path: 'claims.claimsDetails', rule: 'nonEmptyString' },
  },
  steps: [
    {
      id: 'policy-holder',
      fields: [
        'proposer.firstName',
        'proposer.lastName',
        'proposer.email',
        'proposer.dateOfBirth',
        'proposer.address.postcode',
        'proposer.marketingConsent',
      ],
    },
    {
      id: 'claims',
      fields: ['claims.hasClaims', 'claims.claimsDetails'],
      refinements: [
        requiredIf<Record<string, unknown>>(
          'claims.claimsDetails',
          (d) => d['claims.hasClaims'] === true,
          'Claims details are required when claims have been declared',
        ),
      ],
    },
  ],
  stages: {
    bind: {
      fields: ['proposer.firstName', 'proposer.lastName', 'proposer.email', 'proposer.dateOfBirth'],
    },
  },
});

afterEach(() => {
  ValidationRegistry._resetForTests();
});

describe('validateForContext', () => {
  it('throws when no profile is registered (no fail-open)', () => {
    expect(() => validateForContext({
      productCode: 'unknown',
      stage: { kind: 'wizardStep', id: 'policy-holder' },
      actor: 'customer',
      data: {},
    })).toThrow(/no ValidationProfile registered for productCode='unknown'/);
  });

  it('flags missing required fields for a wizard step', () => {
    registerProfile(baseProfile());
    const errors = validateForContext({
      productCode: 'TEST',
      stage: { kind: 'wizardStep', id: 'policy-holder' },
      actor: 'customer',
      data: {},
    });
    expect(errors['proposer.firstName']).toMatch(/at least 2/i);
    expect(errors['proposer.lastName']).toMatch(/at least 2/i);
    expect(errors['proposer.email']).toMatch(/enter your email/i);
    expect(errors['proposer.dateOfBirth']).toMatch(/date of birth/i);
    expect(errors['proposer.address.postcode']).toMatch(/post code/i);
  });

  it('passes with valid data', () => {
    registerProfile(baseProfile());
    const errors = validateForContext({
      productCode: 'TEST',
      stage: { kind: 'wizardStep', id: 'policy-holder' },
      actor: 'customer',
      data: {
        proposer: {
          firstName: 'Uriel',
          lastName: 'Aharoni',
          email: 'u@example.com',
          dateOfBirth: '1985-05-15',
          address: { postcode: '1000-001' },
          marketingConsent: false,
        },
      },
    });
    expect(errors).toEqual({});
  });

  it('rejects future DOB with explicit message', () => {
    registerProfile(baseProfile());
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    const errors = validateForContext({
      productCode: 'TEST',
      stage: { kind: 'wizardStep', id: 'policy-holder' },
      actor: 'customer',
      data: {
        proposer: {
          firstName: 'Uriel',
          lastName: 'Aharoni',
          email: 'u@example.com',
          dateOfBirth: future.toISOString().slice(0, 10),
          address: { postcode: '1000-001' },
        },
      },
    });
    expect(errors['proposer.dateOfBirth']).toBe('Date of birth cannot be in the future');
  });

  it('applies cross-field refinements (requiredIf)', () => {
    registerProfile(baseProfile());
    const errors = validateForContext({
      productCode: 'TEST',
      stage: { kind: 'wizardStep', id: 'claims' },
      actor: 'customer',
      data: { claims: { hasClaims: true, claimsDetails: '' } },
    });
    expect(errors['claims.claimsDetails']).toMatch(/claims details are required/i);
  });

  it('narrows to focusField when supplied', () => {
    registerProfile(baseProfile());
    const errors = validateForContext({
      productCode: 'TEST',
      stage: { kind: 'wizardStep', id: 'policy-holder' },
      actor: 'underwriter',
      data: { proposer: {} },
      focusField: 'proposer.email',
    });
    expect(Object.keys(errors)).toEqual(['proposer.email']);
    expect(errors['proposer.email']).toMatch(/email/i);
  });

  it('hides customer-only fields for underwriter actor', () => {
    const profile = baseProfile();
    profile.fields['proposer.marketingConsent'].required = true;
    registerProfile(profile);
    const errors = validateForContext({
      productCode: 'TEST',
      stage: { kind: 'wizardStep', id: 'policy-holder' },
      actor: 'underwriter',
      data: {
        proposer: {
          firstName: 'Uriel',
          lastName: 'Aharoni',
          email: 'u@example.com',
          dateOfBirth: '1985-05-15',
          address: { postcode: '1000-001' },
        },
      },
    });
    expect(errors['proposer.marketingConsent']).toBeUndefined();
  });

  it('respects lifecycle stages', () => {
    registerProfile(baseProfile());
    const errors = validateForContext({
      productCode: 'TEST',
      stage: { kind: 'stage', id: 'bind' },
      actor: 'server',
      data: { proposer: { firstName: 'U', lastName: 'A' } },
    });
    // firstName too short, email missing, dob missing, lastName too short
    expect(errors['proposer.firstName']).toMatch(/at least 2/i);
    expect(errors['proposer.email']).toMatch(/email/i);
  });
});

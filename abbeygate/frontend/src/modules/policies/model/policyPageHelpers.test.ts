import { describe, expect, it } from 'vitest';
import {
  mapServerValidationDetails,
  validatePolicyHolderAllFields,
  resolveEndorsementDraftRiskTransactionId,
  isEndorsementDraftVersionRow,
} from './policyPageHelpers';

describe('validatePolicyHolderAllFields', () => {
  it('allows BO draft save with minimal contact identity (canonical proposer shape)', () => {
    const errors = validatePolicyHolderAllFields({
      quoteData: {
        proposer: {
          firstName: 'John',
          lastName: 'Doe',
          email: 'john@example.com',
          phone: '+35799123456',
        },
      },
    });

    expect(errors).toEqual({});
  });

  it('requires canonical proposer.firstName at draft stage', () => {
    const errors = validatePolicyHolderAllFields({
      quoteData: {
        proposer: {
          lastName: 'Doe',
          email: 'john@example.com',
          phone: '+35799123456',
        },
      },
    });

    expect(errors['quoteData.proposer.firstName']).toBe('First Name is required');
    expect(errors['quoteData.proposer.lastName']).toBeUndefined();
    expect(errors['quoteData.proposer.email']).toBeUndefined();
    expect(errors['quoteData.proposer.phone']).toBeUndefined();
  });

  it('Phase 6k: rejects flat root-level policyholder fields (no aliasing)', () => {
    // Flat keys at the root of quoteData are no longer recognized as
    // policyholder identity. The canonical proposer.* paths must be used.
    const errors = validatePolicyHolderAllFields({
      quoteData: {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
        telephone: '+35799123456',
      },
    });

    expect(errors['quoteData.proposer.firstName']).toBe('First Name is required');
    expect(errors['quoteData.proposer.lastName']).toBe('Last Name is required');
    expect(errors['quoteData.proposer.email']).toBe('Email is required');
    expect(errors['quoteData.proposer.phone']).toBe('Phone number is required');
  });

  it('still validates optional fields when they are provided', () => {
    const errors = validatePolicyHolderAllFields({
      quoteData: {
        proposer: {
          firstName: 'John',
          lastName: 'Doe',
          email: 'john@example.com',
          phone: '+35799123456',
          dateOfBirth: '2999-01-01',
        },
      },
    });

    expect(errors['quoteData.proposer.dateOfBirth']).toBe('Date of Birth cannot be in the future');
  });

  it('does not require province/postcode in draft when country is present', () => {
    const errors = validatePolicyHolderAllFields({
      quoteData: {
        proposer: {
          firstName: 'John',
          lastName: 'Doe',
          email: 'john@example.com',
          phone: '+35799123456',
          address: {
            country: 'Cyprus',
            province: '',
            postcode: '',
          },
        },
      },
    });

    expect(errors['quoteData.proposer.address.province']).toBeUndefined();
    expect(errors['quoteData.proposer.address.postcode']).toBeUndefined();
  });
});

describe('resolveEndorsementDraftRiskTransactionId', () => {
  it('uses the versions list while the snapshot is still loading', () => {
    expect(
      resolveEndorsementDraftRiskTransactionId({
        viewingRiskTransactionId: 'rt-draft-1',
        viewingRiskTransactionSnapshot: null,
        policyVersions: [
          { riskTransactionId: 'rt-bound', transactionType: 'INCEPTION', status: 'BOUND' },
          { riskTransactionId: 'rt-draft-1', transactionType: 'ENDORSEMENT', status: 'DRAFT' },
        ],
      }),
    ).toBe('rt-draft-1');
  });

  it('prefers a hydrated snapshot when ids match', () => {
    expect(
      resolveEndorsementDraftRiskTransactionId({
        viewingRiskTransactionId: 'rt-draft-1',
        viewingRiskTransactionSnapshot: {
          riskTransactionId: 'rt-draft-1',
          transactionType: 'ENDORSEMENT',
          status: 'DRAFT',
        },
        policyVersions: [],
      }),
    ).toBe('rt-draft-1');
  });

  it('returns null when the viewing id is not an endorsement draft', () => {
    expect(
      resolveEndorsementDraftRiskTransactionId({
        viewingRiskTransactionId: 'rt-bound',
        viewingRiskTransactionSnapshot: {
          riskTransactionId: 'rt-bound',
          transactionType: 'INCEPTION',
          status: 'BOUND',
        },
        policyVersions: [],
      }),
    ).toBeNull();
  });
});

describe('isEndorsementDraftVersionRow', () => {
  it('detects draft endorsement rows', () => {
    expect(isEndorsementDraftVersionRow({ transactionType: 'ENDORSEMENT', status: 'DRAFT' })).toBe(true);
    expect(isEndorsementDraftVersionRow({ transactionType: 'ENDORSEMENT', status: 'BOUND' })).toBe(false);
  });
});

describe('mapServerValidationDetails', () => {
  it('normalizes raw schema invalid_type errors to UX-safe text', () => {
    const mapped = mapServerValidationDetails({
      fieldErrors: {
        licenseIssuedIn: ['Invalid input: expected string, received undefined'],
      },
    });

    expect(mapped['quoteData.licenseIssuedIn']).toBe('Please select an option.');
  });
});

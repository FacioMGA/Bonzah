import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ValidationRegistry, validateForContext } from '@facio/validation/frontend';
import {
  OPEN_MARKET_LINE_OF_BUSINESS_OPTIONS,
  OPEN_MARKET_VALIDATED_LINE_OF_BUSINESS_OPTIONS,
} from '../manifest.js';
import { openMarketValidationProfile } from '../profile.js';

const validPublicRequest = {
  proposer: {
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    phone: '+35799123456',
    address: { line1: '1 Market Street', city: 'Limassol', country: 'Cyprus' },
  },
  risk: {
    lineOfBusiness: 'health',
    description: 'Immigration medical cover enquiry for a family relocating to Cyprus.',
  },
};

describe('Open Market public intake profile', () => {
  beforeEach(() => {
    ValidationRegistry.register(openMarketValidationProfile);
  });

  afterEach(() => {
    ValidationRegistry._resetForTests();
  });

  it('offers Health as a manual Open Market enquiry category', () => {
    expect(OPEN_MARKET_LINE_OF_BUSINESS_OPTIONS).toContainEqual({ value: 'health', label: 'Health' });
  });

  it('requires the Portugal Immigration referral details before submission', () => {
    expect(OPEN_MARKET_LINE_OF_BUSINESS_OPTIONS).not.toContainEqual({
      value: 'immigration',
      label: 'Portugal immigration medical referral',
    });
    expect(OPEN_MARKET_VALIDATED_LINE_OF_BUSINESS_OPTIONS).toContainEqual({
      value: 'immigration',
      label: 'Portugal immigration medical referral',
    });

    const errors = validateForContext({
      productCode: 'OPEN_MARKET',
      stage: { kind: 'stage', id: 'quote' },
      actor: 'customer',
      data: {
        proposer: validPublicRequest.proposer,
        risk: { lineOfBusiness: 'immigration', description: 'Residence permit required.' },
      },
    });

    expect(errors['risk.immigration.applicationType']).toBeDefined();
    expect(errors['risk.immigration.countryOfResidence']).toBeDefined();
    expect(errors['risk.immigration.residencyStatus']).toBeDefined();
    expect(errors['risk.immigration.applicantDetails']).toBeDefined();
    expect(errors['risk.targetInceptionDate']).toBeDefined();
  });

  it('accepts a complete customer request at the quote submission stage without staff proposal fields', () => {
    const errors = validateForContext({
      productCode: 'OPEN_MARKET',
      stage: { kind: 'stage', id: 'quote' },
      actor: 'customer',
      data: validPublicRequest,
    });

    expect(errors).toEqual({});
  });

  it('requires the customer-supplied referral details before the referral can be submitted', () => {
    const errors = validateForContext({
      productCode: 'OPEN_MARKET',
      stage: { kind: 'stage', id: 'quote' },
      actor: 'customer',
      data: { proposer: validPublicRequest.proposer, risk: { lineOfBusiness: 'health' } },
    });

    expect(errors['risk.description']).toBeDefined();
  });

  it('keeps manual market, premium and terms fields out of the public review step', () => {
    const review = openMarketValidationProfile.steps.find((step) => step.id === 'review');
    expect(review?.fields).toEqual([]);
    expect(review?.fields).not.toContain('proposal.marketName');
    expect(review?.fields).not.toContain('proposal.coverageRows');
    expect(review?.fields).not.toContain('declarations.operatorReviewed');
  });
});

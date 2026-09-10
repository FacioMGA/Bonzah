import { describe, expect, it } from 'vitest';
import '@/src/products';
import { validateQuoteData } from './validateQuoteData';

describe('validateQuoteData', () => {
  it('returns draft required fields as warnings on save (canonical proposer.* paths)', () => {
    const result = validateQuoteData({
      data: {},
      productType: 'MOTOR',
      actor: 'underwriter',
      stage: 'draft',
      mode: 'save',
    });
    expect(result.fieldErrors['proposer.firstName']?.severity).toBe('warning');
    expect(result.fieldErrors['proposer.lastName']?.severity).toBe('warning');
    expect(result.fieldErrors['proposer.phone']?.severity).toBe('warning');
    expect(result.fieldErrors['proposer.email']?.severity).toBe('warning');
    // Phase 6k: legacy flat policyholder field-error keys must NEVER be emitted.
    expect(result.fieldErrors.firstName).toBeUndefined();
    expect(result.fieldErrors.lastName).toBeUndefined();
    expect(result.fieldErrors.telephone).toBeUndefined();
    expect(result.fieldErrors.email).toBeUndefined();
  });

  it('uses canonical requiredness for a focused required field on blur', () => {
    const result = validateQuoteData({
      data: {},
      productType: 'MOTOR',
      actor: 'underwriter',
      stage: 'draft',
      mode: 'blur',
      focusField: 'licenseIssuedIn',
    });
    expect(result.fieldErrors.licenseIssuedIn?.message).toBe('License Issued In is required');
    expect(result.fieldErrors.licenseIssuedIn?.severity).toBe('error');
  });

  it('accepts numeric motor select values emitted as strings by BO controls', () => {
    const result = validateQuoteData({
      data: {
        proposer: { dateOfBirth: '1980-01-01' },
        licenseYears: '11',
        hasAdditionalDrivers: true,
        youngestDriverAge: '27',
      },
      productType: 'MOTOR',
      actor: 'underwriter',
      stage: 'quote',
      mode: 'blur',
      focusField: 'licenseYears',
    });

    expect(result.fieldErrors.licenseYears).toBeUndefined();

    const youngestResult = validateQuoteData({
      data: {
        proposer: { dateOfBirth: '1980-01-01' },
        licenseYears: '11',
        hasAdditionalDrivers: true,
        youngestDriverAge: '27',
      },
      productType: 'MOTOR',
      actor: 'underwriter',
      stage: 'quote',
      mode: 'blur',
      focusField: 'youngestDriverAge',
    });

    expect(youngestResult.fieldErrors.youngestDriverAge).toBeUndefined();
  });

  it('validates non-motor requiredness from the registered product manifest', () => {
    const result = validateQuoteData({
      data: {
        proposer: { firstName: 'Ava' },
      },
      productType: 'TRAVEL',
      actor: 'underwriter',
      stage: 'draft',
      mode: 'save',
    });

    expect(result.fieldErrors['trip.planType']?.severity).toBe('warning');
    expect(result.fieldErrors['quote.selectedPlan']?.severity).toBe('warning');
  });

  it('does not apply frontend-only motor field rules to non-motor products', () => {
    const result = validateQuoteData({
      data: {
        renewalDate: '0001-01-01',
        vin: '12',
      },
      productType: 'TRAVEL',
      actor: 'underwriter',
      stage: 'quote',
      mode: 'save',
    });

    expect(result.fieldErrors.renewalDate).toBeUndefined();
    expect(result.fieldErrors.vin).toBeUndefined();
  });
});


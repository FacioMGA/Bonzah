import { describe, expect, it } from 'vitest';
import { questionnaireToPolicy, questionnaireToRating } from './questionnaireProjection';

describe('motor questionnaire projection', () => {
  it('keeps controlling rating answers while omitting inactive branch details', () => {
    const { quoteData } = questionnaireToRating({
      hasClaims: false,
      claimsDetails: '',
      claimsCountLast5Years: '',
      claimsTotalCostLast5Years: '',
      maxFaultClaimCostLast5Years: '',
      hasConvictions: false,
      convictionsDetails: '',
      hasMajorConvictionLast5Years: null,
      convictionClass: '',
      majorConvictionWithinYears: '',
      hasAdditionalDrivers: false,
      youngestDriverAge: '',
      otherDriversClaims: false,
      otherDriversClaimsDetails: '',
      otherDriversConvictions: false,
      otherDriversConvictionsDetails: '',
      additionalDrivers: [],
    });

    expect(quoteData.hasClaims).toBe(false);
    expect(quoteData.hasConvictions).toBe(false);
    expect(quoteData.hasAdditionalDrivers).toBe(false);
    expect(quoteData.claimsCountLast5Years).toBeUndefined();
    expect(quoteData.majorConvictionWithinYears).toBeUndefined();
    expect(quoteData.youngestDriverAge).toBeUndefined();
  });

  it('omits inactive branch details from persisted policy projection', () => {
    const { quoteData } = questionnaireToPolicy({
      hasClaims: false,
      claimsDetails: 'old claim notes',
      claimsCountLast5Years: 2,
      claimsTotalCostLast5Years: 12000,
      maxFaultClaimCostLast5Years: 7000,
      hasConvictions: false,
      convictionsDetails: 'old conviction notes',
      hasMajorConvictionLast5Years: true,
      convictionClass: 'major',
      majorConvictionWithinYears: 3,
      hasAdditionalDrivers: false,
      youngestDriverAge: 22,
      additionalDrivers: [{ firstName: 'Old' }],
      parking: 'Drive',
      garageTotalValue: '50000',
    });

    expect(quoteData.hasClaims).toBe(false);
    expect(quoteData.hasConvictions).toBe(false);
    expect(quoteData.hasAdditionalDrivers).toBe(false);
    expect(quoteData.claimsDetails).toBeUndefined();
    expect(quoteData.convictionsDetails).toBeUndefined();
    expect(quoteData.additionalDrivers).toEqual([]);
    expect(quoteData.parking).toBe('Drive');
    expect(quoteData.garageTotalValue).toBeUndefined();
  });

  it('preserves active branch details for strict backend validation', () => {
    const { quoteData } = questionnaireToRating({
      hasClaims: true,
      claimsCountLast5Years: '',
      claimsTotalCostLast5Years: '',
      maxFaultClaimCostLast5Years: '',
      hasConvictions: true,
      hasMajorConvictionLast5Years: true,
      convictionClass: 'major',
      majorConvictionWithinYears: '',
      hasAdditionalDrivers: true,
      youngestDriverAge: '',
    });

    expect(quoteData.claimsCountLast5Years).toBe('');
    expect(quoteData.claimsTotalCostLast5Years).toBe('');
    expect(quoteData.maxFaultClaimCostLast5Years).toBe('');
    expect(quoteData.majorConvictionWithinYears).toBe('');
    expect(quoteData.youngestDriverAge).toBe('');
  });

  it('omits garage total value even when parking is Garage', () => {
    const populated = questionnaireToRating({
      parking: 'Garage',
      garageTotalValue: '50,000',
    }).quoteData;
    expect(populated.garageTotalValue).toBeUndefined();

    const blank = questionnaireToRating({
      parking: 'Garage',
      garageTotalValue: '',
    }).quoteData;
    expect(blank.garageTotalValue).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import { applyMotorReferralOverlays } from '../referralOverlays.js';
import { fixtureProgrammeDefinition, fixtureRatingModelTables } from '../../../programDefinitionFixtures.js';

const motorFixtureTables = fixtureRatingModelTables('MOTOR');
if (!motorFixtureTables) throw new Error('Motor programme-definition fixture requires a rating model.');

const motorFixtureContext = {
  programDefinition: fixtureProgrammeDefinition('MOTOR'),
  ratingModel: {
    id: 'motor-referral-overlay-test-model',
    programId: 'fixture-program',
    version: 1,
    binderProductAuthorityId: 'fixture-authority',
    tables: motorFixtureTables,
  },
};

describe('Motor referral overlays', () => {
  it('keeps a BO excess override in referral when the generic rating spine rerates it', () => {
    const result = applyMotorReferralOverlays({
      quoteData: {
        __meta: { origin: 'bo' },
        proposer: { dateOfBirth: '1988-01-01' },
        vehicleValue: 30_000,
        make: 'Toyota',
        model: 'Corolla',
        year: 2020,
        vehicleType: 'Car',
        coverRequired: 'Comprehensive',
        requiredExcess: '€500',
        renewalDate: '2026-09-10',
        engineSize: 1800,
        licenseYears: 8,
        licenseType: 'Full',
        licenseIssuedIn: 'Cyprus',
        countryOfRegistration: 'Cyprus',
        vehicleUse: 'SD&P',
        hasClaims: false,
        hasConvictions: false,
        hasAdditionalDrivers: false,
      },
      context: { ...motorFixtureContext, overrideExcess: 1 },
      result: {
        quoteResponse: { status: 'quoted', warnings: [] },
      },
    });

    expect(result.quoteResponse.status).toBe('referral');
    expect(result.underwritingAnalysis).toMatchObject({ outcome: 'referral' });
    expect(result.underwritingAnalysis?.triggers).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'YELLOW.BO_OVERRIDE_EXCESS_BELOW_MIN' }),
    ]));
  });

  it('keeps the internal vehicle referral reason while returning Peter’s generic customer message', () => {
    const result = applyMotorReferralOverlays({
      quoteData: {
        proposer: { dateOfBirth: '1988-01-01' },
        fuelType: 'Electric',
        electricPowerKw: 160,
        vehicleValue: 30_000,
        make: 'Toyota',
        model: 'Corolla',
        year: 2020,
        vehicleType: 'Car',
        coverRequired: 'Comprehensive',
        requiredExcess: '€500',
        renewalDate: '2026-09-10',
        engineSize: 1800,
        licenseYears: 8,
        licenseType: 'Full',
        licenseIssuedIn: 'Cyprus',
        countryOfRegistration: 'Cyprus',
        vehicleUse: 'SD&P',
        hasClaims: false,
        hasConvictions: false,
        hasAdditionalDrivers: false,
      },
      context: motorFixtureContext,
      result: { quoteResponse: { status: 'quoted', warnings: [] } },
    });

    expect(result.quoteResponse.referralMessage).toBe('Your quotation requires referral to our underwriters.');
    expect(result.underwritingAnalysis?.triggers).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'YELLOW.EV_REFERRAL', message: 'Electric vehicle requires referral to our underwriters.' }),
    ]));
  });
});

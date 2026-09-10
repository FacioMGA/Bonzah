import { describe, expect, it } from 'vitest';
import { runWithOperatingTenant } from '../../platform/tenant/tenantAls.js';
import { getTenantFixtures } from '../testHelpers/tenantFixtures.js';
import { calculateHomePremium } from '../home/pricing/homeCalculator.js';
import { loadHomeRates } from '../home/pricing/data/loader.js';
import { calculateHealthPremium } from '../health/pricing/healthCalculator.js';
import { loadBritHealthRates } from '../health/pricing/data/loader.js';
import { calculateTravelPremium } from '../travel/pricing/travelCalculator.js';
import { loadBritTravelRates } from '../travel/pricing/data/loader.js';
import { loadTravelFeeBands } from '../travel/pricing/data/travel-fee-bands.loader.js';
import { calculateAutoInsurancePremium } from '../motor/pricing/autoInsuranceCalculator.js';
import { loadAbbeygateAutoCyprus2022Matrix } from '../motor/pricing/data/loader.js';
import { fixtureRatingModelTables } from '../programDefinitionFixtures.js';
import { parseMotorProgramRatingModel, MOTOR_RATING_PIPELINE } from '../motor/pricing/programRatingModel.js';
import { registerAllProducts } from '../registerProducts.js';

const CY_TENANT = getTenantFixtures().find((tenant) => tenant.countryCode === 'CY')!;

registerAllProducts();

function inCy<T>(fn: () => T): T {
  return runWithOperatingTenant(CY_TENANT, fn);
}

describe('program rating model authority', () => {
  it('builds a complete persisted Motor fixture, including classic rates', () => {
    const tables = fixtureRatingModelTables('MOTOR');
    expect(tables).toHaveProperty('classicRates');
    expect(() => parseMotorProgramRatingModel({
      id: 'fixture-motor-rating-model',
      programId: 'fixture-motor-program',
      version: 1,
      binderProductAuthorityId: 'fixture-motor-authority',
      stages: MOTOR_RATING_PIPELINE.map((operator) => ({ id: operator, operator })),
      tables,
    })).not.toThrow();
  });

  it('uses a Home programme model rule rather than an inline alarm discount', () => {
    const baselineTables = loadHomeRates();
    const amendedTables = structuredClone(baselineTables);
    amendedTables.pricingRules.alarmDiscount = 0;
    const quote = {
      propertyUse: 'Permanent' as const,
      propertyType: 'Villa',
      buildingsSumInsured: 80_000,
      contentsSumInsured: 15_000,
      alarm: true,
      yearBuilt: 'Prior to 1980' as const,
      previousClaims: 'None' as const,
      noClaimsDiscount: '0 Years' as const,
      increasedExcess: 'STD 150 XS' as const,
      proposerOver45: false,
      europAssistance: false,
    };

    const baseline = inCy(() => calculateHomePremium(quote, baselineTables));
    const amended = inCy(() => calculateHomePremium(quote, amendedTables));
    expect(amended.breakdown.grossPremium).toBeGreaterThan(baseline.breakdown.grossPremium);
  });

  it('uses the published Health age-band premium', () => {
    const baselineTables = loadBritHealthRates();
    const amendedTables = structuredClone(baselineTables);
    const band = amendedTables.ageBands.find((row) => row.band === '0-62');
    if (!band) throw new Error('Health fixture is missing the 0-62 age band.');
    band.premiumGross += 25;
    const quote = {
      insureds: { persons: [{ dob: '1990-01-01' }] },
      period: { inceptionDate: '2026-01-02' },
    };

    const baseline = inCy(() => calculateHealthPremium(quote, baselineTables));
    const amended = inCy(() => calculateHealthPremium(quote, amendedTables));
    expect(amended.breakdown.grossPremium).toBe(baseline.breakdown.grossPremium + 25);
  });

  it('uses Travel programme-model rate cells and fee bands', () => {
    const baselineTables = { rateCard: loadBritTravelRates(), adminFees: loadTravelFeeBands() };
    const amendedTables = structuredClone(baselineTables);
    const rateKey = 'silver|Single trip|Europe|Individual|3|18-35';
    const rate = amendedTables.rateCard.rates[rateKey];
    if (typeof rate !== 'number') throw new Error(`Travel fixture is missing numeric rate ${rateKey}.`);
    amendedTables.rateCard.rates[rateKey] = rate + 10;
    const quote = {
      eligibility: { countryOfResidence: 'Cyprus' },
      travellers: { coverType: 'single', leadTravellerDOB: '2000-01-01' },
      trip: { planType: 'single_trip', destinations: ['Spain'], startDate: '2026-01-02', endDate: '2026-01-04' },
      quote: { selectedPlan: 'silver' },
      addons: {},
    };

    const baseline = inCy(() => calculateTravelPremium(quote, baselineTables));
    const amended = inCy(() => calculateTravelPremium(quote, amendedTables));
    expect(amended.breakdown.basePremium).toBe(baseline.breakdown.basePremium + 10);
    expect(amended.breakdown.grossPremium).toBeGreaterThan(baseline.breakdown.grossPremium);
  });

  it('uses the Motor programme model matrix rather than a deployed asset', () => {
    const baselineTables = loadAbbeygateAutoCyprus2022Matrix();
    const amendedTables = structuredClone(baselineTables);
    amendedTables.baseMatrix.values[0][0] += 100;
    const quote = {
      proposer: { dateOfBirth: '1980-01-01' },
      coverRequired: 'Comprehensive',
      licenseYears: 10,
      licenseType: 'Full',
      licenseIssuedIn: 'Cyprus',
      vehicleType: 'Car',
      make: 'Test',
      model: 'Model',
      year: 2024,
      engineSize: 800,
      vehicleValue: 2_000,
      ncb: 'None',
      vehicleUse: 'SD&P',
      requiredExcess: '250',
      kmsPerYear: '10,000',
      hasClaims: false,
      hasConvictions: false,
      hasAdditionalDrivers: false,
    };

    const baseline = inCy(() => calculateAutoInsurancePremium(quote, undefined, [], baselineTables));
    const amended = inCy(() => calculateAutoInsurancePremium(quote, undefined, [], amendedTables));
    expect(amended.premium).toBeGreaterThan(baseline.premium);
  });

  it('rejects direct Motor rating without a mapped programme model', () => {
    const quote = {
      proposer: { dateOfBirth: '1980-01-01' },
      coverRequired: 'Comprehensive',
      licenseYears: 10,
      licenseType: 'Full',
      licenseIssuedIn: 'Cyprus',
      vehicleType: 'Car',
      make: 'Test',
      model: 'Model',
      year: 2024,
      engineSize: 800,
      vehicleValue: 2_000,
      ncb: 'None',
      vehicleUse: 'SD&P',
      requiredExcess: '250',
      kmsPerYear: '10,000',
      hasClaims: false,
      hasConvictions: false,
      hasAdditionalDrivers: false,
    };

    expect(() => inCy(() => calculateAutoInsurancePremium(quote))).toThrow(
      'Motor pricing requires a mapped programme rating model.',
    );
  });
});

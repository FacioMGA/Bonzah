import { describe, expect, it } from 'vitest';
import { calculateAutoInsurancePremium as calculateMotorPremium } from '../../../../products/motor/pricing/autoInsuranceCalculator.js';
import { loadAbbeygateAutoCyprus2022Matrix } from '../../../../products/motor/pricing/data/loader.js';
import { registerAllProducts } from '../../../../products/registerProducts.js';
import { runWithOperatingTenant } from '../../../../platform/tenant/tenantAls.js';
import { getTenantFixtures } from '../../../../products/testHelpers/tenantFixtures.js';

registerAllProducts();
const motorModel = loadAbbeygateAutoCyprus2022Matrix();
const cyTenant = getTenantFixtures().find((tenant) => tenant.countryCode === 'CY')!;
const calculateAutoInsurancePremium = (...[quoteData, overrideExcess, appliedEndorsements = []]: Parameters<typeof calculateMotorPremium>) =>
  runWithOperatingTenant(cyTenant, () => calculateMotorPremium(quoteData, overrideExcess, appliedEndorsements, motorModel));

const baseQuote = {
  proposer: {
    firstName: 'Bike',
    lastName: 'Rider',
    address: { line1: 'X', city: 'Nicosia', province: 'Nicosia', postcode: '1010', country: 'Cyprus' },
    phone: '+357',
    email: 'bike@example.com',
    nationality: 'Cyprus',
    occupation: 'Rider',
    whereDidYouHear: 'Web',
    marketingConsent: false,
    privacyPolicyAccepted: true,
    bestTimeToCall: 'Anytime',
    dateOfBirth: '1985-01-01',
  },
  licenseYears: 10,
  licenseType: 'Full',
  licenseIssuedIn: 'Cyprus',
  hasClaims: false,
  claimsDetails: '',
  claimsCountLast5Years: 0,
  claimsTotalCostLast5Years: 0,
  maxFaultClaimCostLast5Years: 0,
  hasConvictions: false,
  convictionsDetails: '',
  hasMajorConvictionLast5Years: false,
  convictionClass: 'minor_technical',
  majorConvictionWithinYears: 5,
  hasAdditionalDrivers: false,
  youngestDriverAge: 35,
  otherDriversClaims: false,
  otherDriversClaimsDetails: '',
  otherDriversConvictions: false,
  otherDriversConvictionsDetails: '',
  vehicleLocation: 'Cyprus',
  coverRequired: 'Comprehensive',
  renewalDate: '2026-03-01',
  vehicleType: 'Motorbike',
  motorcycleRidersNamed: true,
  make: 'Honda',
  model: 'CB500',
  cabrio: 'No',
  fuelType: 'Petrol',
  kmsPerYear: '5000',
  year: 2020,
  countryOfRegistration: 'Cyprus',
  registrationNumber: 'BIKE123',
  numberOfSeats: 2,
  modified: false,
  modificationsDetails: '',
  parking: 'Private',
  parkingOther: '',
  garageTotalValue: 0,
  engineSize: 1200,
  vehicleValue: 10000,
  ncb: '5+ Years',
  protectNCB: false,
  vehicleUse: 'SD&P',
  businessUseDetails: '',
  requiredExcess: '300',
  homeInsuranceRenewalDate: '2026-03-01',
  infoTrueAndAccurate: true,
  fairProcessingAccepted: true,
  driverPricingBasis: 'NAMED_DRIVERS',
};

describe('motorbike workbook parity branch', () => {
  it('matches workbook comp chain and disables second-pass NCD/online discount', () => {
    const calc = calculateAutoInsurancePremium(baseQuote);
    // Workbook comp for >900cc, under 45, NCB 5+, Cyprus:
    // (1167 * 1.0 * 0.35 * 1.0) + 99 = 507.45
    expect(calc.calculationDetails.premiumBreakdown.finalPremium).toBeCloseTo(507.45, 2);
    expect(calc.calculationDetails.costBreakdown.grossPremium).toBeCloseTo(507.45, 2);
    expect(calc.calculationDetails.costBreakdown.ncdAmount).toBe(0);
    expect(calc.calculationDetails.costBreakdown.onlineDiscount).toBe(0);
  });

  it('calculates TPO at workbook formula for motorbike', () => {
    const calc = calculateAutoInsurancePremium({ ...baseQuote, coverRequired: 'Third Party Liability' });
    // Workbook TPO: (1167 * 1.0 * 0.35 * 1.0 * 0.6) + 99 = 344.07
    expect(calc.calculationDetails.premiumBreakdown.tplFinal).toBeCloseTo(344.07, 2);
    expect(calc.calculationDetails.premiumBreakdown.compFinal).toBe(0);
  });

  it('applies midterm term months from __mbePolicyTermMonths to core motorbike risk', () => {
    const annual = calculateAutoInsurancePremium({ ...baseQuote, policyTermMonths: 12 });
    const midterm3 = calculateAutoInsurancePremium({ ...baseQuote, policyTermMonths: 12, __mbePolicyTermMonths: 3 });
    expect(midterm3.calculationDetails.premiumBreakdown.finalPremium).toBeCloseTo(
      annual.calculationDetails.premiumBreakdown.finalPremium * 0.6,
      2
    );
  });
});

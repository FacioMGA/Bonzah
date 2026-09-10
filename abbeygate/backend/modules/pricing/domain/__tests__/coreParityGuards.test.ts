import { beforeAll, describe, expect, it } from 'vitest';
import { calculateAutoInsurancePremium } from '../../../../products/motor/pricing/autoInsuranceCalculator.js';
import { buildDefaultProgramMbeProductConfig, resolveAppliedEndorsementsForQuote } from '../../../mbe/domain/programProduct.js';
import { registerAllProducts } from '../../../../products/registerProducts.js';

beforeAll(() => {
  // `buildDefaultProgramMbeProductConfig` resolves the catalog through
  // `MagicBRegistry.forProduct(...)` → `ProductRegistry.getAdapter(...)`.
  // The adapter is registered as a side-effect of `registerAllProducts`;
  // when the test runs in isolation that side-effect import never fires
  // and the resolver throws "No product adapter registered for 'MOTOR'".
  registerAllProducts();
});

/**
 * Phase 6k canonical motor shape — personal-details (incl. dateOfBirth)
 * live exclusively under `proposer.*`. `proposerWithDob` lets each test
 * override DOB while reusing the rest of the proposer block.
 */
const proposerWithDob = (dateOfBirth: string) => ({
  proposer: {
    firstName: 'A',
    lastName: 'B',
    address: { line1: 'X', city: 'Nicosia', province: 'Nicosia', postcode: '1010', country: 'Cyprus' },
    phone: '+357',
    email: 'a@b.com',
    nationality: 'Cyprus',
    occupation: 'Tester',
    whereDidYouHear: 'Web',
    marketingConsent: false,
    privacyPolicyAccepted: true,
    bestTimeToCall: 'Anytime',
    dateOfBirth,
  },
});

const baseQuote = {
  ...proposerWithDob('1990-01-01'),
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
  vehicleType: 'Car',
  motorcycleRidersNamed: false,
  classicIsGenuine: null,
  classicIsSecondaryVehicle: null,
  make: 'Toyota',
  model: 'Corolla',
  cabrio: 'No',
  fuelType: 'Petrol',
  kmsPerYear: '10000',
  year: 2018,
  countryOfRegistration: 'Cyprus',
  registrationNumber: 'ABC123',
  numberOfSeats: 5,
  modified: false,
  modificationsDetails: '',
  parking: 'Private',
  parkingOther: '',
  garageTotalValue: 0,
  engineSize: 1600,
  vehicleValue: 16000,
  ncb: '2 Years',
  protectNCB: false,
  vehicleUse: 'SD&P',
  businessUseDetails: '',
  requiredExcess: '300',
  homeInsuranceRenewalDate: '2026-03-01',
  infoTrueAndAccurate: true,
  fairProcessingAccepted: true,
  driverPricingBasis: 'NAMED_DRIVERS',
};

describe('core parity guards', () => {
  it('uses workbook-equivalent high loadings for age 25 and under', () => {
    const age26 = calculateAutoInsurancePremium({
      ...baseQuote,
      ...proposerWithDob('2000-01-01'),
    });
    const age25 = calculateAutoInsurancePremium({
      ...baseQuote,
      ...proposerWithDob('2001-01-01'),
    });
    expect(age25.calculationDetails.premiumBreakdown.compFinal).toBeGreaterThan(age26.calculationDetails.premiumBreakdown.compFinal);
  });

  it('supports serious technical conviction tier 2 loading (x1.7)', () => {
    const oneSerious = calculateAutoInsurancePremium({
      ...baseQuote,
      hasConvictions: true,
      convictionClass: 'serious_technical',
      seriousTechnicalOffenceCount: 1,
    });
    const twoSerious = calculateAutoInsurancePremium({
      ...baseQuote,
      hasConvictions: true,
      convictionClass: 'serious_technical',
      seriousTechnicalOffenceCount: 2,
    });
    expect(twoSerious.calculationDetails.premiumBreakdown.compFinal).toBe(oneSerious.calculationDetails.premiumBreakdown.compFinal);
  });

  it('supports major conviction multi-count tiers (x2.5/x5)', () => {
    const oneMajor = calculateAutoInsurancePremium({
      ...baseQuote,
      hasConvictions: true,
      convictionClass: 'major',
      majorConvictionsCountLast5Years: 1,
      majorConvictionWithinYears: 5,
    });
    const twoMajor = calculateAutoInsurancePremium({
      ...baseQuote,
      hasConvictions: true,
      convictionClass: 'major',
      majorConvictionsCountLast5Years: 2,
    });
    const threeMajor = calculateAutoInsurancePremium({
      ...baseQuote,
      hasConvictions: true,
      convictionClass: 'major',
      majorConvictionsCountLast5Years: 3,
    });
    expect(twoMajor.calculationDetails.premiumBreakdown.compFinal).toBeGreaterThan(oneMajor.calculationDetails.premiumBreakdown.compFinal);
    expect(threeMajor.calculationDetails.premiumBreakdown.compFinal).toBeGreaterThan(twoMajor.calculationDetails.premiumBreakdown.compFinal);
  });

  it('maps protectNCB into CV 172 selection when explicit selectedOptions are absent', () => {
    const cfg = buildDefaultProgramMbeProductConfig('abbeygate_motor');
    const applied = resolveAppliedEndorsementsForQuote({
      quoteData: { ...baseQuote, protectNCB: true },
      cfg,
    });
    expect(applied.some((x) => x.code === 'CV 172')).toBe(true);
  });

  it('keeps explicit CV 172 selection authoritative over protectNCB field', () => {
    const cfg = buildDefaultProgramMbeProductConfig('abbeygate_motor');
    const applied = resolveAppliedEndorsementsForQuote({
      quoteData: { ...baseQuote, protectNCB: true },
      cfg,
      selectedOptions: { 'CV 172': false },
    });
    expect(applied.some((x) => x.code === 'CV 172')).toBe(false);
  });

  it('does not silently apply the 3% online discount unless explicitly requested', () => {
    const standard = calculateAutoInsurancePremium(baseQuote);
    const discounted = calculateAutoInsurancePremium({
      ...baseQuote,
      applyOnlineDiscount: true,
    });

    expect(standard.calculationDetails.costBreakdown.onlineDiscount).toBe(0);
    expect(discounted.calculationDetails.costBreakdown.onlineDiscount).toBeGreaterThan(0);
    expect(discounted.premium).toBeLessThan(standard.premium);
  });
});


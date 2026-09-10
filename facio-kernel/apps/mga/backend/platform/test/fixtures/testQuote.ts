import type { QuoteData } from '../../types/autoInsurance.js';

/**
 * Canonical, stable-ish quote fixture for document generation iteration.
 *
 * Phase 6k canonical shape — personal-details live under `proposer.*`
 * (matching Travel + Home). Keep this realistic so templates can be
 * perfected against meaningful data (names, addresses, vehicle
 * details, cover type, etc).
 */
export const TEST_QUOTE_DATA: QuoteData = {
  proposer: {
    firstName: 'Test',
    lastName: 'Applicant',
    address: {
      line1: '1 Abbeygate Street',
      city: 'Limassol',
      province: 'Limassol',
      postcode: '3036',
      country: 'Cyprus',
    },
    domicileCountry: 'Cyprus',
    phone: '+35799123456',
    dateOfBirth: '1990-06-15',
    email: 'test.applicant@example.com',
    nationality: 'Cyprus',
    nif: '12345678X',
    occupation: 'Software Engineer',
    whereDidYouHear: 'Google',
    bestTimeToCall: 'Anytime',
    marketingConsent: false,
    privacyPolicyAccepted: true,
  },

  // Step 2: Driving & History
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
  convictionClass: '',
  majorConvictionWithinYears: 0,
  hasAdditionalDrivers: false,
  youngestDriverAge: 30,
  otherDriversClaims: false,
  otherDriversClaimsDetails: '',
  otherDriversConvictions: false,
  otherDriversConvictionsDetails: '',

  // Step 3: Vehicle & Cover
  vehicleLocation: 'Cyprus',
  coverRequired: 'Comprehensive',
  renewalDate: '2026-12-31',
  vehicleType: 'Car',
  motorcycleRidersNamed: true,
  classicIsGenuine: null,
  classicIsSecondaryVehicle: null,
  make: 'Toyota',
  model: 'Corolla',
  cabrio: 'No',
  fuelType: 'Petrol',
  kmsPerYear: '10000',
  year: 2020,
  countryOfRegistration: 'Cyprus',
  registrationNumber: 'KAA-123',
  vin: 'TSTVN12345678901',
  numberOfSeats: 5,
  modified: false,
  modificationsDetails: '',
  parking: 'Drive',
  parkingOther: '',
  garageTotalValue: 0,
  engineSize: 1598,
  vehicleValue: 15000,
  ncb: '5 Years',
  protectNCB: true,
  vehicleUse: 'Social, Domestic & Pleasure (SDP)',
  businessUseDetails: '',
  requiredExcess: 'Standard (€250)',
  homeInsuranceRenewalDate: '',
  infoTrueAndAccurate: true,
  fairProcessingAccepted: true,
};

import type { QuoteData } from './types';
import { REGION_CONFIG } from './config/region';

export const initialQuoteData: QuoteData = {
  proposer: {
    firstName: '',
    lastName: '',
    address: {
      line1: '',
      line2: '',
      city: '',
      province: '',
      postcode: '',
      country: REGION_CONFIG.defaultCountry,
    },
    phone: '',
    dateOfBirth: '',
    email: '',
    nationality: '',
    nif: '',
    occupation: '',
    whereDidYouHear: '',
    marketingConsent: false,
    privacyPolicyAccepted: false,
    bestTimeToCall: 'Anytime',
    domicileCountry: REGION_CONFIG.defaultCountry,
  },
  licenseYears: '',
  licenseType: '',
  licenseIssuedIn: 'United Kingdom',
  licenseForeignDeclarationAccepted: false,
  hasClaims: null,
  claimsDetails: '',
  claimsCountLast5Years: '',
  claimsTotalCostLast5Years: '',
  maxFaultClaimCostLast5Years: '',
  hasConvictions: null,
  motorConvictions: [],
  convictionsDetails: '',
  hasMajorConvictionLast5Years: null,
  convictionClass: '',
  majorConvictionWithinYears: '',
  seriousTechnicalOffenceCount: 0,
  majorConvictionsCountLast5Years: 0,
  hasAdditionalDrivers: null,
  additionalDrivers: [],
  youngestDriverAge: '',
  otherDriversClaims: false,
  otherDriversClaimsDetails: '',
  otherDriversConvictions: false,
  otherDriversConvictionsDetails: '',
  vehicleLocation: REGION_CONFIG.defaultCountry,
  coverRequired: 'Comprehensive',
  renewalDate: '',
  // ABY-53 — `Car` matches what the segmented vehicle-type switch shows
  // visually as the default (`vehicleTypeKind` falls back to `'car'`
  // when `vehicleType` is empty). Previously the form value stayed
  // `''` while the UI said "Car", so the customer hit
  // "vehicleType is required" the moment they pressed Next without
  // having ever interacted with a control they thought was already
  // filled. Pre-filling the canonical value matches the UI, keeps
  // existing validators (single source of truth) happy, and lets the
  // customer change to motorbike / van / caravan via the same switch.
  vehicleType: 'Car',
  motorcycleRidersNamed: true,
  classicIsGenuine: null,
  classicIsSecondaryVehicle: null,
  make: '',
  model: '',
  cabrio: '',
  fuelType: '',
  kmsPerYear: '',
  year: 0,
  countryOfRegistration: REGION_CONFIG.defaultCountry,
  registrationNumber: '',
  vin: '',
  numberOfSeats: 0,
  modified: null,
  modificationsDetails: '',
  parking: 'Drive',
  parkingOther: '',
  engineSize: 0,
  electricPowerKw: null,
  vehicleValue: 0,
  ncb: '',
  protectNCB: false,
  vehicleUse: '',
  requiredExcess: 'Standard (€250)',
  infoTrueAndAccurate: false,
  fairProcessingAccepted: false,
};

export const wizardSteps = ['Your Details', 'Vehicle & Cover', 'Driving & History', 'Your Quote', 'Issue Details', 'Payment'];

export const stepIdToIndex: Record<string, number> = {
  'policy-holder': 1,
  'vehicle-cover': 2,
  'driving-history': 3,
  'your-quote': 4,
  'issue-details': 5,
  payment: 6,
};

export const indexToStepId: Record<number, string> = {
  1: 'policy-holder',
  2: 'vehicle-cover',
  3: 'driving-history',
  4: 'your-quote',
  5: 'issue-details',
  6: 'payment',
};

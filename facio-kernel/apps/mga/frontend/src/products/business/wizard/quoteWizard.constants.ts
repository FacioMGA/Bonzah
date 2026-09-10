import { REGION_CONFIG } from '@/src/shared/config/region';

export const wizardSteps = [
  'Your details',
  'Business details',
  'Review',
];

export const stepIdToIndex: Record<string, number> = {
  proposer: 1,
  'business-details': 2,
  'review-submit': 3,
};

export type BusinessFormValues = Record<string, unknown>;

/**
 * Business intake initial values. Mirrors the legacy
 * `forms.abbeygate.cy/.../business` field set and the `businessManifest`
 * section structure. Factual/underwriting selectors start blank so the
 * proposer explicitly confirms each answer (same rule as Home — a Lloyd's
 * coverholder must not pre-select underwriting facts).
 */
export const initialBusinessQuoteData: BusinessFormValues = {
  proposer: {
    firstName: '',
    lastName: '',
    dateOfBirth: '',
    email: '',
    phone: '',
    nationality: '',
    idNumber: '',
    occupation: '',
    address: {
      line1: '',
      city: '',
      province: '',
      postcode: '',
      country: REGION_CONFIG.defaultCountry,
    },
    hearAboutUs: '',
    marketingConsent: false,
  },
  business: {
    typeOfBusiness: '',
    numberOfEmployees: undefined,
    yearPremisesConstructed: undefined,
    sizeOfPremisesSqm: undefined,
    coverTiming: '',
    registeredForTax: '',
    premisesStatus: '',
  },
  coverage: {
    buildings: undefined,
    stock: undefined,
    equipment: undefined,
    publicLiability: '',
    publicLiabilityLimit: undefined,
    employersLiability: '',
    employersLiabilityLimit: undefined,
    businessInterruption: '',
    businessInterruptionLimit: undefined,
    businessInterruptionIndemnityMonths: undefined,
    legalAssistance: '',
  },
  security: {
    rejasOnWindowsAndDoors: '',
    alarm: '',
    fireResponseEquipment: '',
    fireResponseEquipmentOther: '',
    mainDoor: '',
    mainDoorOther: '',
    secondDoor: '',
    secondDoorOther: '',
    windows: '',
    windowsOther: '',
    shopWindow: '',
    shopWindowOther: '',
  },
  declarations: { informationAccurate: false },
};

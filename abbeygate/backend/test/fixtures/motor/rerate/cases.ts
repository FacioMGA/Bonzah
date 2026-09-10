// Synthetic Cyprus motor re-rate cases. No real customer PII.
//
// Each case exercises a representative band of the post-ADR-0023
// rating ladder. The expected totals are pinned in the matching test
// file (scheme-alignment-staging-rerate.test.ts) and are the value
// the current engine emits for that input. See ./README.md for
// generation steps.

import type { QuoteData } from '../../../../platform/types/autoInsurance.js';

export type SchemeOptions = Record<string, boolean>;

export type RerateCase = {
  ref: string;
  band: string;
  quoteData: QuoteData;
  selectedOptions: SchemeOptions;
};

const baseProposer: QuoteData['proposer'] = {
  firstName: 'Synthetic',
  lastName: 'Proposer',
  email: 'synthetic@example.test',
  phone: '+35799000000',
  dateOfBirth: '1980-06-15',
};

function baseQuoteShape(overrides: Partial<QuoteData>): QuoteData {
  const base: QuoteData = {
    proposer: baseProposer,
    vehicleValue: 15000,
    engineSize: 1400,
    year: 2018,
    ncb: '5+ Years',
    coverRequired: 'Comprehensive',
    kmsPerYear: '10000',
    licenseYears: 15,
    licenseType: 'Full',
    licenseIssuedIn: 'Cyprus',
    vehicleUse: 'Private',
    hasConvictions: false,
    convictionsDetails: '',
    hasMajorConvictionLast5Years: null,
    convictionClass: '',
    majorConvictionWithinYears: '',
    hasClaims: false,
    claimsDetails: '',
    claimsCountLast5Years: '',
    claimsTotalCostLast5Years: '',
    maxFaultClaimCostLast5Years: '',
    hasAdditionalDrivers: false,
    youngestDriverAge: '',
    otherDriversClaims: false,
    otherDriversClaimsDetails: '',
    otherDriversConvictions: false,
    otherDriversConvictionsDetails: '',
    requiredExcess: '300',
    vehicleType: 'Car',
    make: 'Synthetic',
    model: 'Saloon',
    vehicleLocation: 'Cyprus',
    renewalDate: '',
    motorcycleRidersNamed: null,
    classicIsGenuine: null,
    classicIsSecondaryVehicle: null,
    cabrio: 'No',
    fuelType: 'Petrol',
    countryOfRegistration: 'Cyprus',
    registrationNumber: 'SYN001',
    vin: '',
    numberOfSeats: 5,
    modified: false,
    modificationsDetails: '',
    parking: 'Driveway',
    parkingOther: '',
    garageTotalValue: '',
    protectNCB: false,
    businessUseDetails: '',
    homeInsuranceRenewalDate: '',
    infoTrueAndAccurate: true,
    fairProcessingAccepted: true,
  };
  return { ...base, ...overrides };
}

export const RERATE_CASES: RerateCase[] = [
  {
    ref: 'SYN-SMALL-CAR-NO-CP',
    band: 'small-car / mid-age driver / TPL + Comprehensive without CV 172',
    quoteData: baseQuoteShape({
      vehicleValue: 8000,
      engineSize: 1200,
      year: 2017,
      registrationNumber: 'SYN001',
    }),
    selectedOptions: {
      'CV 172': false,
      'COV-ROADSIDE': true,
      'COV-ROADSIDE-VIP': false,
    },
  },
  {
    ref: 'SYN-MID-SALOON-CP',
    band: 'mid-saloon / mid-age driver / TPL + Comprehensive with CV 172',
    quoteData: baseQuoteShape({
      vehicleValue: 15000,
      engineSize: 1600,
      year: 2020,
      registrationNumber: 'SYN002',
    }),
    selectedOptions: {
      'CV 172': true,
      'COV-ROADSIDE': true,
      'COV-ROADSIDE-VIP': false,
    },
  },
  {
    ref: 'SYN-LARGER-CP',
    band: 'larger car / mid-age driver / TPL + Comprehensive with CV 172',
    quoteData: baseQuoteShape({
      vehicleValue: 22000,
      engineSize: 2000,
      year: 2021,
      registrationNumber: 'SYN003',
    }),
    selectedOptions: {
      'CV 172': true,
      'COV-ROADSIDE': true,
      'COV-ROADSIDE-VIP': false,
    },
  },
  {
    ref: 'SYN-PREMIUM-CP',
    band: 'premium car / mid-age driver / TPL + Comprehensive with CV 172',
    quoteData: baseQuoteShape({
      vehicleValue: 28000,
      engineSize: 2200,
      year: 2024,
      registrationNumber: 'SYN004',
    }),
    selectedOptions: {
      'CV 172': true,
      'COV-ROADSIDE': true,
      'COV-ROADSIDE-VIP': false,
    },
  },
  {
    ref: 'SYN-MATURE-CP',
    band: 'older mature-driver / NCB ladder top / TPL + Comprehensive with CV 172',
    quoteData: baseQuoteShape({
      proposer: { ...baseProposer, dateOfBirth: '1955-03-10' },
      vehicleValue: 12000,
      engineSize: 1500,
      year: 2019,
      registrationNumber: 'SYN005',
    }),
    selectedOptions: {
      'CV 172': true,
      'COV-ROADSIDE': true,
      'COV-ROADSIDE-VIP': false,
    },
  },
];

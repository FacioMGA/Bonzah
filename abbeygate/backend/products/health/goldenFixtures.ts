import type { ProductGoldenFixtures } from '../../modules/policy/domain/productContracts.js';

const TODAY_ISO = new Date().toISOString().slice(0, 10);
const NEXT_YEAR_ISO = (() => {
  const date = new Date();
  date.setFullYear(date.getFullYear() + 1);
  date.setDate(date.getDate() - 1);
  return date.toISOString().slice(0, 10);
})();

/**
 * Canonical minimum-valid HEALTH quote — a British national resident
 * in Cyprus, single insured aged ~35, GHS beneficiary. Drives
 * `productConformance.synthetic` tests and serves as the bootstrap
 * fixture for backend smoke and BO seed paths.
 */
export const healthGoldenFixtures: ProductGoldenFixtures = {
  minimumValid: {
    eligibility: {
      countryOfResidence: 'Cyprus',
      nationality: 'United Kingdom',
      hasOtherNationality: false,
      residenceDuration: '1_3_years',
      willRemainResident: true,
      residencyStatus: 'permanent_resident',
      legallyPermittedToReside: true,
      informationAccurate: true,
      legalAgreement: true,
    },
    insureds: {
      coverType: 'single',
      personCount: 1,
      persons: [
        {
          firstName: 'Ada',
          lastName: 'Health',
          dob: '1987-01-18',
          gender: 'female',
          idNumber: 'AB1234567',
          occupation: 'employed',
        },
      ],
    },
    period: {
      inceptionDate: TODAY_ISO,
      expiryDate: NEXT_YEAR_ISO,
    },
    ghs: {
      isBeneficiary: true,
    },
    proposer: {
      firstName: 'Ada',
      lastName: 'Health',
      dateOfBirth: '1987-01-18',
      gender: 'female',
      idType: 'passport',
      idNumber: 'AB1234567',
      occupation: 'employed',
      email: 'ada.health@example.com',
      phone: '+35799111224',
      marketingConsent: false,
      address: {
        line1: '1 Health Street',
        city: 'Nicosia',
        country: 'Cyprus',
      },
    },
    declarations: {
      medicalNotice: true,
      howToClaimReview: true,
      personalDataConsent: true,
      contractConsent: true,
      contractAgreement: true,
    },
  },
};

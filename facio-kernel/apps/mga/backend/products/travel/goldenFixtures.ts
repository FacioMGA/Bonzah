import type { ProductGoldenFixtures } from '../../modules/policy/domain/productContracts.js';

export const travelGoldenFixtures: ProductGoldenFixtures = {
  minimumValid: {
    eligibility: {
      countryOfResidence: 'Republic of Cyprus',
      // ADR-0025 objective expat-eligibility inputs. A British national
      // resident in Cyprus is the canonical pass case — `isExpat` is
      // derived server-side, never asked of the customer.
      nationality: 'United Kingdom',
      hasOtherNationality: false,
      residenceDuration: '1_3_years',
      willRemainResident: true,
      residencyStatus: 'permanent_resident',
      legallyPermittedToReside: true,
      informationAccurate: true,
      legalAgreement: true,
    },
    travellers: {
      coverType: 'single',
      leadTravellerDOB: '1987-01-18',
    },
    trip: {
      planType: 'single_trip',
      destinations: ['Germany'],
      startDate: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
      endDate: new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10),
    },
    quote: {
      selectedPlan: 'silver',
    },
    // ADR-0054 prior-claims question. No previous claim → no loading, no
    // referral; the golden fixture prices exactly as before.
    risk: {
      hasPreviousTravelClaim: false,
    },
    addons: {
      winterSports: false,
      businessCover: false,
      golfCover: false,
      terrorism: false,
      sportsEquipment: false,
      wedding: false,
      gadget: false,
    },
    proposer: {
      firstName: 'Ada',
      lastName: 'Travel',
      email: 'ada.travel@example.com',
      phone: '+35799111226',
      marketingConsent: false,
      address: {
        line1: '1 Travel Street',
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

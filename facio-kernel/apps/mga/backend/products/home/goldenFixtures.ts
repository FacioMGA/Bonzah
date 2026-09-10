import type { ProductGoldenFixtures } from '../../modules/policy/domain/productContracts.js';

export const homeGoldenFixtures: ProductGoldenFixtures = {
  minimumValid: {
    proposer: {
      firstName: 'Ada',
      lastName: 'Home',
      email: 'ada.home@example.com',
      phone: '+35799111225',
      dateOfBirth: '1980-01-01',
      // UK-national expat — operating-territory nationals (CY/PT/GR/ES/IT) go to
      // the referral lane and would make this fixture non-quotable online.
      nationality: 'United Kingdom',
      domicileCountry: 'Cyprus',
      address: {
        line1: '1 Home Street',
        city: 'Nicosia',
        country: 'Cyprus',
        postcode: '1000',
      },
    },
    property: {
      address: { line1: '1 Home Street', city: 'Nicosia', country: 'Cyprus', postcode: '1000' },
      sameAsProposer: true,
      propertyType: 'Villa',
      bedrooms: 3,
      floorAreaSqm: 140,
      landAreaSqm: 200,
      urbanArea: true,
      permanentHome: true,
      woodenConstruction: false,
      nonCombustibleMaterial: true,
      alarm: 'Yes',
      yearBuilt: '1990 or Later',
    },
    risk: {
      previousClaims: 'None',
      noClaimsDiscount: '0 Years',
      increasedExcess: 'STD 150 XS',
      proposerOver45: false,
    },
    usage: {
      permanentHome: true,
      businessUse: false,
      rentedOut: false,
    },
    security: {
      doorsFiveLeverLocks: true,
      windowsSecured: true,
      additionalSecurity: false,
    },
    coverage: {
      buildings: 100000,
      contents: 25000,
      accidentalDamageBuildings: false,
      accidentalDamageContents: false,
      allRiskJewellery: 0,
      allRiskOther: 0,
      solarPanelCover: 0,
    },
    eligibility: {
      confirmation: true,
    },
    policy: {
      startDate: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
    },
  },
};

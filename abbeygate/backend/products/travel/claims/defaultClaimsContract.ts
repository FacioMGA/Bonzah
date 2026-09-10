import type { ClaimsContract } from '../../../modules/claims/domain/claimsContract.js';

export const travelDefaultClaimsContract: ClaimsContract = {
  version: 1,
  productType: 'TRAVEL',
  fnol: {
    incidentTypes: [
      { id: 'medical', label: 'Medical emergency', thirdPartyStep: false },
      { id: 'cancellation', label: 'Trip cancellation', thirdPartyStep: false },
      { id: 'delay', label: 'Travel delay', thirdPartyStep: false },
      { id: 'lost_baggage', label: 'Lost or delayed baggage', thirdPartyStep: true },
      { id: 'personal_liability', label: 'Personal liability', thirdPartyStep: true },
      { id: 'other', label: 'Other', thirdPartyStep: false },
    ],
    thirdPartyKinds: [
      { id: 'airline', label: 'Airline or carrier' },
      { id: 'hotel', label: 'Hotel or accommodation' },
      { id: 'medical_provider', label: 'Medical provider' },
      { id: 'other', label: 'Other' },
    ],
    rules: {
      minDescriptionLength: 10,
      allowedCountries: [],
      requiresThirdPartyFor: ['lost_baggage', 'personal_liability'],
      requiresPoliceFor: ['lost_baggage'],
    },
  },
  fullClaimForm: {
    fields: [],
    source: 'metadata',
  },
};

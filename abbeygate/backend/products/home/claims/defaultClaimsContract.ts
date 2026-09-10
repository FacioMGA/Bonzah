import type { ClaimsContract } from '../../../modules/claims/domain/claimsContract.js';

export const homeDefaultClaimsContract: ClaimsContract = {
  version: 1,
  productType: 'HOME',
  fnol: {
    incidentTypes: [
      { id: 'fire', label: 'Fire', thirdPartyStep: false },
      { id: 'storm', label: 'Storm or weather', thirdPartyStep: false },
      { id: 'escape_of_water', label: 'Escape of water', thirdPartyStep: false },
      { id: 'theft', label: 'Theft', thirdPartyStep: true },
      { id: 'liability', label: 'Liability incident', thirdPartyStep: true },
      { id: 'other', label: 'Other', thirdPartyStep: false },
    ],
    thirdPartyKinds: [
      { id: 'neighbour', label: 'Neighbour' },
      { id: 'contractor', label: 'Contractor' },
      { id: 'visitor', label: 'Visitor' },
      { id: 'other', label: 'Other' },
    ],
    rules: {
      minDescriptionLength: 10,
      allowedCountries: [],
      requiresThirdPartyFor: ['liability', 'theft'],
      requiresPoliceFor: ['theft'],
    },
  },
  fullClaimForm: {
    fields: [],
    source: 'metadata',
  },
};

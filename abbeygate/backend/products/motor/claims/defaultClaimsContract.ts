import type { ClaimsContract } from '../../../modules/claims/domain/claimsContract.js';

export const motorDefaultClaimsContract: ClaimsContract = {
  version: 1,
  productType: 'MOTOR',
  fnol: {
    incidentTypes: [
      { id: 'collision', label: 'Collision', thirdPartyStep: true },
      { id: 'theft', label: 'Theft', thirdPartyStep: false },
      { id: 'damage_parked', label: 'Damage while parked', thirdPartyStep: false },
      { id: 'vandalism', label: 'Vandalism', thirdPartyStep: false },
      { id: 'weather', label: 'Weather', thirdPartyStep: false },
      { id: 'windscreen', label: 'Windscreen', thirdPartyStep: false },
      { id: 'other', label: 'Other', thirdPartyStep: false },
    ],
    thirdPartyKinds: [
      { id: 'another_car', label: 'Another car' },
      { id: 'pedestrian', label: 'Pedestrian' },
      { id: 'property', label: 'Property' },
      { id: 'other', label: 'Other' },
    ],
    rules: {
      minDescriptionLength: 10,
      allowedCountries: ['Cyprus', 'Spain', 'Portugal', 'Greece', 'UK', 'Channel Islands', 'Gibraltar'],
      requiresThirdPartyFor: ['collision'],
      requiresPoliceFor: ['theft', 'hit_and_run'],
    },
  },
  fullClaimForm: {
    fields: [],
    source: 'external_spec',
  },
};

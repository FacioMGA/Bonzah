import type { ClaimsContract } from '../../../modules/claims/domain/claimsContract.js';

export const rentalDefaultClaimsContract: ClaimsContract = {
  version: 1,
  productType: 'RENTAL',
  fnol: {
    incidentTypes: [], thirdPartyKinds: [],
    rules: { minDescriptionLength: 10, allowedCountries: ['US'], requiresThirdPartyFor: [], requiresPoliceFor: [] },
  },
  fullClaimForm: { fields: [], source: 'metadata' },
};

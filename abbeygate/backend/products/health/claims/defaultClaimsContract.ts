import type { ClaimsContract } from '../../../modules/claims/domain/claimsContract.js';

export const healthDefaultClaimsContract: ClaimsContract = {
  version: 1,
  productType: 'HEALTH',
  fnol: {
    incidentTypes: [
      { id: 'inpatient', label: 'Inpatient / Hospital admission', thirdPartyStep: true },
      { id: 'outpatient', label: 'Outpatient treatment', thirdPartyStep: true },
      { id: 'childbirth', label: 'Childbirth', thirdPartyStep: true },
      { id: 'accident', label: 'Accident', thirdPartyStep: true },
      { id: 'death_repatriation', label: 'Death / Repatriation of remains', thirdPartyStep: true },
      { id: 'other', label: 'Other', thirdPartyStep: false },
    ],
    thirdPartyKinds: [
      { id: 'hospital', label: 'Hospital' },
      { id: 'doctor', label: 'Doctor / Clinic' },
      { id: 'pharmacy', label: 'Pharmacy' },
      { id: 'other', label: 'Other' },
    ],
    rules: {
      minDescriptionLength: 10,
      allowedCountries: ['Cyprus', 'Republic of Cyprus'],
      requiresThirdPartyFor: ['inpatient', 'outpatient', 'childbirth', 'accident', 'death_repatriation'],
      requiresPoliceFor: [],
    },
  },
  fullClaimForm: {
    fields: [],
    source: 'metadata',
  },
};

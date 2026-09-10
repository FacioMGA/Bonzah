import type { ValidationProfile } from '@facio/validation';
import type { RefinementCtx } from 'zod';
import { OPEN_MARKET_LINE_OF_BUSINESS_OPTIONS, OPEN_MARKET_PROPOSAL_STATUS_OPTIONS } from './manifest.js';

function oneOf(options: Array<{ value: string }>): string {
  return `oneOf:${options.map((option) => option.value).join('|')}`;
}

function requireCoverageRows(data: Record<string, unknown>, ctx: RefinementCtx): void {
  const proposal = data.proposal && typeof data.proposal === 'object' && !Array.isArray(data.proposal)
    ? data.proposal as Record<string, unknown>
    : {};
  const rows = Array.isArray(proposal.coverageRows) ? proposal.coverageRows : [];
  if (rows.length > 0) return;
  ctx.addIssue({
    code: 'custom',
    path: ['proposal.coverageRows'],
    message: 'Add at least one manual coverage row before sending a proposal',
  });
}

export const openMarketValidationProfile: ValidationProfile = {
  productCode: 'OPEN_MARKET',
  fields: {
    'proposer.firstName': { path: 'proposer.firstName', rule: 'name', required: true, label: 'First name' },
    'proposer.lastName': { path: 'proposer.lastName', rule: 'name', required: true, label: 'Last name' },
    'proposer.dateOfBirth': { path: 'proposer.dateOfBirth', rule: 'isoDate', label: 'Date of birth' },
    'proposer.email': { path: 'proposer.email', rule: 'email', required: true, label: 'Email' },
    'proposer.phone': { path: 'proposer.phone', rule: 'phoneE164', required: true, label: 'Phone' },
    'proposer.nationality': { path: 'proposer.nationality', rule: 'nonEmptyString', label: 'Nationality' },
    'proposer.nif': { path: 'proposer.nif', rule: 'nonEmptyString', label: 'NIF / Tax ID' },
    'proposer.occupation': { path: 'proposer.occupation', rule: 'nonEmptyString', label: 'Occupation' },
    'proposer.address.line1': { path: 'proposer.address.line1', rule: 'nonEmptyString', required: true, label: 'Address' },
    'proposer.address.city': { path: 'proposer.address.city', rule: 'name', required: true, label: 'City' },
    'proposer.address.postcode': { path: 'proposer.address.postcode', rule: 'nonEmptyString', label: 'Post code' },
    'proposer.address.country': { path: 'proposer.address.country', rule: 'countryName', required: true, label: 'Country' },
    'proposer.marketingConsent': { path: 'proposer.marketingConsent', rule: 'bool', audience: 'customer', label: 'Marketing consent' },
    'risk.lineOfBusiness': { path: 'risk.lineOfBusiness', rule: oneOf(OPEN_MARKET_LINE_OF_BUSINESS_OPTIONS), required: true, label: 'Line of business' },
    'risk.description': { path: 'risk.description', rule: 'nonEmptyString', required: true, label: 'Risk description' },
    'risk.targetInceptionDate': { path: 'risk.targetInceptionDate', rule: 'isoDate', label: 'Target inception date' },
    'proposal.marketName': { path: 'proposal.marketName', rule: 'nonEmptyString', label: 'Market / insurer' },
    'proposal.status': { path: 'proposal.status', rule: oneOf(OPEN_MARKET_PROPOSAL_STATUS_OPTIONS), required: true, label: 'Proposal status' },
    'proposal.termsNotes': { path: 'proposal.termsNotes', rule: 'nonEmptyString', label: 'Terms notes' },
    'proposal.subjectivities': { path: 'proposal.subjectivities', rule: 'nonEmptyString', label: 'Subjectivities' },
    'declarations.operatorReviewed': { path: 'declarations.operatorReviewed', rule: 'mustAccept', required: true, label: 'Operator review declaration' },
  },
  steps: [
    {
      id: 'intake',
      fields: [
        'proposer.firstName',
        'proposer.lastName',
        'proposer.dateOfBirth',
        'proposer.email',
        'proposer.phone',
        'proposer.nationality',
        'proposer.nif',
        'proposer.occupation',
        'proposer.address.line1',
        'proposer.address.city',
        'proposer.address.postcode',
        'proposer.address.country',
        'proposer.marketingConsent',
      ],
    },
    {
      id: 'risk-details',
      fields: ['risk.lineOfBusiness', 'risk.description', 'risk.targetInceptionDate'],
    },
    {
      id: 'manual-proposal',
      fields: ['proposal.marketName', 'proposal.status', 'proposal.termsNotes', 'proposal.subjectivities'],
      refinements: [requireCoverageRows],
    },
    {
      id: 'review',
      fields: ['declarations.operatorReviewed'],
    },
  ],
  stages: {
    bind: {
      fields: ['proposer.firstName', 'proposer.lastName', 'risk.lineOfBusiness', 'risk.description', 'proposal.status', 'declarations.operatorReviewed'],
    },
    issuance: {
      fields: ['proposer.firstName', 'proposer.lastName', 'risk.lineOfBusiness', 'proposal.status', 'declarations.operatorReviewed'],
    },
  },
};

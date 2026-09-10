import type { FieldDef, ProductManifest } from '../types.js';

const proposer: FieldDef[] = [
  { path: 'proposer.companyName', label: 'Business name', type: 'text', required: true },
  { path: 'proposer.firstName', label: 'Contact first name', type: 'text', required: true },
  { path: 'proposer.lastName', label: 'Contact last name', type: 'text', required: true },
  { path: 'proposer.email', label: 'Contact email', type: 'text', required: true },
  { path: 'proposer.phone', label: 'Contact phone', type: 'text', required: true },
  { path: 'proposer.address.line1', label: 'Business address', type: 'text', required: true },
  { path: 'proposer.address.city', label: 'City', type: 'text', required: true },
  { path: 'proposer.address.country', label: 'Country', type: 'text', required: true },
];
const risk: FieldDef[] = [
  { path: 'commercial.turnover', label: 'Annual turnover', type: 'currency', required: true, min: 0 },
  { path: 'commercial.segmentId', label: 'Configured business segment', type: 'text' },
  { path: 'commercial.quantity', label: 'Insured quantity', type: 'number', min: 1 },
  { path: 'commercial.coverages', label: 'Selected coverages', type: 'list', required: true },
];
const term: FieldDef[] = [
  { path: 'policy.startDate', label: 'Inception date', type: 'date', required: true },
  { path: 'policy.endDate', label: 'Expiry date', type: 'date', required: true },
];

/** Rendering contract only. Offered covers, limits, factors and rates are owned
 * by the selected immutable programme configuration, not this shared manifest. */
export const commercialManifest: ProductManifest = {
  productType: 'COMMERCIAL', displayName: 'Commercial insurance',
  insuredObject: { kind: 'business', cardinality: 'one', label: { singular: 'Business', plural: 'Businesses' }, fields: [{ path: 'proposer.companyName', label: 'Business name', type: 'text', required: true }] },
  questionnaire: { sections: [
    { id: 'policy-holder', title: 'Policy holder', order: 1, fields: proposer },
    { id: 'commercial-risk', title: 'Business and coverage', order: 2, fields: risk },
    { id: 'acceptance', title: 'Policy period', order: 3, fields: term },
  ] },
  summaryFields: { titlePaths: ['proposer.companyName'], subtitlePaths: ['proposer.address.city', 'proposer.address.country'] },
  listColumns: { insured: { primaryPaths: ['proposer.companyName'], secondaryPaths: ['proposer.firstName', 'proposer.lastName'] }, coverage: { primaryPaths: ['commercial.segmentId'], secondaryPaths: ['policy.startDate', 'policy.endDate'], tertiaryPath: 'commercial.turnover', tertiaryFormat: 'currency' } },
  coverageCatalog: [{ code: 'COMMERCIAL_POLICY', label: 'Configured commercial policy', scope: 'POLICY', required: true, group: 'core' }],
  uwConfigSchema: { groups: [] },
  documentTypes: { COMMERCIAL_SCHEDULE_PDF: 'Commercial policy schedule' },
  riskModelHints: { requiredForUw: risk.filter((field) => field.required).map(({ path, label }) => ({ path, label })), referralFlags: [], ratingInputs: [{ path: 'commercial.turnover', label: 'Annual turnover', format: 'currency' }, { path: 'commercial.segmentId', label: 'Business segment', format: 'text' }] },
  rules: {}, theme: { iconKey: 'building', segmentLabel: 'Commercial' },
};

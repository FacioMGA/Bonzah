import type { ProductManifest, SelectOption } from '../types.js';

type JsonObject = { [k: string]: unknown };

export const OPEN_MARKET_LINE_OF_BUSINESS_OPTIONS: SelectOption[] = [
  { value: 'business', label: 'Business package' },
  { value: 'property', label: 'Property' },
  { value: 'liability', label: 'Liability' },
  { value: 'professional_indemnity', label: 'Professional indemnity' },
  { value: 'marine', label: 'Marine' },
  { value: 'health', label: 'Health' },
  { value: 'other', label: 'Other' },
];

export const OPEN_MARKET_PROPOSAL_STATUS_OPTIONS: SelectOption[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'ready_to_send', label: 'Ready to send' },
  { value: 'sent', label: 'Sent' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'declined', label: 'Declined' },
];

function asRecord(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function proposalRows(data: JsonObject): JsonObject[] {
  const proposal = asRecord(data.proposal);
  return Array.isArray(proposal.coverageRows) ? proposal.coverageRows as JsonObject[] : [];
}

function proposerDisplayName(data: JsonObject): string {
  const proposer = asRecord(data.proposer);
  const explicit = String(proposer.name || '').trim();
  if (explicit) return explicit;
  return [proposer.firstName, proposer.lastName].map((part) => String(part || '').trim()).filter(Boolean).join(' ');
}

function totalPremium(data: JsonObject): number {
  return proposalRows(data).reduce((sum, row) => {
    const amount = Number(row.premium || 0);
    return Number.isFinite(amount) ? sum + amount : sum;
  }, 0);
}

export const openMarketManifest: ProductManifest = {
  productType: 'OPEN_MARKET',
  displayName: 'Open Market',

  insuredObject: {
    kind: 'manual-market-risk',
    cardinality: 'one',
    label: { singular: 'Open market risk', plural: 'Open market risks' },
    fields: [
      { path: 'risk.lineOfBusiness', label: 'Line of business', type: 'select', required: true, options: OPEN_MARKET_LINE_OF_BUSINESS_OPTIONS },
      { path: 'risk.description', label: 'Risk description', type: 'textarea', required: true },
    ],
  },

  questionnaire: {
    sections: [
      {
        id: 'intake',
        title: 'Intake',
        order: 1,
        fields: [
          { path: 'proposer.firstName', label: 'First name', type: 'text', required: true },
          { path: 'proposer.lastName', label: 'Last name', type: 'text', required: true },
          { path: 'proposer.email', label: 'Email', type: 'text', required: true },
          { path: 'proposer.phone', label: 'Phone', type: 'text', required: true },
          { path: 'proposer.address.line1', label: 'Address', type: 'text', required: true },
          { path: 'proposer.address.city', label: 'City', type: 'text', required: true },
          { path: 'proposer.address.postcode', label: 'Post code', type: 'text' },
          { path: 'proposer.address.country', label: 'Country', type: 'text', required: true },
          { path: 'proposer.dateOfBirth', label: 'Date of birth', type: 'date' },
          { path: 'proposer.nationality', label: 'Nationality', type: 'text' },
          { path: 'proposer.nif', label: 'NIF / Tax ID', type: 'text' },
          { path: 'proposer.occupation', label: 'Occupation', type: 'text' },
          { path: 'proposer.marketingConsent', label: 'Marketing consent', type: 'boolean' },
        ],
      },
      {
        id: 'risk-details',
        title: 'Risk',
        order: 2,
        fields: [
          { path: 'risk.lineOfBusiness', label: 'Line of business', type: 'select', required: true, options: OPEN_MARKET_LINE_OF_BUSINESS_OPTIONS },
          { path: 'risk.description', label: 'Risk description', type: 'textarea', required: true },
          { path: 'risk.targetInceptionDate', label: 'Target inception date', type: 'date' },
        ],
      },
      {
        id: 'manual-proposal',
        title: 'Manual proposal',
        description: 'Staff assemble the proposal manually. No automated prices or coverage recommendations are shown.',
        order: 3,
        fields: [
          { path: 'proposal.marketName', label: 'Market / insurer', type: 'text' },
          { path: 'proposal.status', label: 'Proposal status', type: 'select', required: true, options: OPEN_MARKET_PROPOSAL_STATUS_OPTIONS },
          { path: 'proposal.coverageRows', label: 'Coverage and pricing rows', type: 'list', required: true },
          { path: 'proposal.termsNotes', label: 'Terms notes', type: 'textarea' },
          { path: 'proposal.subjectivities', label: 'Subjectivities', type: 'textarea' },
        ],
      },
      {
        id: 'review',
        title: 'Review',
        order: 4,
        fields: [
          { path: 'declarations.operatorReviewed', label: 'I have reviewed the manually assembled proposal.', type: 'boolean', required: true },
        ],
      },
    ],
  },

  summaryFields: {
    titlePaths: ['proposer.name', 'proposer.firstName', 'proposer.lastName', 'risk.lineOfBusiness'],
    subtitlePaths: ['proposal.marketName', 'proposal.status'],
    buildTitle: (data) => {
      const risk = asRecord(data.risk);
      const name = proposerDisplayName(data);
      const line = String(risk.lineOfBusiness || '').trim();
      return [name || 'Open Market', line].filter(Boolean).join(' — ');
    },
    buildSubtitle: (data) => {
      const count = proposalRows(data).length;
      const premium = totalPremium(data);
      const bits = [`${count} coverage row${count === 1 ? '' : 's'}`];
      if (premium > 0) bits.push(`€${premium.toFixed(2)}`);
      return bits.join(' · ');
    },
  },

  listColumns: {
    insured: {
      primaryPaths: [],
      buildPrimary: (data) => String(asRecord(data.proposer).name || '').trim() || 'Open Market',
      buildSecondary: (data) => String(asRecord(data.risk).lineOfBusiness || '').trim() || 'Manual risk',
    },
    coverage: {
      primaryPaths: [],
      buildPrimary: (data) => {
        const count = proposalRows(data).length;
        return `${count} manual coverage row${count === 1 ? '' : 's'}`;
      },
      buildSecondary: (data) => String(asRecord(data.proposal).status || 'draft').replace(/_/g, ' '),
    },
  },

  coverageCatalog: [
    {
      code: 'OPEN-MARKET-MANUAL-COVERAGE',
      label: 'Manual coverage row',
      description: 'Coverage, limit, excess and premium assembled by staff.',
      scope: 'POLICY',
      required: true,
      group: 'manual',
      paramsSchema: [
        { path: 'section', label: 'Section', type: 'text', required: true },
        { path: 'description', label: 'Description', type: 'textarea' },
        { path: 'limit', label: 'Limit', type: 'text' },
        { path: 'excess', label: 'Excess', type: 'text' },
        { path: 'premium', label: 'Premium', type: 'currency', required: true },
        { path: 'notes', label: 'Notes', type: 'textarea' },
      ],
    },
  ],

  uwConfigSchema: {
    groups: [
      {
        id: 'manual-authority',
        title: 'Manual authority',
        fields: [
          { path: 'requiresManagerApprovalAbove', label: 'Manager approval above premium', type: 'currency' },
        ],
      },
    ],
  },

  documentTypes: {
    OPEN_MARKET_PROPOSAL_PDF: 'Open Market Proposal',
    OPEN_MARKET_SUBMISSION_PDF: 'Open Market Submission',
  },

  riskModelHints: {
    requiredForUw: [
      { path: 'proposer.firstName', label: 'First name' },
      { path: 'proposer.lastName', label: 'Last name' },
      { path: 'risk.lineOfBusiness', label: 'Line of business' },
      { path: 'risk.description', label: 'Risk description' },
      { path: 'proposal.coverageRows', label: 'Manual coverage rows' },
    ],
    referralFlags: [],
    ratingInputs: [
      { path: 'proposal.coverageRows', label: 'Manual coverage rows', format: 'text' },
    ],
  },

  rules: { batchRules: { minUnits: 0 } },
  theme: { iconKey: 'file-pen-line', segmentLabel: 'Open Market' },
};

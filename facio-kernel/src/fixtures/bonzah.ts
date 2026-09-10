import type { Configuration, Scope } from '../contracts/configuration.js';
import type { InsuranceProductDefinitionV2 } from '../contracts/insurance-definition.js';
import { runtimePolicySchema, type ScopedRuntimePolicy } from '../contracts/insurance.js';
import { hash } from '../domain/canonical.js';

/** Development-only Bonzah intake. Values are synthetic and carry no production approval. */
export const bonzahDevelopmentScope: Scope = {
  workspaceId: 'local',
  tenantId: 'bonzah-intake',
  environment: 'development',
  operatingEntityId: 'bonzah-unassigned-entity',
};

const productSources = [
  'BZ-DEMO',
  'BZ-API',
  'bonzah-demo-reference:c4c546a41521dbeb353626c41b5f2a7d83bdce8a',
];
const source = (id: string) => [...productSources, id];
const field = (id: string, label: string, description: string, required = true) => ({
  id,
  label,
  description,
  required,
  visibleWhen: null,
  requiredWhen: null,
  sourceRefs: productSources,
});

export const bonzahDevelopmentDefinition: InsuranceProductDefinitionV2 = {
  schemaVersion: 'insurance-product-v2',
  pricingOwnership: 'kernel_deterministic',
  sourceRefs: productSources,
  territories: ['US'],
  termRules: { minimumDays: 1, maximumDays: 30, backdating: 'not_permitted' },
  riskFields: [
    {
      ...field('driver-age', 'Driver age', 'Age on the rental start date.'),
      type: 'integer',
      minimum: 18,
      maximum: 100,
    },
    {
      ...field('licence-valid', 'Valid driving licence', 'The renter holds a valid licence.'),
      type: 'boolean',
    },
    {
      ...field('rental-use', 'Rental use', 'Only personal or leisure use is eligible.'),
      type: 'choice',
      options: [
        { id: 'personal', label: 'Personal / leisure' },
        { id: 'commercial', label: 'Commercial' },
        { id: 'rideshare-delivery', label: 'Rideshare or delivery' },
      ],
    },
    {
      ...field(
        'pickup-state',
        'Pickup state',
        'State-aware sandbox factor. Other states require an approved table.',
      ),
      type: 'choice',
      options: [
        { id: 'co', label: 'Colorado' },
        { id: 'ca', label: 'California' },
        { id: 'ny', label: 'New York' },
      ],
    },
    {
      ...field('vehicle-make', 'Vehicle make', 'Rental vehicle manufacturer.'),
      type: 'choice',
      options: [
        { id: 'toyota', label: 'Toyota' },
        { id: 'tesla', label: 'Tesla' },
        { id: 'porsche', label: 'Porsche' },
        { id: 'other', label: 'Other / review' },
      ],
    },
    {
      ...field('vehicle-model', 'Vehicle model', 'Customer-entered model or trim.'),
      type: 'text',
      minLength: 1,
      maxLength: 100,
    },
    {
      ...field('vehicle-class', 'Vehicle class', 'Configured repair and exposure grouping.'),
      type: 'choice',
      options: [
        { id: 'compact', label: 'Compact' },
        { id: 'sedan', label: 'Sedan' },
        { id: 'suv', label: 'SUV' },
        { id: 'premium', label: 'Premium / specialist' },
      ],
    },
    {
      ...field('declared-value', 'Declared vehicle value', 'Replacement value in USD minor units.'),
      type: 'money',
      minimumMinor: '100000',
      maximumMinor: '50000000',
    },
    {
      ...field(
        'season',
        'Rental season',
        'Versioned seasonal factor selected from rental start date.',
      ),
      type: 'choice',
      options: [
        { id: 'winter', label: 'Winter' },
        { id: 'spring', label: 'Spring' },
        { id: 'summer', label: 'Summer' },
        { id: 'autumn', label: 'Autumn' },
      ],
    },
  ],
  riskGroups: [
    {
      id: 'named-drivers',
      label: 'Named drivers',
      description: 'Drivers listed on the rental agreement.',
      minimumRows: 1,
      maximumRows: 5,
      sourceRefs: source('BZ-PRD-09'),
      eligibilityRules: [],
      fields: [
        {
          ...field('full-name', 'Driver name', 'Synthetic or customer-supplied named driver.'),
          type: 'text',
          minLength: 2,
          maxLength: 200,
        },
        {
          ...field('licence-number', 'Licence number', 'Driver licence identifier.'),
          type: 'text',
          minLength: 2,
          maxLength: 100,
        },
        {
          ...field('licence-state', 'Licence state', 'Two-letter issuing state.'),
          type: 'text',
          minLength: 2,
          maxLength: 2,
        },
      ],
    },
  ],
  coverages: [
    {
      id: 'cdw',
      scope: { kind: 'policy' },
      limitBasis: 'per_occurrence',
      aggregateLimit: null,
      layer: { kind: 'primary' },
      name: 'Collision Damage Waiver',
      description: 'Synthetic daily CDW configuration pending approved wording and rates.',
      required: true,
      dependsOn: [],
      excludes: [],
      limit: { minimumMinor: '3500000', maximumMinor: '3500000' },
      deductible: { minimumMinor: '100000', maximumMinor: '100000' },
      rate: { method: 'flat', premiumMinor: '1800' },
      sourceRefs: source('BZ-PRD-01'),
    },
    {
      id: 'rcli',
      scope: { kind: 'policy' },
      limitBasis: 'per_occurrence',
      aggregateLimit: null,
      layer: { kind: 'primary' },
      name: "Renter's Contingent Liability",
      description: 'Synthetic state-minimum liability placeholder.',
      required: false,
      dependsOn: [],
      excludes: [],
      limit: { minimumMinor: '2500000', maximumMinor: '2500000' },
      deductible: { minimumMinor: '0', maximumMinor: '0' },
      rate: { method: 'flat', premiumMinor: '1200' },
      sourceRefs: source('BZ-PRD-02'),
    },
    {
      id: 'sli',
      scope: { kind: 'policy' },
      limitBasis: 'per_occurrence',
      aggregateLimit: null,
      layer: {
        kind: 'excess',
        underlyingCoverageId: 'rcli',
        attachment: { minimumMinor: '2500000', maximumMinor: '2500000' },
      },
      name: 'Supplemental Liability',
      description: 'Synthetic excess liability placeholder.',
      required: false,
      dependsOn: ['rcli'],
      excludes: [],
      limit: { minimumMinor: '50000000', maximumMinor: '50000000' },
      deductible: { minimumMinor: '0', maximumMinor: '0' },
      rate: { method: 'flat', premiumMinor: '1500' },
      sourceRefs: source('BZ-PRD-03'),
    },
    {
      id: 'pai-pei',
      scope: { kind: 'policy' },
      limitBasis: 'policy_term_aggregate',
      aggregateLimit: null,
      layer: { kind: 'primary' },
      name: 'Personal Accident / Effects',
      description: 'Synthetic combined benefit schedule; source conflict remains unresolved.',
      required: false,
      dependsOn: [],
      excludes: [],
      limit: { minimumMinor: '5500000', maximumMinor: '5500000' },
      deductible: { minimumMinor: '2500', maximumMinor: '2500' },
      rate: { method: 'flat', premiumMinor: '350' },
      sourceRefs: source('BZ-PRD-04'),
    },
  ],
  eligibilityRules: [
    {
      id: 'under-21',
      reason: 'Drivers under 21 are not eligible.',
      outcome: 'decline',
      sourceRefs: source('BZ-PRD-05'),
      when: {
        mode: 'all',
        conditions: [{ fieldId: 'driver-age', kind: 'comparison', operator: 'lt', value: 21 }],
      },
    },
    {
      id: 'invalid-licence',
      reason: 'A valid licence is required.',
      outcome: 'decline',
      sourceRefs: source('BZ-PRD-05'),
      when: {
        mode: 'all',
        conditions: [
          { fieldId: 'licence-valid', kind: 'comparison', operator: 'eq', value: false },
        ],
      },
    },
    {
      id: 'non-personal-use',
      reason: 'Commercial, rideshare and delivery use are outside this sandbox product.',
      outcome: 'decline',
      sourceRefs: source('BZ-PRD-05'),
      when: {
        mode: 'all',
        conditions: [
          { fieldId: 'rental-use', kind: 'comparison', operator: 'neq', value: 'personal' },
        ],
      },
    },
    {
      id: 'porsche-exclusion',
      reason: 'The demonstration vehicle exclusion refers Porsche risks for customer review.',
      outcome: 'refer',
      sourceRefs: source('BZ-PRD-08'),
      when: {
        mode: 'all',
        conditions: [
          { fieldId: 'vehicle-make', kind: 'comparison', operator: 'eq', value: 'porsche' },
        ],
      },
    },
    {
      id: 'unknown-vehicle',
      reason: 'An unclassified vehicle requires evidence and review.',
      outcome: 'refer',
      sourceRefs: source('BZ-PRD-08'),
      when: {
        mode: 'any',
        conditions: [
          { fieldId: 'vehicle-make', kind: 'comparison', operator: 'eq', value: 'other' },
          { fieldId: 'declared-value', kind: 'comparison', operator: 'gt', value: '6000000' },
        ],
      },
    },
  ],
  rating: {
    termBasis: 'per_day',
    minimumPremiumMinor: '100',
    factors: [
      {
        id: 'co-state-factor',
        reason: 'Unapproved FARS/FHWA demonstration proxy; Colorado sandbox factor.',
        factorBps: 10400,
        sourceRefs: source('BZ-RATING-ENV'),
        when: {
          mode: 'all',
          conditions: [
            { fieldId: 'pickup-state', kind: 'comparison', operator: 'eq', value: 'co' },
          ],
        },
      },
      {
        id: 'ca-state-factor',
        reason: 'Unapproved FARS/FHWA demonstration proxy; California sandbox factor.',
        factorBps: 10800,
        sourceRefs: source('BZ-RATING-ENV'),
        when: {
          mode: 'all',
          conditions: [
            { fieldId: 'pickup-state', kind: 'comparison', operator: 'eq', value: 'ca' },
          ],
        },
      },
      {
        id: 'ny-state-factor',
        reason: 'Unapproved FARS/FHWA demonstration proxy; New York sandbox factor.',
        factorBps: 11200,
        sourceRefs: source('BZ-RATING-ENV'),
        when: {
          mode: 'all',
          conditions: [
            { fieldId: 'pickup-state', kind: 'comparison', operator: 'eq', value: 'ny' },
          ],
        },
      },
      {
        id: 'winter-factor',
        reason: 'Unapproved NOAA seasonal demonstration proxy.',
        factorBps: 11000,
        sourceRefs: source('BZ-RATING-ENV'),
        when: {
          mode: 'all',
          conditions: [{ fieldId: 'season', kind: 'comparison', operator: 'eq', value: 'winter' }],
        },
      },
      {
        id: 'premium-vehicle-factor',
        reason: 'Synthetic vehicle repair/value proxy.',
        factorBps: 12500,
        sourceRefs: source('BZ-PRD-08'),
        when: {
          mode: 'all',
          conditions: [
            { fieldId: 'vehicle-class', kind: 'comparison', operator: 'eq', value: 'premium' },
          ],
        },
      },
    ],
  },
  authority: {
    maximumPremiumMinor: '100000',
    maximumTotalLimitMinor: '60000000',
    limitMeasure: 'sum_of_declared_maximum_exposures',
    sourceRefs: source('BZ-CUSTOMER-AUTHORITY'),
  },
  servicing: {
    mode: 'recalculate_remaining',
    allowRiskChanges: false,
    allowTermExtension: true,
    calculation: 'per_day_remaining',
    minimumPremiumTreatment: 'block_if_applied',
    sourceRefs: source('BZ-END-01'),
  },
};

const policy = runtimePolicySchema.parse({
  id: 'bonzah-rental-protection',
  version: '0.1.0',
  name: 'Bonzah rental protection — unapproved sandbox intake',
  currency: 'USD',
  effectiveFrom: '2026-09-07',
  effectiveTo: '2027-09-06',
  maximumPremiumMinor: '100000',
  maximumParticipants: 5,
  commission: {
    rateBps: 0,
    base: 'gross_premium',
    recipientId: 'unassigned-producer',
    settlementPartyId: 'unassigned-settlement-party',
    cashCustody: 'external',
  },
  requirements: {
    payment: 'required_unsupported',
    approval: 'independent_review',
    providerVerification: 'required_unsupported',
  },
});

export const bonzahDevelopmentPolicies: ScopedRuntimePolicy[] = [
  { scope: bonzahDevelopmentScope, policy, policyHash: hash(policy) },
];

export const bonzahDevelopmentConfiguration: Configuration = {
  tenant: {
    displayName: 'Bonzah intake sandbox',
    locale: 'en-US',
    currency: 'USD',
    timeZone: 'America/Denver',
    residency: 'us',
  },
  operatingEntities: [
    {
      id: bonzahDevelopmentScope.operatingEntityId,
      name: 'Unassigned Bonzah operating entity',
      territories: ['US'],
    },
  ],
  products: [
    {
      id: policy.id,
      version: policy.version,
      name: policy.name,
      operatingEntityId: bonzahDevelopmentScope.operatingEntityId,
      processId: 'rental-protection',
      fields: [],
      requiredCapabilities: [
        'insurance_decisions',
        'coverage_rating',
        'exact_money',
        'configured_service',
      ],
      insurance: bonzahDevelopmentDefinition,
    },
  ],
  processes: [
    {
      id: 'rental-protection',
      version: '0.1.0',
      name: 'Rental protection intake',
      initialStage: 'quote',
      stages: [
        { id: 'quote', label: 'Quote', terminal: false },
        { id: 'referred', label: 'Referred', terminal: false },
        { id: 'bound', label: 'Bound', terminal: true },
      ],
      transitions: [
        { from: 'quote', to: 'referred', command: 'refer' },
        { from: 'quote', to: 'bound', command: 'bind-verified' },
        { from: 'referred', to: 'bound', command: 'bind-verified' },
      ],
    },
  ],
  integrations: [],
};

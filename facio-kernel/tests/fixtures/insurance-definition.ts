import type { Scope, Configuration } from '../../src/contracts/configuration.js';
import type {
  InsuranceProductDefinition,
  ConfiguredSubmissionV1,
  InsuranceProductDefinitionV1,
} from '../../src/contracts/insurance-definition.js';
import type { RuntimePolicy } from '../../src/contracts/insurance.js';
import { referenceConfiguration } from '../../src/fixtures/reference.js';
import { runtimePolicy, externalQuote } from './insurance.js';

// Explicitly synthetic conformance examples. These are not approved customer rates or authority.
const sourceRefs = ['synthetic://insurance-definition-conformance-v1'];
const base = (id: string, label: string, required = true) => ({
  id,
  label,
  description: 'Synthetic conformance input',
  required,
  sourceRefs,
});
export const configuredRuntimePolicy: RuntimePolicy = {
  ...runtimePolicy,
  id: 'configured-example',
  name: 'Synthetic configured insurance',
};
export const syntheticInsuranceDefinition: InsuranceProductDefinitionV1 = {
  schemaVersion: 'insurance-product-v1',
  pricingOwnership: 'kernel_deterministic',
  sourceRefs,
  territories: ['GB'],
  termRules: { minimumDays: 1, maximumDays: 366, backdating: 'not_permitted' },
  riskFields: [
    { ...base('age', 'Age'), type: 'integer', minimum: 0, maximum: 120 },
    { ...base('units', 'Quantity'), type: 'decimal', minimum: '0', maximum: '10000', scale: 2 },
    { ...base('prior-losses', 'Prior losses', false), type: 'integer', minimum: 0, maximum: 100 },
    { ...base('prohibited', 'Prohibited activity'), type: 'boolean' },
    {
      ...base('class', 'Risk class'),
      type: 'choice',
      options: [
        { id: 'standard', label: 'Standard' },
        { id: 'high', label: 'High' },
      ],
    },
    {
      ...base('value', 'Declared value'),
      type: 'money',
      minimumMinor: '10000',
      maximumMinor: '100000000',
    },
    {
      ...base('inspection', 'Inspection date'),
      type: 'date',
      minimum: '2020-01-01',
      maximum: '2030-12-31',
    },
    { ...base('description', 'Description'), type: 'text', minLength: 1, maxLength: 200 },
  ],
  coverages: [
    {
      id: 'basic',
      basis: 'single_risk_per_occurrence',
      name: 'Basic cover',
      description: 'Synthetic base cover',
      required: true,
      dependsOn: [],
      excludes: [],
      limit: { minimumMinor: '10000', maximumMinor: '1000000' },
      deductible: { minimumMinor: '0', maximumMinor: '10000' },
      rate: { method: 'flat', premiumMinor: '10000' },
      sourceRefs,
    },
    {
      id: 'extension',
      basis: 'single_risk_per_occurrence',
      name: 'Optional extension',
      description: 'Synthetic dependent extension',
      required: false,
      dependsOn: ['basic'],
      excludes: [],
      limit: { minimumMinor: '10000', maximumMinor: '100000' },
      deductible: { minimumMinor: '0', maximumMinor: '10000' },
      rate: { method: 'per_unit', quantityFieldId: 'units', premiumPerUnitMinor: '101' },
      sourceRefs,
    },
    {
      id: 'liability',
      basis: 'single_risk_per_occurrence',
      name: 'Optional liability',
      description: 'Synthetic limit rate',
      required: false,
      dependsOn: [],
      excludes: ['alternative'],
      limit: { minimumMinor: '10000', maximumMinor: '100000' },
      deductible: { minimumMinor: '0', maximumMinor: '10000' },
      rate: { method: 'limit_bps', rateBps: 100 },
      sourceRefs,
    },
    {
      id: 'alternative',
      basis: 'single_risk_per_occurrence',
      name: 'Alternative cover',
      description: 'Synthetic mutually exclusive cover',
      required: false,
      dependsOn: [],
      excludes: ['liability'],
      limit: { minimumMinor: '10000', maximumMinor: '100000' },
      deductible: { minimumMinor: '0', maximumMinor: '10000' },
      rate: { method: 'flat', premiumMinor: '2000' },
      sourceRefs,
    },
  ],
  eligibilityRules: [
    {
      id: 'prohibited-risk',
      reason: 'Synthetic prohibited activity rule',
      sourceRefs,
      outcome: 'decline',
      when: {
        mode: 'all',
        conditions: [{ fieldId: 'prohibited', kind: 'comparison', operator: 'eq', value: true }],
      },
    },
    {
      id: 'young-risk',
      reason: 'Synthetic age review rule',
      sourceRefs,
      outcome: 'refer',
      when: {
        mode: 'all',
        conditions: [{ fieldId: 'age', kind: 'comparison', operator: 'lt', value: 21 }],
      },
    },
    {
      id: 'loss-review',
      reason: 'Synthetic prior loss review rule',
      sourceRefs,
      outcome: 'refer',
      when: {
        mode: 'all',
        conditions: [{ fieldId: 'prior-losses', kind: 'comparison', operator: 'gte', value: 2 }],
      },
    },
  ],
  rating: {
    termBasis: 'whole_term',
    minimumPremiumMinor: '100',
    factors: [
      {
        id: 'high-risk-factor',
        reason: 'Synthetic selected class factor',
        sourceRefs,
        factorBps: 12500,
        when: {
          mode: 'all',
          conditions: [{ fieldId: 'class', kind: 'comparison', operator: 'eq', value: 'high' }],
        },
      },
    ],
  },
  authority: { maximumPremiumMinor: '20000', maximumTotalLimitMinor: '200000', sourceRefs },
};
export const syntheticConfiguredSubmission: ConfiguredSubmissionV1 = {
  reference: 'synthetic-configured-quote',
  version: '1',
  summary: 'Synthetic configured risk',
  evidenceRefs: sourceRefs,
  territory: 'GB',
  term: { startDate: '2026-09-10', endDate: '2026-09-30' },
  expiresAt: externalQuote.expiresAt,
  answers: {
    age: 35,
    units: '1.50',
    'prior-losses': 0,
    prohibited: false,
    class: 'standard',
    value: '100000',
    inspection: '2026-09-01',
    description: 'Synthetic risk',
  },
  coverages: [
    { coverageId: 'basic', limitMinor: '100000', deductibleMinor: '1000' },
    { coverageId: 'extension', limitMinor: '50000', deductibleMinor: '0' },
  ],
};
export function configuredProductConfiguration(
  scope: Scope,
  definition: InsuranceProductDefinition = syntheticInsuranceDefinition,
): Configuration {
  const configuration = structuredClone(referenceConfiguration);
  configuration.tenant!.currency = configuredRuntimePolicy.currency;
  configuration.operatingEntities[0]!.id = scope.operatingEntityId;
  configuration.operatingEntities[0]!.territories = ['GB'];
  configuration.products = [
    {
      ...configuration.products[0]!,
      id: configuredRuntimePolicy.id,
      version: configuredRuntimePolicy.version,
      name: configuredRuntimePolicy.name,
      operatingEntityId: scope.operatingEntityId,
      fields: [],
      requiredCapabilities: ['insurance_decisions', 'coverage_rating', 'exact_money'],
      insurance: structuredClone(definition),
    },
  ];
  return configuration;
}

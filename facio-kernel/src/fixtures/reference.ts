import type { Configuration, Scope } from '../contracts/configuration.js';
// Synthetic conformance inputs; these do not represent any approved customer journey.
export const referenceScope: Scope = {
  workspaceId: 'local',
  tenantId: 'reference',
  environment: 'development',
  operatingEntityId: 'entity-one',
};
export const incompleteScope: Scope = { ...referenceScope, tenantId: 'incomplete' };
export const referenceConfiguration: Configuration = {
  tenant: {
    displayName: 'Reference workspace',
    locale: 'en-GB',
    currency: 'EUR',
    timeZone: 'Europe/Nicosia',
    residency: 'eu',
  },
  operatingEntities: [
    { id: 'entity-one', name: 'Reference operating entity', territories: ['CY'] },
  ],
  products: [
    {
      id: 'sample-product',
      version: '1.0.0',
      name: 'Definition example',
      operatingEntityId: 'entity-one',
      processId: 'sample-process',
      fields: [{ id: 'description', label: 'Risk description', type: 'text', required: true }],
      requiredCapabilities: ['definition_validation'],
    },
  ],
  processes: [
    {
      id: 'sample-process',
      version: '1.0.0',
      name: 'Definition review example',
      initialStage: 'draft',
      stages: [
        { id: 'draft', label: 'Draft', terminal: false },
        { id: 'reviewed', label: 'Reviewed', terminal: true },
      ],
      transitions: [{ from: 'draft', to: 'reviewed', command: 'review' }],
    },
  ],
  integrations: [],
};
export const incompleteConfiguration: Configuration = {
  tenant: null,
  operatingEntities: [],
  products: [],
  processes: [],
  integrations: [],
};

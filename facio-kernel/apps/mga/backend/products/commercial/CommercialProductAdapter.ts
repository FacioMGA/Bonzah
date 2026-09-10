import { ManifestRuntimeProductAdapter } from '../../modules/policy/domain/ManifestRuntimeProductAdapter.js';
import { registerSourceConfigurationAdapter } from '../../modules/insuranceConfiguration/domain/sourceAdapters.js';
import { commercialProductRuntimeConfig } from './runtime.js';
import { validateCommercialConfiguration } from './pricing.js';
import { configuredCommercialSegments } from '@facio/products';

/** Registration is server-owned. A tenant may configure values, never install code. */
export class CommercialProductAdapter extends ManifestRuntimeProductAdapter {
  constructor() {
    super(commercialProductRuntimeConfig);
    registerSourceConfigurationAdapter({ productType: 'COMMERCIAL', engineId: 'symphony-commercial-v1', validate: validateCommercialConfiguration, questionScopes: { coverage: { field: 'commercial.coverages', itemKey: 'coverage' }, segment: { field: 'commercial.segmentId' } }, questionSegments: configuredCommercialSegments });
  }
  getEndorsementCatalog() { return super.getEndorsementCatalog().map((template) => ({ ...template, program_code: 'commercial' })); }
  getEndorsementTemplate(code: string) { return this.getEndorsementCatalog().find((template) => template.code === code); }
}

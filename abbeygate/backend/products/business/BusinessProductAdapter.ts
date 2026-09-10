import { ManifestRuntimeProductAdapter } from '../../modules/policy/domain/ManifestRuntimeProductAdapter.js';
import { businessProductRuntimeConfig } from './runtime.js';

export class BusinessProductAdapter extends ManifestRuntimeProductAdapter {
  constructor() {
    super(businessProductRuntimeConfig);
  }
}

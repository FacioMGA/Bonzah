import { ManifestRuntimeProductAdapter } from '../../modules/policy/domain/ManifestRuntimeProductAdapter.js';
import { openMarketProductRuntimeConfig } from './runtime.js';

export class OpenMarketProductAdapter extends ManifestRuntimeProductAdapter {
  constructor() {
    super(openMarketProductRuntimeConfig);
  }
}

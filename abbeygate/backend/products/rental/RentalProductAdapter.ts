import { ManifestRuntimeProductAdapter } from '../../modules/policy/domain/ManifestRuntimeProductAdapter.js';
import { rentalProductRuntimeConfig } from './runtime.js';

export class RentalProductAdapter extends ManifestRuntimeProductAdapter {
  constructor() { super(rentalProductRuntimeConfig); }
}

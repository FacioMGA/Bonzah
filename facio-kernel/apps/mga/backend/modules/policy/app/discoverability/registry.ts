import { ProductRegistry } from '../../domain/ProductRegistry.js';
import type { ProductDiscoverabilityInput, ProductDiscoverabilityProjection } from './types.js';

export function resolveProductDiscoverability(input: ProductDiscoverabilityInput): ProductDiscoverabilityProjection {
  const productType = String(input.productType || '').toUpperCase();
  const adapter = ProductRegistry.getInstance().getAdapter(productType);
  if (!adapter) {
    return {
      insuredName: '', insuredDisplay: '', vehicleDisplay: null,
      policyholderDisplay: null, policyholderEmail: null, policyholderPhone: null,
      coverageStart: null, coverageEnd: null, vehicleSearch: null,
      address: null, segment: null, totalPremium: 0, renewalDate: null, quoteExpiryDate: null,
    };
  }
  return adapter.buildDiscoverabilityProjection(input);
}

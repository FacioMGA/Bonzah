import { ProductRegistry } from '../modules/policy/domain/ProductRegistry.js';
import { ValidationRegistry } from '@facio/validation/backend';
import {
  businessValidationProfile,
  healthValidationProfile,
  homeValidationProfile,
  motorValidationProfile,
  openMarketValidationProfile,
  travelValidationProfile,
  rentalValidationProfile,
} from '@facio/products';
import { buildProductCatalog } from './catalog.js';

export function registerAllProducts(): void {
  for (const adapter of buildProductCatalog()) {
    ProductRegistry.getInstance().register(adapter);
  }
  // Every product validates through the canonical `validateForContext` entry
  // point with profile-driven step refinements and lifecycle stage gating.
  ValidationRegistry.register(homeValidationProfile);
  ValidationRegistry.register(motorValidationProfile);
  ValidationRegistry.register(travelValidationProfile);
  ValidationRegistry.register(healthValidationProfile);
  ValidationRegistry.register(businessValidationProfile);
  ValidationRegistry.register(openMarketValidationProfile);
  ValidationRegistry.register(rentalValidationProfile);
}

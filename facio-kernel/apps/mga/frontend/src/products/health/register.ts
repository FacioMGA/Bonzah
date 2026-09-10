import { ProductRegistry } from '@/src/shared/lib/products/registry';
import { ValidationRegistry } from '@facio/validation/frontend';
import { healthManifest, healthValidationProfile } from '@facio/products';

ProductRegistry.register(healthManifest);
ValidationRegistry.register(healthValidationProfile);

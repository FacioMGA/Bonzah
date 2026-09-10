import { ProductRegistry } from '@/src/shared/lib/products/registry';
import { ValidationRegistry } from '@facio/validation/frontend';
import { homeManifest, homeValidationProfile } from '@facio/products';

ProductRegistry.register(homeManifest);
ValidationRegistry.register(homeValidationProfile);

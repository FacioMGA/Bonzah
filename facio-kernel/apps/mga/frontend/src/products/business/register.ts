import { ProductRegistry } from '@/src/shared/lib/products/registry';
import { ValidationRegistry } from '@facio/validation/frontend';
import { businessManifest, businessValidationProfile } from '@facio/products';

ProductRegistry.register(businessManifest);
ValidationRegistry.register(businessValidationProfile);

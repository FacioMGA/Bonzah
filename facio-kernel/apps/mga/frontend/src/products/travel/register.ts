import { ProductRegistry } from '@/src/shared/lib/products/registry';
import { ValidationRegistry } from '@facio/validation/frontend';
import { travelManifest, travelValidationProfile } from '@facio/products';

ProductRegistry.register(travelManifest);
ValidationRegistry.register(travelValidationProfile);

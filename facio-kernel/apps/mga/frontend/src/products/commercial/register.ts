import { ProductRegistry } from '@/src/shared/lib/products/registry';
import { ValidationRegistry } from '@facio/validation/frontend';
import { commercialManifest, commercialValidationProfile } from '@facio/products';
ProductRegistry.register(commercialManifest);
ValidationRegistry.register(commercialValidationProfile);

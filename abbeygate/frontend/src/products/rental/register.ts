import { ProductRegistry } from '@/src/shared/lib/products/registry';
import { ValidationRegistry } from '@facio/validation/frontend';
import { rentalManifest, rentalValidationProfile } from '@facio/products';

ProductRegistry.register(rentalManifest);
ValidationRegistry.register(rentalValidationProfile);

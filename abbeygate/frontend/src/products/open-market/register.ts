import { ProductRegistry } from '@/src/shared/lib/products/registry';
import { ValidationRegistry } from '@facio/validation/frontend';
import { openMarketManifest, openMarketValidationProfile } from '@facio/products';

ProductRegistry.register(openMarketManifest);
ValidationRegistry.register(openMarketValidationProfile);

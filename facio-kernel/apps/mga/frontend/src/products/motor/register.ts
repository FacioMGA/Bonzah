import { ProductRegistry } from '@/src/shared/lib/products/registry';
import { ValidationRegistry } from '@facio/validation/frontend';
import { motorManifest, motorValidationProfile } from '@facio/products';

/**
 * Motor product registration (FE adapter).
 *
 * Phase 8 (2026-04-28) closure: motor's Zod tree was absorbed into
 * `@facio/products`, so wizard-step validation runs through the
 * canonical profile directly. There is no IoC seam left to wire.
 */
ProductRegistry.register(motorManifest);
ValidationRegistry.register(motorValidationProfile);

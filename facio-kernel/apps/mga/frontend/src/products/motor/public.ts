/**
 * P U B L I C   A P I   B O U N D A R Y
 * - Product: Motor
 *
 * RULE: Consumers outside `products/motor/**` may ONLY import motor-specific code from this barrel.
 * RULE: Deep imports into `products/motor/**` are STRICTLY FORBIDDEN.
 *
 * This is the motor product's public contract — wizard entry, driver validation,
 * and the small motor-specific helpers (license years, vehicle use) that
 * originated as motor wizard utilities but are consumed across the app during
 * the multi-product transition. The country list + flag helpers are NOT
 * re-exported here: callers must use `@facio/products` (`countries`) and
 * `@/src/shared/lib/utils/countryOptions` (`addFlagsToCountryOptions`) directly.
 */

export { default as MotorQuoteWizard } from './wizard/QuoteWizardEngine';

export {
  ageFromDateOfBirth,
  youngestAgeFromDrivers,
  issueFieldKeyFromSlug,
  validateDriverDraft,
} from './wizard/validation/driverValidation';
export type { DriverFieldErrors } from './wizard/validation/driverValidation';

export { licenseYearsOptions } from './wizard/utils/licenseYears';
export { vehicleUseOptions } from './wizard/utils/vehicleUse';

export { usePolicyQuoteSession } from './wizard/hooks/usePolicyQuoteSession';

export { vehicleApi } from './wizard/services/vehicleApi';
export type { VehicleEnrichmentResult, VehicleVariantOption } from './wizard/services/vehicleApi';
export { normalizeVehicleEnrichmentQuoteData } from './wizard/services/vehicleEnrichmentMerge';

export { QuoteSchema } from './wizard/wizardPublic';

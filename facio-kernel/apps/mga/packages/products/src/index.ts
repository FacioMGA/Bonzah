/**
 * `@facio/products` — single source of truth for Abbeygate product manifests
 * and validation profiles.
 *
 * Phase 4 (2026-04 consolidation):
 * - 6 manifest files (3 BE + 3 FE) → 3 here (one per product).
 * - 5 validation-profile files (2 BE + 3 FE) → 3 here (one per product).
 * - 2 manifest type modules (BE `productManifest.ts` + FE `manifest.types.ts`)
 *   → 1 (`./types.ts`).
 *
 * Phase 8 (2026-04-28): absorbed motor's Zod tree + the shared
 * address-validation helpers. Motor's IoC seam was deleted — wizard-
 * step validation now flows directly through the canonical schemas.
 *
 * Re-creating any of the retired paths is blocked at CI by
 * `tools/quality/check-products-single-source.mjs`.
 */

export * from './types.js';
export { commercialManifest } from './commercial/manifest.js';
export { commercialValidationProfile } from './commercial/profile.js';

export { countries } from './shared/countries.js';
export {
  normalizePostCodeForCountry,
  validatePostCodeForCountry,
  validateProvinceForCountry,
  getAddressValidationErrors,
} from './shared/addressValidation.js';
export type { AddressValidationInput } from './shared/addressValidation.js';
export type {
  PolicyHolderAddress,
  PolicyHolderProfile,
  PolicyHolderCollection,
} from './shared/policyHolder.js';

export {
  MOTOR_BEST_TIME_TO_CALL_OPTIONS,
  MOTOR_COUNTRY_OF_REGISTRATION_OPTIONS,
  MOTOR_FUEL_TYPE_OPTIONS,
  MOTOR_KMS_PER_YEAR_OPTIONS,
  MOTOR_LICENSE_ISSUED_IN_OPTIONS,
  MOTOR_LICENSE_TYPE_OPTIONS,
  MOTOR_LICENSE_YEARS_OPTIONS,
  MOTOR_NCB_OPTIONS,
  MOTOR_PARKING_OPTIONS,
  MOTOR_VEHICLE_TYPE_OPTIONS,
  MOTOR_VEHICLE_USE_OPTIONS,
  MOTOR_WHERE_DID_YOU_HEAR_OPTIONS,
  MOTOR_YOUNGEST_DRIVER_AGE_OPTIONS,
  motorManifest,
} from './motor/manifest.js';
export { MOTOR_CANONICAL_FIELD_PATHS, motorValidationProfile } from './motor/profile.js';
export type { MotorWizardStepId } from './motor/profile.js';
export {
  MOTOR_NUMERIC_SELECT_FIELD_PATHS,
  coerceMotorQuestionnaireFieldValue,
  normalizeMotorQuoteDataForValidation,
} from './motor/fieldValueSemantics.js';
export {
  ENRICHMENT_TARGET_FIELDS,
  VEHICLE_ENRICHMENT_FIELD_KEYS,
  FUEL_TYPE_OPTIONS,
  VEHICLE_TYPE_OPTIONS,
  COUNTRY_OF_REGISTRATION_OPTIONS,
  CABRIO_OPTIONS,
  cardogRowToVariantOption,
  enrichmentToQuoteDataUpdates,
  inferCabrioFromBodyStyle,
  normalizeCabrio,
  normalizeCardogRowToEnrichment,
  normalizeCountry,
  normalizeEnrichmentTargetValue,
  normalizeFuelType,
  normalizeVehicleType,
  variantOptionToEnrichmentResult,
} from './motor/vehicleEnrichment.js';
export type {
  VehicleEnrichmentFieldKey,
  VehicleEnrichmentResult,
  VehicleEnrichmentFieldConfidence,
  VehicleEnrichmentNormalizedQuoteData,
  VehicleVariantOption,
} from './motor/vehicleEnrichment.js';
export {
  Step1Schema,
  Step2Schema,
  Step3Schema,
  QuoteSchema,
  zodErrorsToFieldErrors,
  validateWizardPolicyHolderStep,
  validateWizardDrivingHistoryStep,
  validateWizardVehicleCoverStep,
} from './motor/schemas/index.js';
export type { QuoteDataFromSchema } from './motor/schemas/index.js';
export { MOTOR_QUESTIONNAIRE_STEP_OWNERSHIP } from './motor/stepOwnership.js';
export { isUkOrEuLicenceCountry, requiresForeignLicenceConfirmation } from './motor/licenceCountry.js';
export {
  MOTOR_VALIDATION_CONTRACT_SOURCE_HASH,
  MOTOR_REQUIRED_KEYS_BY_ACTOR_STAGE,
  MOTOR_REQUIRED_BY_STAGE,
  MOTOR_QUOTE_READY_FIELDS,
  MOTOR_REQUIRED_ISSUANCE_FIELDS,
  MOTOR_STEP_SCOPED_FIELDS,
} from './motor/generated/motorValidationContract.generated.js';

export {
  HOME_INCREASED_EXCESS_OPTIONS,
  HOME_NO_CLAIMS_DISCOUNT_LABEL,
  HOME_NO_CLAIMS_DISCOUNT_LEGACY_VALUE,
  HOME_NO_CLAIMS_DISCOUNT_OPTIONS,
  HOME_NO_CLAIMS_DISCOUNT_VALID_OPTIONS,
  HOME_PREVIOUS_CLAIMS_OPTIONS,
  HOME_PROPERTY_TYPE_OPTIONS,
  HOME_YEAR_BUILT_OPTIONS,
  HOME_YES_NO_OPTIONS,
  homeManifest,
} from './home/manifest.js';
export { homeValidationProfile, hasSpecifiedHighRiskItems } from './home/profile.js';
export { isUkOrEuDomicileCountry } from './home/domicileEligibility.js';
export {
  HOME_SOLAR_PANEL_DEFAULT_AMOUNT,
  HOME_SOLAR_PANEL_DEFAULT_CALCULATOR_VERSION,
  hasHomeSolarPanelDefault,
  resolveHomeSolarPanelCoverAmount,
  wasHomeSolarPanelMinimumRated,
} from './home/solarPanelCover.js';
export {
  isOperatingTerritoryNational,
  matchLocalMarketNationalityReferral,
  matchOperatingTerritoryNationality,
  type OperatingTerritoryCode,
  type OperatingTerritoryNationalMatch,
} from './shared/operatingTerritoryNationality.js';
export {
  HOME_VALIDATION_CONTRACT_SOURCE_HASH,
  HOME_REQUIRED_BY_STAGE,
  HOME_REQUIRED_BIND_FIELDS,
  HOME_REQUIRED_ISSUANCE_FIELDS,
  HOME_ALL_PROFILE_FIELDS,
} from './home/generated/homeValidationContract.generated.js';

export {
  TRAVEL_COVER_TYPE_OPTIONS,
  TRAVEL_ID_TYPE_OPTIONS,
  TRAVEL_NATIONALITY_OPTIONS,
  TRAVEL_PLAN_TYPE_OPTIONS,
  TRAVEL_PREVIOUS_CLAIM_BAND_OPTIONS,
  TRAVEL_RESIDENCE_COUNTRY_OPTIONS,
  TRAVEL_RESIDENCE_DURATION_OPTIONS,
  TRAVEL_RESIDENCY_STATUS_OPTIONS,
  TRAVEL_SELECTED_PLAN_OPTIONS,
  travelManifest,
} from './travel/manifest.js';
export { travelValidationProfile } from './travel/profile.js';
export {
  TRAVEL_DESTINATION_AREAS,
  isTravelDestinationArea,
  travelDestinationAreaLabel,
} from './travel/destinations.js';
export type { TravelDestinationAreaValue } from './travel/destinations.js';
export {
  annualTravelPolicyEndDateFromStart,
  isTravelAnnualEndDateWithinOneYear,
} from './travel/dates.js';
export {
  TRAVEL_ADDON_CATALOG,
  TRAVEL_ADDON_KEYS,
  getTravelAddonEndorsementCode,
  getTravelAddonLabel,
  isTravelAddonKey,
  travelAddonKeyFromEndorsementCode,
} from './travel/addons.js';
export type { TravelAddonCatalogEntry, TravelAddonKey } from './travel/addons.js';
export {
  normalizeCountryNameForExpatCompare,
  residenceMatchesNationality,
} from './travel/eligibility.js';
export {
  TRAVEL_VALIDATION_CONTRACT_SOURCE_HASH,
  TRAVEL_REQUIRED_BY_STAGE,
  TRAVEL_REQUIRED_BIND_FIELDS,
  TRAVEL_REQUIRED_ISSUANCE_FIELDS,
  TRAVEL_ALL_PROFILE_FIELDS,
} from './travel/generated/travelValidationContract.generated.js';

export {
  HEALTH_COVER_TYPE_OPTIONS,
  HEALTH_GENDER_OPTIONS,
  HEALTH_ID_TYPE_OPTIONS,
  HEALTH_NATIONALITY_OPTIONS,
  HEALTH_OCCUPATION_OPTIONS,
  HEALTH_RESIDENCE_COUNTRY_OPTIONS,
  HEALTH_RESIDENCE_DURATION_OPTIONS,
  HEALTH_RESIDENCY_STATUS_OPTIONS,
  healthManifest,
} from './health/manifest.js';
export { healthValidationProfile } from './health/profile.js';
export {
  normalizeCountryNameForExpatCompare as normalizeHealthCountryNameForExpatCompare,
  residenceMatchesNationality as healthResidenceMatchesNationality,
} from './health/eligibility.js';
export {
  HEALTH_VALIDATION_CONTRACT_SOURCE_HASH,
  HEALTH_REQUIRED_BY_STAGE,
  HEALTH_REQUIRED_BIND_FIELDS,
  HEALTH_REQUIRED_ISSUANCE_FIELDS,
  HEALTH_ALL_PROFILE_FIELDS,
} from './health/generated/healthValidationContract.generated.js';

export {
  BUSINESS_COVER_TIMING_OPTIONS,
  BUSINESS_FIRE_RESPONSE_OPTIONS,
  BUSINESS_HEAR_ABOUT_OPTIONS,
  BUSINESS_NATIONALITY_OPTIONS,
  BUSINESS_PREMISES_STATUS_OPTIONS,
  BUSINESS_THEFT_PREVENTION_OPTIONS,
  BUSINESS_YES_NO_OPTIONS,
  businessManifest,
} from './business/manifest.js';
export { businessValidationProfile } from './business/profile.js';

export {
  OPEN_MARKET_IMMIGRATION_APPLICATION_OPTIONS,
  OPEN_MARKET_IMMIGRATION_RESIDENCY_OPTIONS,
  OPEN_MARKET_LINE_OF_BUSINESS_OPTIONS,
  OPEN_MARKET_PROPOSAL_STATUS_OPTIONS,
  openMarketManifest,
} from './open-market/manifest.js';
export { openMarketValidationProfile } from './open-market/profile.js';
export { configuredCommercialSegments, type CommercialSegmentSource } from './commercial/segments.js';
export { rentalManifest } from './rental/manifest.js';
export { rentalValidationProfile } from './rental/profile.js';
export {
  RENTAL_COVERAGE_CODES,
  RENTAL_PROTECTION_PACKAGE_CODES,
  RENTAL_PROTECTION_PACKAGES,
  RENTAL_POWERTRAINS,
  RENTAL_REPAIR_PROFILES,
  RENTAL_VEHICLE_CLASSES,
} from './rental/contract.js';
export type {
  RentalBindResponse,
  RentalBindRequest,
  RentalCoverageCode,
  RentalCoverageDiscoveryRequest,
  RentalCoverageDiscoveryResponse,
  RentalDiscoveredCoverage,
  RentalProtectionPackageCode,
  RentalCoveragePrice,
  RentalPowertrain,
  RentalQuoteRequest,
  RentalQuoteResponse,
  RentalPricePreviewRequest,
  RentalPricePreviewResponse,
  RentalQuoteStatus,
  RentalRatingFactor,
  RentalRatingSourceSnapshot,
  RentalRepairProfile,
  RentalVehicleClass,
  RentalVehicleRisk,
  RentalRatingVehicle,
  RentalPolicyResponse,
  SummitVehicle,
} from './rental/contract.js';

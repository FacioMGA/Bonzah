/**
 * `@facio/validation` — env-agnostic entry.
 *
 * This entry exposes everything that does NOT depend on a specific phone
 * validator: types, pure rules, the `Registry` class, the rule registry
 * factory, and `createValidationContext`. Profile definitions and
 * types-only consumers can import from here without pulling either
 * `react-phone-number-input` (FE) or `libphonenumber-js` (BE).
 *
 * Frontend code that needs `validateForContext`, `resolveRule`, or
 * `ValidationRegistry` (the instance) imports from
 * `@facio/validation/frontend` instead. Backend code imports from
 * `@facio/validation/backend`. Both adapters re-export everything in this
 * file, so importing from a subpath gets the full surface.
 *
 * IMPORTANT (Phase 3, 2026-04-27 acceptance):
 * - This package is the only validation implementation. The retired
 *   `frontend/src/shared/validation/` and `backend/shared/validation/`
 *   directories were deleted in Phase 3h.
 * - `tools/quality/check-validation-single-source.mjs` (added in Phase 3i)
 *   blocks any new file from being created under those retired paths.
 */

// Types
export type {
  FieldContract,
  FieldErrors,
  LifecycleStageId,
  LifecycleStageDefinition,
  RefinementFn,
  ValidateContextInput,
  ValidationActor,
  ValidationProfile,
  ValidationStage,
  WizardStepDefinition,
} from './types.js';

// Pure rules
export {
  Name,
  NonEmptyString,
  EMAIL_REGEX,
  Email,
  IsoDate,
  DOB,
  PositiveMoney,
  Percentage,
  NumberRange,
  CountryName,
  PostcodeForCountry,
  Nif,
  EnumOf,
  coerceBool,
  MustAccept,
  BoolFlag,
  requiredIf,
  OneOf,
  NonEmptyStringArray,
} from './rules-pure.js';

// Phone factory (caller injects their phone validator)
export { createPhoneE164 } from './rules-phone.js';
export type { PhoneValidator } from './rules-phone.js';

// Rule registry + resolveRule factories
export { createRuleRegistry, createResolveRule } from './rules-registry.js';
export type { RuleRegistry } from './rules-registry.js';

// Registry class (each context instantiates its own)
export { Registry } from './registry.js';

// Runner factory + types
export { createRunner } from './runner.js';
export type { Runner, RunnerDeps } from './runner.js';

// One-shot factory for the most common case (used by the FE/BE adapters)
export { createValidationContext } from './createValidationContext.js';
export type { ValidationContext, ValidationContextDeps } from './createValidationContext.js';

// Canonical shared-field contracts. The `nationality` contract is the
// reference implementation for the "every shared field has one canonical
// contract" pattern enforced by ADR-0010 +
// `tools/quality/check-contracts-product-consistency.mjs`.
export {
  NATIONALITY_OPTIONS,
  NATIONALITY_PAYLOAD_PATH,
  NATIONALITY_PRODUCT_REQUIREMENTS,
  NATIONALITY_DEMONYM_TO_COUNTRY,
  NATIONALITY_CONTRACT,
  isCanonicalNationality,
  nationalityRule,
} from './nationality/contract.js';
export type { Nationality, NationalityProductCode } from './nationality/contract.js';

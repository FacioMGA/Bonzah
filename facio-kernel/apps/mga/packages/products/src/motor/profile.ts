/**
 * Motor validation profile — single source of truth.
 *
 * Phase 4 collapsed every product's profile into `@facio/products`.
 * Phase 8 (2026-04-28) absorbed the motor Zod tree into this package
 * too and **deleted the IoC seam** that previously delegated wizard-
 * step validation to FE-only schemas. Wizard-step refinements now
 * call the canonical `validateWizard*Step` helpers directly from
 * `./schemas/index.ts`. There are no per-side validators, no runtime
 * "attach" hooks, and no FE-only validation paths.
 *
 * Responsibility split:
 *   - `motorMetadataFields` — what's required at which stage, by which actor.
 *     Consumed by the BO Underwriting tab, the contract-artifact generator,
 *     and "what is required to bind?" projections.
 *   - `motorValidationProfile.steps[*].refinements` — wizard-step gating.
 *     Authoritative for "did the customer fill in step N correctly?".
 *   - `motorValidationProfile.stages` — lifecycle gating (bind/issuance).
 *     Drives `validateForContext({ stage: 'bind' | 'issuance' })`. The
 *     pre-`spine/v2` `validateUnifiedQuoteData` BE-only path was deleted
 *     in Wave 2; the staged refinements in this file ARE the canonical
 *     bind/issuance gates now (see comment on `ALL_BIND_ACTORS` below).
 */

import type {
  FieldContract,
  LifecycleStageId,
  RefinementFn,
  ValidationActor,
  ValidationProfile,
} from '@facio/validation';
import { z } from 'zod';
import {
  MOTOR_QUOTE_READY_FIELDS,
  MOTOR_REQUIRED_ISSUANCE_FIELDS,
} from './generated/motorValidationContract.generated.js';
import {
  validateMotorBindStage,
  validateMotorIssuanceStage,
  validateWizardDrivingHistoryStep,
  validateWizardPolicyHolderStep,
  validateWizardVehicleCoverStep,
} from './schemas/index.js';

// `requiredAtStages` values follow the rule: every stage at which the
// field MUST already be populated. The lifecycle is draft → pricing →
// quote → bind → issuance, so `['quote', 'bind', 'issuance']` reads as
// "must be present from quote onward". Earlier wave shipped these as
// `['quote', 'bind']` and silently dropped the field at issuance —
// `spine/v2` Wave 2 closed that gap when the parallel
// `validateUnifiedQuoteData` was deleted and `validateForContext` took
// over the issuance gate.
const ALL_BIND_ACTORS: Partial<Record<ValidationActor, LifecycleStageId[]>> = {
  customer: ['draft', 'pricing', 'quote', 'bind', 'issuance'],
  underwriter: ['draft', 'pricing', 'quote', 'bind', 'issuance'],
};

const BIND_AND_ISSUANCE: LifecycleStageId[] = ['bind', 'issuance'];
const QUOTE_BIND_AND_ISSUANCE: LifecycleStageId[] = ['quote', 'bind', 'issuance'];

const motorMetadataFields: Record<string, FieldContract> = {
  // Phase 6k (2026-04-28): all 16 personal-details keys live under
  // canonical `proposer.*`; root-level flat aliases are deleted from
  // every code path. The Prisma `canonicalize_motor_proposer` migration
  // rewrites pre-existing rows.
  'proposer.firstName': { path: 'proposer.firstName', dataClassification: 'canonical', requiredAtByActor: { ...ALL_BIND_ACTORS } },
  'proposer.lastName': { path: 'proposer.lastName', dataClassification: 'canonical', requiredAtByActor: { ...ALL_BIND_ACTORS } },
  'proposer.address.line1': { path: 'proposer.address.line1', dataClassification: 'canonical', requiredAtStages: BIND_AND_ISSUANCE },
  'proposer.address.city': { path: 'proposer.address.city', dataClassification: 'canonical', requiredAtStages: BIND_AND_ISSUANCE },
  'proposer.address.province': { path: 'proposer.address.province', dataClassification: 'canonical' },
  'proposer.address.postcode': { path: 'proposer.address.postcode', dataClassification: 'canonical', requiredAtStages: BIND_AND_ISSUANCE },
  'proposer.address.country': { path: 'proposer.address.country', dataClassification: 'canonical', requiredAtStages: BIND_AND_ISSUANCE },
  'proposer.dateOfBirth': { path: 'proposer.dateOfBirth', dataClassification: 'canonical', requiredAtStages: QUOTE_BIND_AND_ISSUANCE },
  'proposer.nationality': { path: 'proposer.nationality', dataClassification: 'canonical', requiredAtStages: BIND_AND_ISSUANCE },
  'proposer.nif': {
    path: 'proposer.nif',
    rule: 'nif',
    label: 'NIF / tax ID',
    dataClassification: 'canonical',
    requiredAtStages: ['issuance'],
  },
  'proposer.phone': { path: 'proposer.phone', dataClassification: 'canonical', requiredAtByActor: { ...ALL_BIND_ACTORS } },
  'proposer.email': { path: 'proposer.email', dataClassification: 'canonical', requiredAtByActor: { ...ALL_BIND_ACTORS } },
  'proposer.occupation': { path: 'proposer.occupation', dataClassification: 'canonical', requiredAtStages: BIND_AND_ISSUANCE },
  'proposer.whereDidYouHear': { path: 'proposer.whereDidYouHear', dataClassification: 'canonical', requiredAtStages: BIND_AND_ISSUANCE },
  'proposer.bestTimeToCall': { path: 'proposer.bestTimeToCall', dataClassification: 'canonical', requiredAtStages: BIND_AND_ISSUANCE },
  homeInsuranceRenewalDate: { path: 'homeInsuranceRenewalDate' },

  'proposer.marketingConsent': { path: 'proposer.marketingConsent', dataClassification: 'declaration', audience: 'customer' },
  'proposer.privacyPolicyAccepted': { path: 'proposer.privacyPolicyAccepted', dataClassification: 'declaration', audience: 'all', requiredAtStages: BIND_AND_ISSUANCE },
  infoTrueAndAccurate: { path: 'infoTrueAndAccurate', dataClassification: 'declaration', audience: 'all', requiredAtStages: BIND_AND_ISSUANCE },
  fairProcessingAccepted: { path: 'fairProcessingAccepted', dataClassification: 'declaration', audience: 'all', requiredAtStages: BIND_AND_ISSUANCE },

  vehicleLocation: { path: 'vehicleLocation' },
  coverRequired: { path: 'coverRequired', requiredAtStages: QUOTE_BIND_AND_ISSUANCE },
  renewalDate: { path: 'renewalDate' },
  vehicleType: { path: 'vehicleType', requiredAtStages: QUOTE_BIND_AND_ISSUANCE },
  motorcycleRidersNamed: { path: 'motorcycleRidersNamed' },
  classicIsGenuine: { path: 'classicIsGenuine' },
  classicIsSecondaryVehicle: { path: 'classicIsSecondaryVehicle' },
  make: { path: 'make', requiredAtStages: QUOTE_BIND_AND_ISSUANCE },
  model: { path: 'model', requiredAtStages: QUOTE_BIND_AND_ISSUANCE },
  cabrio: { path: 'cabrio' },
  fuelType: { path: 'fuelType' },
  kmsPerYear: { path: 'kmsPerYear' },
  year: { path: 'year', requiredAtStages: QUOTE_BIND_AND_ISSUANCE },
  countryOfRegistration: { path: 'countryOfRegistration' },
  registrationNumber: { path: 'registrationNumber' },
  vin: { path: 'vin' },
  numberOfSeats: { path: 'numberOfSeats' },
  modified: { path: 'modified' },
  modificationsDetails: { path: 'modificationsDetails' },
  parking: { path: 'parking' },
  parkingOther: { path: 'parkingOther' },
  engineSize: { path: 'engineSize', requiredAtStages: QUOTE_BIND_AND_ISSUANCE },
  // Conditional EV requiredness is enforced by the product-owned Step 3
  // and bind/issue refinements (ADR-0102), not a global field default.
  electricPowerKw: { path: 'electricPowerKw' },
  vehicleValue: { path: 'vehicleValue', requiredAtStages: QUOTE_BIND_AND_ISSUANCE },
  ncb: { path: 'ncb', requiredAtStages: QUOTE_BIND_AND_ISSUANCE },
  protectNCB: { path: 'protectNCB' },
  vehicleUse: { path: 'vehicleUse', requiredAtStages: QUOTE_BIND_AND_ISSUANCE },
  businessUseDetails: { path: 'businessUseDetails' },
  requiredExcess: { path: 'requiredExcess' },
  ncdProofUpload: { path: 'ncdProofUpload' },

  licenseYears: { path: 'licenseYears', requiredAtStages: QUOTE_BIND_AND_ISSUANCE },
  licenseType: { path: 'licenseType', requiredAtStages: QUOTE_BIND_AND_ISSUANCE },
  licenseIssuedIn: { path: 'licenseIssuedIn', requiredAtStages: QUOTE_BIND_AND_ISSUANCE },
  // Conditionally required (only for non-UK/EU licences) via the step-2
  // schema refinement, so no unconditional `requiredAtStages` here.
  licenseForeignDeclarationAccepted: { path: 'licenseForeignDeclarationAccepted' },
  hasClaims: { path: 'hasClaims' },
  claimsCountLast5Years: { path: 'claimsCountLast5Years' },
  claimsTotalCostLast5Years: { path: 'claimsTotalCostLast5Years' },
  maxFaultClaimCostLast5Years: { path: 'maxFaultClaimCostLast5Years' },
  claimsDetails: { path: 'claimsDetails' },
  hasConvictions: { path: 'hasConvictions' },
  convictionClass: { path: 'convictionClass' },
  majorConvictionWithinYears: { path: 'majorConvictionWithinYears' },
  hasMajorConvictionLast5Years: { path: 'hasMajorConvictionLast5Years' },
  convictionsDetails: { path: 'convictionsDetails' },

  // Coverage restriction (ADR-0025, ABY-232). Canonical enum that
  // governs WHO is allowed to drive under the policy. Required from
  // the quote stage onward because it directly affects pricing
  // (NAMED_DRIVERS / POLICYHOLDER_ONLY → −15% named discount;
  // ANY_DRIVER_25_PLUS → AAD rate; ANY_DRIVER_40_PLUS → AAD rate −7.5%)
  // and the certificate wording. Legacy quotes (pre-ABY-232) derive
  // this from `hasAdditionalDrivers` inside `MotorProductAdapter`'s
  // normalize step.
  driverRestriction: { path: 'driverRestriction', dataClassification: 'canonical', requiredAtStages: QUOTE_BIND_AND_ISSUANCE },
  // `hasAdditionalDrivers` is preserved as a separate UI/data signal
  // — meaningful only when `driverRestriction === 'NAMED_DRIVERS'`,
  // where it controls whether the named-drivers list is collected.
  // For all other `driverRestriction` values it is forced to `false`
  // by the wizard / BO controllers and the `additionalDrivers` array
  // is cleared.
  hasAdditionalDrivers: { path: 'hasAdditionalDrivers', dataClassification: 'canonical' },
  // `additionalDrivers` is conditionally required: only when
  // `driverRestriction === 'NAMED_DRIVERS' && hasAdditionalDrivers === true`.
  // That conditional lives in `validateMotorBindStage` (the stage
  // refinement), so the field itself is never field-level required —
  // otherwise the empty-array default for "no additional drivers"
  // would always fail.
  additionalDrivers: { path: 'additionalDrivers', dataClassification: 'canonical' },
  youngestDriverAge: { path: 'youngestDriverAge', dataClassification: 'shortcut', replacedBy: 'additionalDrivers' },
  otherDriversClaims: { path: 'otherDriversClaims' },
  otherDriversClaimsDetails: { path: 'otherDriversClaimsDetails' },
  otherDriversConvictions: { path: 'otherDriversConvictions' },
  otherDriversConvictionsDetails: { path: 'otherDriversConvictionsDetails' },
};

export const MOTOR_CANONICAL_FIELD_PATHS = Object.freeze(Object.keys(motorMetadataFields));

export type MotorWizardStepId = 'policy-holder' | 'vehicle-cover' | 'driving-history';

type StepValidator = (data: unknown) => Record<string, string>;

function refinementFromStepValidator(validator: StepValidator): RefinementFn {
  return (_data, ctx, extras) => {
    const errors = validator(extras.raw);
    for (const [field, message] of Object.entries(errors)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [field],
        message,
      });
    }
  };
}

export const motorValidationProfile: ValidationProfile = {
  productCode: 'MOTOR',
  fields: motorMetadataFields,
  steps: [
    {
      id: 'policy-holder',
      fields: [],
      refinements: [refinementFromStepValidator(validateWizardPolicyHolderStep)],
    },
    {
      id: 'vehicle-cover',
      fields: [],
      refinements: [refinementFromStepValidator(validateWizardVehicleCoverStep)],
    },
    {
      id: 'driving-history',
      fields: [],
      refinements: [refinementFromStepValidator(validateWizardDrivingHistoryStep)],
    },
  ],
  // Lifecycle-stage definitions sourced from the generated artefact
  // (`motorValidationContract.generated.ts`). The same lists drive the
  // BO underwriting "what is required to bind?" projection, the
  // contract-artifact generator, and `validateForContext({ stage })`.
  // Stage refinements absorb the semantics of the deleted
  // `validateUnifiedQuoteData`:
  //   - quote: per-field requireds only (rating-time gate; no
  //     acceptance / address / occupation checks yet).
  //   - bind: full QuoteSchema (Step1 + Step2 + Step3 merged) plus
  //     per-additional-driver checks.
  //   - issuance: bind refinement + the registration/VIN gate.
  // With this in place, `validateForContext` is the single canonical
  // issuance/bind validator for motor; the parallel `validateUnified-
  // QuoteData` is gone and `validationMode === 'product_schema'` no
  // longer branches the validator pipeline.
  stages: {
    quote: {
      fields: [...MOTOR_QUOTE_READY_FIELDS],
    },
    bind: {
      fields: [...MOTOR_REQUIRED_ISSUANCE_FIELDS],
      refinements: [refinementFromStepValidator(validateMotorBindStage)],
    },
    issuance: {
      fields: [...MOTOR_REQUIRED_ISSUANCE_FIELDS, 'proposer.nif', 'registrationNumber', 'vin'],
      refinements: [refinementFromStepValidator(validateMotorIssuanceStage)],
    },
  },
};

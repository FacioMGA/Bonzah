import { normalizeCabrio, normalizeMotorQuoteDataForValidation } from '@facio/products';
import { validateForContext, ValidationRegistry } from '@facio/validation/frontend';
import {
  requirednessSeverityByMode,
  schemaSeverityByMode,
  shouldIncludeFieldInBlur,
  type ValidationMode,
  type ValidationSeverity,
} from './modePolicy';
import { resolveRequiredness, type ValidationActor, type ValidationStage } from './requirednessResolver';
import { getQuestionnaireField, getQuestionnaireFields } from '@/src/shared/lib/products/questionnaire';

export type NormalizedFieldError = {
  message: string;
  severity: ValidationSeverity;
};

export type ValidateQuoteDataInput = {
  data: Record<string, unknown>;
  productType?: string;
  actor: ValidationActor;
  stage: ValidationStage;
  mode: ValidationMode;
  programId?: string;
  focusField?: string;
};

export type ValidateQuoteDataResult = {
  fieldErrors: Record<string, NormalizedFieldError>;
  isFormQuoteStageSatisfied: boolean;
  isFormBindStageSatisfied: boolean;
};

// Validation ownership note:
// Business validation rules must enter through this service boundary.
// UI pages should only pass context and render returned results.
const REQUIRED_NULLABLE_BOOLEAN_FIELDS = new Set([
  'hasClaims',
  'hasConvictions',
  'hasAdditionalDrivers',
  'modified',
  'cabrio',
  'motorcycleRidersNamed',
  'classicIsGenuine',
  'classicIsSecondaryVehicle',
]);

function hasMeaningfulValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length > 0;
  return String(value).trim().length > 0;
}

function normalizeForSchema(
  source: Record<string, unknown>,
  productType?: string,
  focusField?: string,
  _actor?: ValidationActor,
): Record<string, unknown> {
  let out = { ...source };
  if (String(productType || '').toUpperCase() === 'MOTOR') {
    out = normalizeMotorQuoteDataForValidation(out);
    // cabrio is stored as a 'Yes'/'No' select in the contract; legacy data
    // may have boolean / numeric / lower-case strings — delegate to the
    // canonical normalizer so the wizard, BO, and schema validation can
    // never disagree on what `false`/`'no'`/0 means.
    const normalizedCabrio = normalizeCabrio(out.cabrio);
    if (normalizedCabrio !== undefined) {
      out.cabrio = normalizedCabrio;
    }
    // requiredExcess: motor QuoteSchema expects a string while the BO field can hold a number.
    if (typeof out.requiredExcess === 'number') out.requiredExcess = String(out.requiredExcess);
    // PR5: refuse silent default-true for consent flags. Missing customer
    // confirmations must surface as required-field errors regardless of actor;
    // an underwriter "bypass" must be modelled as an explicit, audited UW
    // action rather than papering over the absence at validate time.
  }
  const fieldDefs = getQuestionnaireFields(productType);
  const keys = new Set<string>([
    ...fieldDefs.map((field) => field.path),
    ...(focusField ? [focusField] : []),
  ]);
  for (const key of keys) {
    if (typeof out[key] !== 'undefined') continue;
    const t = getQuestionnaireField(productType, key)?.type;
    if (t === 'multiselect') {
      out[key] = [];
      continue;
    }
    if (t === 'boolean') {
      if (REQUIRED_NULLABLE_BOOLEAN_FIELDS.has(key)) out[key] = null;
      continue;
    }
    out[key] = '';
  }
  return out;
}

function toCanonicalStage(stage: ValidationStage): 'draft' | 'pricing' | 'quote' | 'bind' | 'issuance' | null {
  if (stage === 'issue') return 'issuance';
  if (stage === 'draft' || stage === 'pricing' || stage === 'quote' || stage === 'bind') return stage;
  return null;
}

function addCanonicalProfileErrors(
  input: ValidateQuoteDataInput,
  data: Record<string, unknown>,
  target: Record<string, NormalizedFieldError>,
): void {
  const productCode = String(input.productType || '').trim().toUpperCase();
  const stage = toCanonicalStage(input.stage);
  if (!productCode || !stage || !ValidationRegistry.has(productCode)) return;

  const errors = validateForContext({
    productCode,
    stage: { kind: 'stage', id: stage },
    actor: input.actor,
    data,
    focusField: input.focusField,
  });
  const severity = schemaSeverityByMode(input.mode);
  for (const [key, message] of Object.entries(errors)) {
    if (target[key]) continue;
    if (input.mode === 'blur' && !shouldIncludeFieldInBlur({ focusField: input.focusField, candidateField: key })) {
      continue;
    }
    target[key] = { message, severity };
  }
}

export function validateQuoteData(input: ValidateQuoteDataInput): ValidateQuoteDataResult {
  const normalized = normalizeForSchema(input.data, input.productType, input.focusField, input.actor);
  const requiredness = resolveRequiredness({
    productType: input.productType,
    data: normalized,
    actor: input.actor,
    stage: input.stage,
    programId: input.programId,
  });
  const requiredSet = new Set(requiredness.requiredKeys);
  const fieldErrors: Record<string, NormalizedFieldError> = {};

  if (input.mode !== 'blur') {
    const severity = requirednessSeverityByMode(input.mode);
    const visibleSet = new Set(requiredness.visibleKeys);
    for (const key of requiredness.requiredKeys) {
      if (!visibleSet.has(key)) continue;
      if (hasMeaningfulValue(normalized[key])) continue;
      const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());
      fieldErrors[key] = { message: `${label} is required`, severity };
    }
  } else if (input.focusField) {
    // In blur mode: surface a "required" error for the focused field if it is required and empty
    const focusTop = String(input.focusField).split('.')[0];
    if (requiredSet.has(focusTop) && !hasMeaningfulValue(normalized[focusTop])) {
      const label = focusTop.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());
      if (!fieldErrors[focusTop]) {
        fieldErrors[focusTop] = { message: `${label} is required`, severity: 'error' };
      }
    }
  }

  addCanonicalProfileErrors(input, normalized, fieldErrors);

  if (input.mode === 'blur' && input.focusField) {
    const filtered: Record<string, NormalizedFieldError> = {};
    for (const [key, value] of Object.entries(fieldErrors)) {
      if (shouldIncludeFieldInBlur({ focusField: input.focusField, candidateField: key })) {
        filtered[key] = value;
      }
    }
    return {
      fieldErrors: filtered,
      isFormQuoteStageSatisfied: computeReadiness(normalized, input.productType, input.actor, 'quote'),
      isFormBindStageSatisfied: computeReadiness(normalized, input.productType, input.actor, 'bind'),
    };
  }

  return {
    fieldErrors,
    isFormQuoteStageSatisfied: computeReadiness(normalized, input.productType, input.actor, 'quote'),
    isFormBindStageSatisfied: computeReadiness(normalized, input.productType, input.actor, 'bind'),
  };
}

function computeReadiness(data: Record<string, unknown>, productType: string | undefined, actor: ValidationActor, stage: ValidationStage): boolean {
  const { requiredKeys, visibleKeys } = resolveRequiredness({ productType, data, actor, stage });
  const visibleSet = new Set(visibleKeys);
  return requiredKeys
    .filter((key) => visibleSet.has(key))
    .every((key) => hasMeaningfulValue(data[key]));
}


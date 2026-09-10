/**
 * Questionnaire metadata selectors derived from a product's
 * `ValidationProfile` + `ProductManifest`.
 *
 * This file is the consolidated replacement for the deprecated Gen1
 * questionnaire engine + selectors that lived under
 * `frontend/src/modules/policies/questionnaire/`. After Phase 1 of the
 * Questionnaire Path Consolidation:
 *
 *   - Per-field metadata (requiredAtStages / requiredAtByActor / audience /
 *     dataClassification / replacedBy) lives on `FieldContract` inside
 *     each product's `ValidationProfile` (the single source of truth).
 *   - UI visibility rules (`visibleWhenKey`/`visibleWhenValue`) and
 *     conditional requiredness (`requiredWhenKey`/`requiredWhenValue`)
 *     live on `FieldDef` inside each product's `ProductManifest`
 *     questionnaire sections.
 *
 * The functions below combine those two surfaces to answer the questions
 * the BO Underwriting tab and the program questionnaire surfaces need to
 * make ("which fields are required at this stage for this actor?",
 * "given current answers, which fields should we render?", etc.) without
 * any product-specific shimming or fallback.
 *
 * Direction of dependencies:
 *   product code -> ValidationRegistry / ProductRegistry -> these helpers
 *   These helpers are READ-ONLY consumers of the registries; they
 *   intentionally know nothing about Motor / Travel / Home specifics.
 */

import { ValidationRegistry } from '@facio/validation/frontend';
import type {
  FieldContract,
  LifecycleStageId,
  ValidationActor,
} from '@facio/validation';
import type { FieldDef, ProductManifest, SelectOption } from '@facio/products';
import {
  getProductManifest,
  getQuestionnaireField,
  getQuestionnaireFields,
  getValueAtPath,
  isFieldRequiredForData,
  isFieldVisibleForData,
} from './questionnaire';

export type QuestionnaireSelectorContext = {
  actor: ValidationActor;
  stage: LifecycleStageId;
};

type UnknownRecord = Record<string, unknown>;

function getFieldContract(
  productType: string | null | undefined,
  fieldKey: string,
): FieldContract | undefined {
  const profile = ValidationRegistry.get(String(productType || ''));
  return profile?.fields[fieldKey];
}

/**
 * Is this field required for the given (actor, stage)?
 *
 * Combines:
 *   - `FieldContract.requiredAtStages` (stage-driven, all actors)
 *   - `FieldContract.requiredAtByActor` (per-actor stage list)
 *   - `FieldContract.required === true` (always required)
 *
 * Audience filter is NOT applied here — visibility for an actor is a
 * separate concern; see `isFieldVisibleForActor`.
 */
export function isFieldRequiredForContext(
  productType: string | null | undefined,
  fieldKey: string,
  context: QuestionnaireSelectorContext,
): boolean {
  const contract = getFieldContract(productType, fieldKey);
  if (!contract) return false;
  if (contract.required === true) return true;
  const stageList = contract.requiredAtStages || [];
  if (stageList.includes(context.stage)) return true;
  const byActor = contract.requiredAtByActor;
  if (!byActor) return false;
  if (context.actor === 'server') {
    return Object.values(byActor).some((stages) => stages?.includes(context.stage));
  }
  const stages = byActor[context.actor];
  return Boolean(stages && stages.includes(context.stage));
}

/**
 * Audience visibility for a single actor. Mirrors the runner's
 * `isFieldVisibleToActor` so this helper agrees with what
 * `validateForContext` applies during validation.
 */
export function isFieldVisibleForActor(
  productType: string | null | undefined,
  fieldKey: string,
  actor: ValidationActor,
): boolean {
  const contract = getFieldContract(productType, fieldKey);
  const audience = contract?.audience || 'all';
  if (audience === 'all') return true;
  if (actor === 'server') return true;
  return audience === actor;
}

/**
 * Conditional UI visibility from the manifest's `visibleWhenKey` /
 * `visibleWhenValue`. Audience visibility is checked first; if the
 * actor cannot see the field, no further evaluation happens.
 */
export function isFieldVisibleForContext(
  productType: string | null | undefined,
  fieldKey: string,
  context: QuestionnaireSelectorContext,
  answers: UnknownRecord,
): boolean {
  if (!isFieldVisibleForActor(productType, fieldKey, context.actor)) return false;
  const field = getQuestionnaireField(productType, fieldKey);
  return isFieldVisibleForData(field, answers);
}

/**
 * Conditional requiredness combining manifest UI rules with profile
 * stage/actor rules. A field is required for save iff:
 *
 *   1. The manifest declares it required for the current data shape, OR
 *   2. The profile declares it required for (actor, stage).
 */
export function isFieldEffectivelyRequired(
  productType: string | null | undefined,
  fieldKey: string,
  context: QuestionnaireSelectorContext,
  answers: UnknownRecord,
): boolean {
  const field = getQuestionnaireField(productType, fieldKey);
  if (isFieldRequiredForData(field, answers)) return true;
  return isFieldRequiredForContext(productType, fieldKey, context);
}

/**
 * Returns every field-key the product's profile declares, ordered by
 * the manifest's questionnaire-section order (so iteration produces the
 * same UI order callers used to get from Gen1).
 *
 * Profile-only entries (no manifest section, e.g. customer-only
 * declarations) are appended at the end in profile-declaration order.
 */
function listProductFieldKeys(productType: string | null | undefined): string[] {
  const profile = ValidationRegistry.get(String(productType || ''));
  if (!profile) return [];
  const manifestKeys = getQuestionnaireFields(productType).map((field) => field.path);
  const seen = new Set(manifestKeys);
  const profileOnlyKeys = Object.keys(profile.fields).filter((key) => !seen.has(key));
  return [...manifestKeys, ...profileOnlyKeys];
}

/**
 * All field keys required for (actor, stage) given the current answers.
 *
 * Replaces Gen1 `selectRequiredQuestionKeys`.
 */
export function selectRequiredFieldKeys(
  productType: string | null | undefined,
  context: QuestionnaireSelectorContext,
  answers: UnknownRecord = {},
): string[] {
  return listProductFieldKeys(productType).filter((key) => {
    if (!isFieldVisibleForContext(productType, key, context, answers)) return false;
    return isFieldEffectivelyRequired(productType, key, context, answers);
  });
}

/**
 * All field keys visible for (actor, stage) given the current answers.
 *
 * Replaces Gen1 `selectVisibleQuestionKeys`.
 */
export function selectVisibleFieldKeys(
  productType: string | null | undefined,
  context: QuestionnaireSelectorContext,
  answers: UnknownRecord = {},
): string[] {
  return listProductFieldKeys(productType).filter((key) =>
    isFieldVisibleForContext(productType, key, context, answers),
  );
}

/**
 * Return the field's manifest definition merged with its profile contract,
 * so callers that need both UI metadata (label, type, options) and
 * validation metadata (required-at-stages, audience) can read one object.
 *
 * Replaces Gen1 `selectQuestionContractByKey()[key]`.
 */
export type QuestionnaireFieldView = {
  path: string;
  manifest: FieldDef | null;
  contract: FieldContract | null;
};

export function selectQuestionnaireField(
  productType: string | null | undefined,
  fieldKey: string,
): QuestionnaireFieldView {
  return {
    path: fieldKey,
    manifest: getQuestionnaireField(productType, fieldKey),
    contract: getFieldContract(productType, fieldKey) ?? null,
  };
}

/**
 * Convenience: just the select options for a manifest-declared select
 * field. Replaces Gen1 `getQuestionnaireSelectOptions(key)` (which read
 * from the contract) with a manifest-driven equivalent. Callers should
 * prefer this over reading options directly from the contract.
 */
export function selectQuestionnaireFieldOptions(
  productType: string | null | undefined,
  fieldKey: string,
): SelectOption[] {
  return getQuestionnaireField(productType, fieldKey)?.options ?? [];
}

/**
 * Per-field metadata view consumed by the BO Underwriting tab renderers.
 * Combines the validation profile's `FieldContract` (the single source of
 * truth for required-at-stages / audience / replacedBy) with manifest-only
 * UI hints (`searchable`, `visibleWhen`).
 *
 * Replaces Gen1's `selectQuestionContractByKey()`.
 */
type VisibleWhenRule = {
  field: string;
  equals?: string | number | boolean;
  oneOf?: Array<string | number | boolean>;
  includes?: string;
  truthy?: boolean;
};

export type QuestionnaireFieldMeta = FieldContract & {
  searchable?: boolean;
  visibleWhen?: VisibleWhenRule | VisibleWhenRule[];
};

export function selectQuestionnaireFieldMetaByKey(
  productType: string | null | undefined,
): Record<string, QuestionnaireFieldMeta> {
  const profile = ValidationRegistry.get(String(productType || ''));
  if (!profile) return {};
  const out: Record<string, QuestionnaireFieldMeta> = {};
  for (const [key, contract] of Object.entries(profile.fields)) {
    const manifestField = getQuestionnaireField(productType, key);
    const meta: QuestionnaireFieldMeta = { ...contract };
    if (manifestField?.searchable === true) meta.searchable = true;
    if (manifestField?.visibleWhenKey) {
      meta.visibleWhen = {
        field: manifestField.visibleWhenKey,
        equals: manifestField.visibleWhenValue as string | number | boolean | undefined,
      };
    }
    out[key] = meta;
  }
  return out;
}

/**
 * Inspect a single manifest field's value within `answers` to mirror the
 * Gen1 "is this question filled?" semantics. Used by completeness counts.
 */
export function getAnsweredValue(
  productType: string | null | undefined,
  fieldKey: string,
  answers: UnknownRecord,
): unknown {
  const field = getQuestionnaireField(productType, fieldKey);
  return getValueAtPath(answers, field?.path || fieldKey);
}

/**
 * Re-export `ProductManifest` so consumers can keep `import type` lists
 * tight when they only need the manifest plus these selectors.
 */
export type { ProductManifest };
export { getProductManifest };

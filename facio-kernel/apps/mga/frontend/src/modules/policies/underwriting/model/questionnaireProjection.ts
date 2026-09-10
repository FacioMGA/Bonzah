/**
 * Underwriting-tab projection helpers.
 *
 * After Phase 1 of the consolidation, these helpers consume:
 *   - Per-field validation contracts from the product's `ValidationProfile`
 *     (audience, requiredAtStages, requiredAtByActor, replacedBy).
 *   - UI visibility metadata declared inline on each `PartQuestion`
 *     (manifest-derived) or via the optional `visibleWhenOverride`.
 *
 * No imports from the deprecated `frontend/src/modules/policies/questionnaire/`
 * tree exist any more.
 */

import { NATIONALITY_PAYLOAD_PATH } from '@facio/validation';
import type { LifecycleStageId, ValidationActor } from '@facio/validation';
import { countries } from '@facio/products';
import { isSourceQuestionScopeVisible } from '../../config/sourceQuestionScope';

type SelectOption = { value: string; label: string };
type DynamicOption = { value?: string; label?: string };
type QuestionOption = string | SelectOption;

/**
 * Canonical-contract option fallbacks for the BO underwriting renderer.
 *
 * Manifests intentionally do NOT inline the country list for shared
 * fields like `proposer.nationality` — that would duplicate the
 * canonical contract in `packages/validation/src/nationality/contract.ts`
 * and is forbidden by `tools/quality/check-contracts-product-
 * consistency.mjs` (rule #6) and ADR-0010.
 *
 * Instead, when a manifest declares a `select`/`searchable` field that
 * matches a canonical payload path and ships no inline options, the
 * renderer sources the option set from the canonical contract here.
 * One source of truth, bound at the rendering boundary, used by every
 * product that exposes the field.
 */
const CANONICAL_FIELD_OPTIONS: Record<string, readonly string[]> = {
  [NATIONALITY_PAYLOAD_PATH]: countries,
  'proposer.domicileCountry': countries,
  'proposer.address.country': countries,
};

export type VisibleWhenRule = {
  sourceComparison?: { operator: string; value: string };
  field: string;
  equals?: string | number | boolean;
  oneOf?: Array<string | number | boolean>;
  includes?: string;
  truthy?: boolean;
};

/**
 * Minimum field metadata the renderers consume. Compatible with the
 * absorbed `FieldContract` shape from the validation profile, so callers
 * can pass an entry from `motorValidationProfile.fields[key]` directly.
 */
export type RendererFieldMeta = {
  requiredAtStages?: LifecycleStageId[];
  requiredAtByActor?: Partial<Record<ValidationActor, LifecycleStageId[]>>;
  audience?: 'all' | 'customer' | 'underwriter';
  replacedBy?: string;
  visibleWhen?: VisibleWhenRule | VisibleWhenRule[];
  sourceScope?: unknown;
  sourceScopeError?: unknown;
};

export type RendererContext = {
  actor: ValidationActor;
  stage: LifecycleStageId;
};

function normalizeQuestionnaireSelectOptions(options: QuestionOption[] = []): SelectOption[] {
  return options
    .map((option) => {
      if (typeof option === 'string') {
        const value = option.trim();
        return value ? { value, label: value } : null;
      }
      const value = String(option.value || '').trim();
      const label = String(option.label || option.value || '').trim();
      return value ? { value, label: label || value } : null;
    })
    .filter((option): option is SelectOption => Boolean(option));
}

function normalizeComparable(value: unknown): string | number | boolean {
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  const s = String(value ?? '').trim();
  if (s.toLowerCase() === 'true') return true;
  if (s.toLowerCase() === 'false') return false;
  const n = Number(s);
  if (s !== '' && Number.isFinite(n)) return n;
  return s;
}

function readAnswer(answers: Record<string, unknown>, path: string): unknown {
  if (Object.prototype.hasOwnProperty.call(answers, path)) return answers[path];
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[segment];
  }, answers);
}

function evaluateVisibleWhenRule(rule: VisibleWhenRule, answers: Record<string, unknown>): boolean {
  const current = readAnswer(answers, rule.field);
  if (rule.sourceComparison) {
    const { operator, value } = rule.sourceComparison;
    const missing = current === undefined || current === null || current === '' || (Array.isArray(current) && !current.length);
    if (operator === '*') return !missing;
    if (missing) return true; // Unknown remains visible until the controlling answer is supplied.
    const normalize = (answer: unknown) => {
      if (answer === true || (typeof answer === 'string' && /^(yes|true)$/i.test(answer))) return 'true';
      if (answer === false || (typeof answer === 'string' && /^(no|false)$/i.test(answer))) return 'false';
      return typeof answer === 'string' || typeof answer === 'number' ? String(answer) : '';
    };
    const left = normalize(current), right = normalize(value);
    if (operator === '=') return left === right;
    if (operator === '!=') return left !== right;
    if (!/^-?\d+(?:\.\d+)?$/.test(left) || !/^-?\d+(?:\.\d+)?$/.test(right)) return true;
    const a = Number(left), b = Number(right); if (!Number.isFinite(a) || !Number.isFinite(b)) return true;
    return operator === '>' ? a > b : operator === '>=' ? a >= b : operator === '<' ? a < b : operator === '<=' ? a <= b : true;
  }
  if (Object.prototype.hasOwnProperty.call(rule, 'equals')) {
    return normalizeComparable(current) === normalizeComparable(rule.equals);
  }
  if (Array.isArray(rule.oneOf) && rule.oneOf.length > 0) {
    const normalizedCurrent = normalizeComparable(current);
    return rule.oneOf.some((entry) => normalizeComparable(entry) === normalizedCurrent);
  }
  if (typeof rule.includes === 'string') {
    if (Array.isArray(current)) return current.map((v) => String(v)).includes(rule.includes);
    return String(current ?? '').includes(rule.includes);
  }
  if (rule.truthy === true) {
    if (typeof current === 'boolean') return current;
    return String(current ?? '').trim().length > 0;
  }
  return true;
}

function isVisibleToActor(meta: RendererFieldMeta | undefined, actor: ValidationActor): boolean {
  const audience = meta?.audience || 'all';
  if (audience === 'all') return true;
  if (actor === 'server') return true;
  return audience === actor;
}

export function isQuestionVisibleForUnderwriting(args: {
  fieldKey: string;
  contractMeta: RendererFieldMeta | undefined;
  visibleWhenOverride: unknown;
  sourceScope?: unknown;
  sourceScopeError?: unknown;
  binderProductAuthorityId?: string;
  context: RendererContext;
  quoteData: Record<string, unknown>;
  dirtyFields: Record<string, unknown>;
}): boolean {
  const {
    contractMeta,
    visibleWhenOverride,
    context,
    quoteData,
    dirtyFields,
  } = args;

  if (!isVisibleToActor(contractMeta, context.actor)) return false;
  if (args.sourceScopeError !== undefined || contractMeta?.sourceScopeError !== undefined) return false;
  const answers: Record<string, unknown> = { ...quoteData, ...dirtyFields };
  if (!isSourceQuestionScopeVisible(
    args.sourceScope === undefined ? contractMeta?.sourceScope : args.sourceScope,
    answers,
    args.binderProductAuthorityId,
  )) return false;

  const overrideRule = visibleWhenOverride as VisibleWhenRule | VisibleWhenRule[] | undefined;
  const rules = overrideRule ? (Array.isArray(overrideRule) ? overrideRule : [overrideRule])
    : contractMeta?.visibleWhen
      ? (Array.isArray(contractMeta.visibleWhen) ? contractMeta.visibleWhen : [contractMeta.visibleWhen])
      : [];

  if (rules.length === 0) return true;

  return rules.every((rule) => evaluateVisibleWhenRule(rule, answers));
}

export function resolveQuestionSelectOptions(args: {
  fieldKey: string;
  currentValue: unknown;
  questionOptions: QuestionOption[];
  makeOptions: DynamicOption[];
  modelOptions: DynamicOption[];
}): { resolvedOptions: string[]; resolvedSelectOptions: SelectOption[]; hasResolvedOptions: boolean } {
  const { fieldKey, currentValue, questionOptions, makeOptions, modelOptions } = args;
  const normalizedQuestionOptions = normalizeQuestionnaireSelectOptions(questionOptions);
  const current = (() => {
    const raw = String(currentValue ?? '').trim();
    const yesNoOptions = normalizedQuestionOptions.some((option) => option.value === 'Yes')
      && normalizedQuestionOptions.some((option) => option.value === 'No');
    if (yesNoOptions) {
      if (currentValue === true || raw.toLowerCase() === 'true') return 'Yes';
      if (currentValue === false || raw.toLowerCase() === 'false') return 'No';
    }
    return raw;
  })();

  const dynamicSelectOptions = (() => {
    if (fieldKey === 'make') return makeOptions.map((opt) => ({ value: String(opt.value || '').trim(), label: String(opt.label || opt.value || '').trim() })).filter((opt) => opt.value);
    if (fieldKey === 'model') return modelOptions.map((opt) => ({ value: String(opt.value || '').trim(), label: String(opt.label || opt.value || '').trim() })).filter((opt) => opt.value);
    if (normalizedQuestionOptions.length === 0) {
      const canonical = CANONICAL_FIELD_OPTIONS[fieldKey];
      if (canonical) return canonical.map((value) => ({ value, label: value }));
    }
    return normalizedQuestionOptions;
  })();

  const resolvedSelectOptions = current && !dynamicSelectOptions.some((opt) => opt.value === current)
    ? [{ value: current, label: current }, ...dynamicSelectOptions]
    : dynamicSelectOptions;

  const resolvedOptions = resolvedSelectOptions.map((opt) => opt.value);

  return {
    resolvedOptions,
    resolvedSelectOptions,
    hasResolvedOptions: resolvedSelectOptions.length > 0,
  };
}

export function hasReplacementQuestionData(args: {
  replacementKey: string;
  quoteData: Record<string, unknown>;
  dirtyFields: Record<string, unknown>;
  normalizeAdditionalDrivers: (value: unknown) => Array<unknown>;
}): boolean {
  const { replacementKey, quoteData, dirtyFields, normalizeAdditionalDrivers } = args;
  const replacementValue = dirtyFields[replacementKey] ?? quoteData[replacementKey];
  if (replacementKey === 'additionalDrivers') {
    return normalizeAdditionalDrivers(replacementValue).length > 0;
  }
  if (Array.isArray(replacementValue)) return replacementValue.length > 0;
  if (typeof replacementValue === 'boolean') return replacementValue;
  if (typeof replacementValue === 'number') return Number.isFinite(replacementValue) && replacementValue > 0;
  return String(replacementValue ?? '').trim().length > 0;
}

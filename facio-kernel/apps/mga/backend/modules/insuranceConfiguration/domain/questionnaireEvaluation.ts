import type { JsonObject } from '../../../platform/types/json.js';
import { InsuranceConfigurationError, parseQuestionCondition, readInsuranceConfiguration } from './runtimeConfiguration.js';
import { binderScopesSchema, compileQuestionScope, inheritQuestionGroupScopes, matchesQuestionScope } from './questionScopes.js';
import { ambiguousQuestionAnswerKeys } from './questionIdentities.js';

export type QuestionFinding = { key: string; message: string };
export type QuestionEvaluationContext = { questionnaire: JsonObject; binderProductAuthorityId: string };
function record(value: unknown): Record<string, unknown> | null { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function readPath(value: unknown, path: string): unknown {
  const root = record(value);
  if (root && Object.hasOwn(root, path)) return root[path];
  return path.split('.').reduce<unknown>((next, key) => {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) return undefined;
    const object = record(next); return object && Object.hasOwn(object, key) ? object[key] : undefined;
  }, value);
}
const empty = (value: unknown) => value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
function normalized(value: unknown): string {
  if (value === true || (typeof value === 'string' && /^(yes|true)$/i.test(value))) return 'true';
  if (value === false || (typeof value === 'string' && /^(no|false)$/i.test(value))) return 'false';
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

/** Pure validation of the same authored questions emitted to programme journeys. */
function analyzeConfiguredQuestions(workflow: JsonObject, answers: unknown, today = new Date().toISOString().slice(0, 10), context?: QuestionEvaluationContext): { findings: QuestionFinding[]; effectiveAnswers: Record<string, unknown> } {
  const config = readInsuranceConfiguration(workflow);
  if (!config) return { findings: [], effectiveAnswers: {} };
  const scoped = context?.questionnaire.sourceCompilerVersion === 4;
  const product = scoped ? inheritQuestionGroupScopes(config.product) : config.product;
  const questions = product.details.proposalQuestionGroups.flatMap((group) => group.questions);
  // Reserve aliases for all questions before filtering. A hidden question's key must never be supplied by a visible neighbour.
  const ambiguous = ambiguousQuestionAnswerKeys(questions);
  if (ambiguous.length) return { findings: ambiguous.map((key) => ({ key, message: 'Retained question IDs/slugs collide; review a corrected programme definition before pricing.' })), effectiveAnswers: {} };
  const scopeVisibility = new Map<string, boolean>();
  if (scoped) {
    try {
      if (!context.binderProductAuthorityId || typeof context.questionnaire.sourceScopeProductType !== 'string') throw new Error('Scoped questions require the retained programme product and trusted binder authority.');
      const compilation = { productType: context.questionnaire.sourceScopeProductType, binders: binderScopesSchema.parse(context.questionnaire.sourceScopeBindings) };
      for (const question of questions) {
        const scope = compileQuestionScope(product, question, compilation);
        scopeVisibility.set(question.slug, !scope || matchesQuestionScope(scope, answers, context.binderProductAuthorityId));
      }
    } catch (error) { return { findings: [{ key: 'sourceScope', message: error instanceof Error ? error.message : 'Invalid retained question scopes.' }], effectiveAnswers: {} }; }
  }
  const byKey = new Map(questions.map((question) => [question.slug, question]));
  const visibility = new Map<string, boolean | null>();
  const evaluateVisibility = (key: string, visiting = new Set<string>()): boolean | null => {
    if (visibility.has(key)) return visibility.get(key)!;
    if (visiting.has(key)) return null;
    const question = byKey.get(key); if (!question) return null;
    if (scopeVisibility.get(key) === false) { visibility.set(key, false); return false; }
    if (!question.openIf) { visibility.set(key, true); return true; }
    visiting.add(key);
    const condition = parseQuestionCondition(question.openIf);
    const parentVisibility = evaluateVisibility(condition.key, visiting);
    const actual = parentVisibility === true ? readPath(answers, condition.key) : undefined;
    let result: boolean | null = null;
    if (parentVisibility === false) result = false;
    else if (condition.operator === '*') result = !empty(actual);
    else if (!empty(actual)) {
      const left = normalized(actual), right = normalized(condition.value);
      if (condition.operator === '=') result = left === right;
      else if (condition.operator === '!=') result = left !== right;
      else if (/^-?\d+(?:\.\d+)?$/.test(left) && /^-?\d+(?:\.\d+)?$/.test(right)) {
        const a = Number(left), b = Number(right);
        if (Number.isFinite(a) && Number.isFinite(b)) result = condition.operator === '>' ? a > b : condition.operator === '>=' ? a >= b : condition.operator === '<' ? a < b : a <= b;
      }
    }
    visibility.set(key, result); return result;
  };
  const findings: QuestionFinding[] = [];
  const effectiveAnswers: Record<string, unknown> = {};
  for (const question of questions) {
    const key = question.slug, value = readPath(answers, key), visible = evaluateVisibility(key);
    const add = (message: string) => findings.push({ key, message });
    if (visible === false || question.answerType === 'Instruction' || question.settings?.informationalOnly) continue;
    if (visible === null) { add('Conditional question cannot be evaluated until its controlling answer is valid.'); continue; }
    if (empty(value)) { if (question.required) add(`${question.field} is required.`); continue; }
    effectiveAnswers[question.id] = effectiveAnswers[question.slug] = value;
    const settings = question.settings ?? {};
    if (question.answerType === 'Number' || question.answerType === 'Currency ($)') {
      const numeric = typeof value === 'number' ? value : typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value) ? Number(value) : NaN;
      if (!Number.isFinite(numeric)) { add('A finite number is required.'); continue; }
      if (settings.minNumber !== undefined && numeric < settings.minNumber) add(`Minimum value is ${settings.minNumber}.`);
      if (settings.maxNumber !== undefined && numeric > settings.maxNumber) add(`Maximum value is ${settings.maxNumber}.`);
      if (settings.decimalPlaces !== undefined && String(value).split('.')[1]?.length > settings.decimalPlaces) add(`At most ${settings.decimalPlaces} decimal places are permitted.`);
    } else if (question.answerType === 'Boolean' || question.answerType === 'Dropdown (Yes/No)') {
      if (!['true', 'false'].includes(normalized(value))) add('A Yes/No answer is required.');
    } else if (question.answerType === 'Multi-select') {
      if (!Array.isArray(value) || value.some((option) => typeof option !== 'string' || !question.options?.includes(option)) || new Set(value).size !== value.length) add('Select distinct configured options.');
      else {
        if (settings.minSelections !== undefined && value.length < settings.minSelections) add(`Select at least ${settings.minSelections} options.`);
        if (settings.maxSelections !== undefined && value.length > settings.maxSelections) add(`Select at most ${settings.maxSelections} options.`);
      }
    } else if (question.answerType === 'Dropdown' || question.answerType === 'Radio (single choice)') {
      if (typeof value !== 'string' || !question.options?.includes(value)) add('Select one of the configured options.');
    } else if (question.answerType === 'Date') {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) add('A real ISO calendar date is required.');
      else {
        const minimum = settings.minDate === 'today' ? today : settings.minDate;
        const maximum = settings.maxDate === 'today' ? today : settings.maxDate;
        if (minimum && value < minimum) add(`Date cannot precede ${minimum}.`);
        if (maximum && value > maximum) add(`Date cannot follow ${maximum}.`);
      }
    } else if (typeof value !== 'string') add('A text answer is required.');
    if (typeof value === 'string') {
      if (settings.minLength !== undefined && value.length < settings.minLength) add(`At least ${settings.minLength} characters are required.`);
      if (settings.maxLength !== undefined && value.length > settings.maxLength) add(`At most ${settings.maxLength} characters are permitted.`);
    }
  }
  return { findings, effectiveAnswers };
}

export function evaluateConfiguredQuestions(workflow: JsonObject, answers: unknown, today?: string, context?: QuestionEvaluationContext): QuestionFinding[] { return analyzeConfiguredQuestions(workflow, answers, today, context).findings; }

/** Pricing sees only authored, visible, valid answers. Hidden stale values cannot affect rates. */
export function configuredPricingAnswers(workflow: JsonObject, answers: unknown, context?: QuestionEvaluationContext): Record<string, unknown> {
  const result = analyzeConfiguredQuestions(workflow, answers, undefined, context);
  if (result.findings.length) throw new InsuranceConfigurationError(result.findings.map((finding) => `${finding.key}: ${finding.message}`).join(' '));
  return result.effectiveAnswers;
}

export function assertConfiguredQuestions(workflow: JsonObject, answers: unknown, context?: QuestionEvaluationContext): void {
  const findings = evaluateConfiguredQuestions(workflow, answers, undefined, context);
  if (findings.length) throw new InsuranceConfigurationError(findings.map((finding) => `${finding.key}: ${finding.message}`).join(' '));
}

import { asRecord } from '@/src/shared/lib/record';
import type { LifecycleStageId } from '@facio/validation';

export type QuestionnaireQuestionType =
  | 'text'
  | 'date'
  | 'boolean'
  | 'number'
  | 'currency'
  | 'textarea'
  | 'paragraph'
  | 'select'
  | 'multiselect'
  | 'list';

export type QuestionnaireVisibleWhenRule = {
  sourceComparison?: { operator: string; value: string };
  field: string;
  equals?: string | number | boolean;
  oneOf?: Array<string | number | boolean>;
  includes?: string;
  truthy?: boolean;
};

export type QuestionnaireQuestion = {
  label: string;
  key: string;
  type?: QuestionnaireQuestionType;
  /** Exact plain text retained in the published definition. Never interpreted as HTML. */
  body?: string;
  options?: Array<string | { value: string; label: string }>;
  searchable?: boolean;
  visibleWhen?: QuestionnaireVisibleWhenRule | QuestionnaireVisibleWhenRule[];
  /** Retain even malformed metadata so the scope projection can fail closed. */
  sourceScope?: unknown;
  sourceScopeError?: unknown;
  visibility?: string;
  dataClassification?: string;
  replacedBy?: string;
  requiredAtStages?: LifecycleStageId[];
};

export type QuestionnaireSection = {
  id?: string;
  title: string;
  questions: QuestionnaireQuestion[];
};

function normalizeQuestionType(value: unknown): QuestionnaireQuestionType | undefined {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return undefined;
  if (raw === 'text' || raw === 'date' || raw === 'boolean' || raw === 'number' || raw === 'currency' || raw === 'textarea' || raw === 'paragraph' || raw === 'select' || raw === 'multiselect' || raw === 'list') {
    return raw;
  }
  return undefined;
}

function normalizeVisibleWhen(value: unknown): QuestionnaireQuestion['visibleWhen'] | undefined {
  const normalizeRule = (rule: unknown) => {
    const row = asRecord(rule);
    const field = String(row.field || '').trim();
    if (!field) return null;
    const out: QuestionnaireVisibleWhenRule = { field };
    const comparison = asRecord(row.sourceComparison);
    if (['=', '!=', '>', '>=', '<', '<=', '*'].includes(String(comparison.operator)) && typeof comparison.value === 'string') out.sourceComparison = { operator: String(comparison.operator), value: comparison.value };
    if (typeof row.equals !== 'undefined') out.equals = row.equals as string | number | boolean;
    if (Array.isArray(row.oneOf)) out.oneOf = row.oneOf.filter((v): v is string | number | boolean => ['string', 'number', 'boolean'].includes(typeof v));
    if (typeof row.includes === 'string' && row.includes.trim()) out.includes = row.includes.trim();
    if (row.truthy === true) out.truthy = true;
    return out;
  };
  if (Array.isArray(value)) {
    const rules = value.map(normalizeRule).filter((r): r is NonNullable<ReturnType<typeof normalizeRule>> => Boolean(r));
    return rules.length ? rules : undefined;
  }
  const single = normalizeRule(value);
  return single || undefined;
}

function normalizeQuestion(item: unknown): QuestionnaireQuestion | null {
  const row = asRecord(item);
  const label = String(row.label || row.question || row.title || '').trim();
  const key = String(row.key || row.fieldKey || row.slug || '').trim();
  if (!label || !key) return null;
  const options = Array.isArray(row.options)
    ? row.options
      .map((opt) => {
        if (typeof opt === 'string' || typeof opt === 'number') {
          const value = String(opt).trim();
          return value || null;
        }
        const rec = asRecord(opt);
        const value = String(rec.value || rec.label || '').trim();
        const label = String(rec.label || rec.value || '').trim();
        return value
          ? (label && label !== value ? { value, label } : value)
          : null;
      })
      .filter((opt): opt is string | { value: string; label: string } => Boolean(opt))
    : undefined;
  const normalizedType = normalizeQuestionType(row.type || row.inputType);
  const normalized: QuestionnaireQuestion = {
    label,
    key,
    type: normalizedType,
    ...(normalizedType === 'paragraph' && typeof row.body === 'string' ? { body: row.body } : {}),
    options: options && options.length ? options : undefined,
    searchable: row.searchable === true ? true : undefined,
    visibleWhen: normalizeVisibleWhen(row.visibleWhen),
    ...(Object.prototype.hasOwnProperty.call(row, 'sourceScope') ? { sourceScope: row.sourceScope } : {}),
    ...(Object.prototype.hasOwnProperty.call(row, 'sourceScopeError') ? { sourceScopeError: row.sourceScopeError } : {}),
    visibility: typeof row.visibility === 'string' && row.visibility.trim() ? row.visibility.trim() : undefined,
    dataClassification: typeof row.dataClassification === 'string' && row.dataClassification.trim() ? row.dataClassification.trim() : undefined,
    replacedBy: typeof row.replacedBy === 'string' && row.replacedBy.trim() ? row.replacedBy.trim() : undefined,
    requiredAtStages: Array.isArray(row.requiredAtStages)
      ? row.requiredAtStages.filter((stage): stage is LifecycleStageId => typeof stage === 'string' && stage.trim().length > 0) as LifecycleStageId[]
      : undefined,
  };
  return normalized;
}

function normalizeSection(item: unknown): QuestionnaireSection | null {
  const row = asRecord(item);
  const id = String(row.id || row.key || '').trim();
  const title = String(row.title || row.label || row.name || '').trim();
  const rawQuestions = Array.isArray(row.questions) ? row.questions : [];
  const questions = rawQuestions.map((question) => normalizeQuestion(question)).filter((q): q is QuestionnaireQuestion => Boolean(q));
  if (!title || !questions.length) return null;
  return { ...(id ? { id } : {}), title, questions };
}

type QuestionnaireContext = { actor: 'customer' | 'underwriter'; stage?: string };

function isQuestionVisibleForActor(question: QuestionnaireQuestion, actor: QuestionnaireContext['actor']): boolean {
  const visibility = String(question.visibility || 'all').trim().toLowerCase();
  if (!visibility || visibility === 'all') return true;
  if (visibility === actor) return true;
  return visibility.includes(actor);
}

function filterQuestionsByContext(sections: QuestionnaireSection[], context?: QuestionnaireContext): QuestionnaireSection[] {
  if (!context) return sections;
  return sections
    .map((section) => ({
      ...section,
      questions: section.questions.filter((question) =>
        isQuestionVisibleForActor(question, context.actor)
      ),
    }))
    .filter((section) => section.questions.length > 0);
}

function orderSectionsForContext(sections: QuestionnaireSection[], context?: QuestionnaireContext): QuestionnaireSection[] {
  if (context?.actor !== 'underwriter') return sections;
  const policyHolderIndex = sections.findIndex((section) => {
    const id = String(section.id || '').trim().toLowerCase();
    const title = String(section.title || '').trim().toLowerCase();
    return id === 'policy-holder'
      || title.includes('policy holder')
      || title.includes('your details')
      || section.questions.some((question) => String(question.key || '').startsWith('proposer.'));
  });
  if (policyHolderIndex <= 0) return sections;
  return [
    sections[policyHolderIndex],
    ...sections.slice(0, policyHolderIndex),
    ...sections.slice(policyHolderIndex + 1),
  ];
}

/**
 * The published programme definition is the only source of questionnaire
 * behaviour. Product manifests describe engine semantics, but must never fill
 * a missing programme question, label, option, or visibility rule at runtime.
 */
export function resolveProgramQuestionnaire(programmeDefinition: unknown, context?: QuestionnaireContext): QuestionnaireSection[] {
  const definition = asRecord(programmeDefinition);
  if (!String(definition.id || '').trim()) return [];
  const questionnaire = asRecord(definition.questionnaire);
  const sections = Array.isArray(questionnaire.sections) ? questionnaire.sections : [];
  const parsed = sections
    .map((section) => normalizeSection(section))
    .filter((section): section is QuestionnaireSection => Boolean(section));
  return parsed.length > 0
    ? orderSectionsForContext(filterQuestionsByContext(parsed, context), context)
    : [];
}

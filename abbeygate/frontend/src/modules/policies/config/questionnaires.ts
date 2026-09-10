import { asRecord } from '@/src/shared/lib/record';
import { ProductRegistry } from '@/src/shared/lib/products';
import { getQuestionnaireField } from '@/src/shared/lib/products/questionnaire';
import type { LifecycleStageId } from '@facio/validation';

export type QuestionnaireQuestionType =
  | 'date'
  | 'boolean'
  | 'number'
  | 'currency'
  | 'textarea'
  | 'select'
  | 'multiselect'
  | 'list';

export type QuestionnaireVisibleWhenRule = {
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
  options?: Array<string | { value: string; label: string }>;
  searchable?: boolean;
  visibleWhen?: QuestionnaireVisibleWhenRule | QuestionnaireVisibleWhenRule[];
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
  if (raw === 'date' || raw === 'boolean' || raw === 'number' || raw === 'currency' || raw === 'textarea' || raw === 'select' || raw === 'multiselect' || raw === 'list') {
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

function normalizeQuestion(item: unknown, productType?: string): QuestionnaireQuestion | null {
  const row = asRecord(item);
  const label = String(row.label || row.question || row.title || '').trim();
  const key = String(row.key || row.fieldKey || row.slug || '').trim();
  if (!label || !key) return null;
  const manifest = productType ? ProductRegistry.get(productType) : null;
  if (manifest?.questionnaireHiddenKeys?.includes(key)) return null;
  const manifestField = getQuestionnaireField(productType, key);
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
  const normalizedType = normalizeQuestionType(row.type || row.inputType) || mapManifestFieldType(String(manifestField?.type || ''));
  const normalized: QuestionnaireQuestion = {
    label,
    key,
    type: normalizedType,
    options: (options && options.length ? options : manifestField?.options) || undefined,
    searchable: row.searchable === true || manifestField?.searchable === true ? true : undefined,
    visibleWhen: normalizeVisibleWhen(row.visibleWhen),
  };
  return normalized;
}

function normalizeSection(item: unknown, productType?: string): QuestionnaireSection | null {
  const row = asRecord(item);
  const id = String(row.id || row.key || '').trim();
  const title = String(row.title || row.label || row.name || '').trim();
  const rawQuestions = Array.isArray(row.questions) ? row.questions : [];
  const questions = rawQuestions.map((question) => normalizeQuestion(question, productType)).filter((q): q is QuestionnaireQuestion => Boolean(q));
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

export function resolveProgramQuestionnaire(program: unknown, context?: QuestionnaireContext): QuestionnaireSection[] {
  const programRec = asRecord(program);
  if (!String(programRec.id || '').trim()) return [];
  const metadata = asRecord(asRecord(program).metadata);
  const productType = String(asRecord(programRec).productType || metadata.productType || '').toUpperCase();
  const candidates = [
    metadata.underwritingQuestionnaire,
    metadata.questionnaireStructure,
    metadata.uwQuestionnaire,
    metadata.questionnaire,
  ];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    const parsed = candidate.map((section) => normalizeSection(section, productType)).filter((section): section is QuestionnaireSection => Boolean(section));
    if (parsed.length > 0) return orderSectionsForContext(filterQuestionsByContext(parsed, context), context);
  }
  // Generic fallback: any product registered via ProductRegistry contributes its
  // declarative `manifest.questionnaire.sections` as the UW structure.
  if (productType) {
    const manifest = ProductRegistry.get(productType);
    if (manifest) {
      const sections = buildQuestionnaireFromManifest(manifest);
      if (sections.length > 0) return orderSectionsForContext(filterQuestionsByContext(sections, context), context);
    }
  }
  return [];
}

/**
 * Build a UW questionnaire structure directly from a ProductManifest.
 * `FieldDef.path` becomes the question `key` (dotted paths are supported by the
 * renderer), and `FieldDef` options survive unchanged.
 */
function buildQuestionnaireFromManifest(manifest: ReturnType<typeof ProductRegistry.get>): QuestionnaireSection[] {
  if (!manifest) return [];
  const sections = [...manifest.questionnaire.sections]
    .sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
    .map((section) => {
      const questions: QuestionnaireQuestion[] = section.fields.map((rawField) => {
        const field = rawField as {
          path: string;
          label: string;
          type: string;
          options?: Array<{ value: string; label: string }>;
          searchable?: boolean;
          visibleWhenKey?: string;
          visibleWhenValue?: unknown;
        };
        const q: QuestionnaireQuestion = {
          key: field.path,
          label: field.label,
          type: mapManifestFieldType(field.type),
        };
        if (Array.isArray(field.options) && field.options.length > 0) {
          q.options = field.options.map((o) => ({ value: o.value, label: o.label }));
        }
        if (field.searchable === true) {
          q.searchable = true;
        }
        if (field.visibleWhenKey) {
          q.visibleWhen = {
            field: field.visibleWhenKey,
            equals: field.visibleWhenValue as string | number | boolean | undefined,
          };
        }
        return q;
      });
      return { id: section.id, title: section.title, questions };
    })
    .filter((s) => s.questions.length > 0);
  return sections;
}

function mapManifestFieldType(t: string): QuestionnaireQuestionType | undefined {
  switch (t) {
    case 'text':
    case 'textarea':
    case 'number':
    case 'currency':
    case 'date':
    case 'select':
    case 'multiselect':
    case 'boolean':
    case 'list':
      return t as QuestionnaireQuestionType;
    case 'percent':
      return 'number';
    default:
      return undefined;
  }
}


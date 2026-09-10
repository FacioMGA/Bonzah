import { ProductRegistry } from './ProductRegistry.js';
import type { FieldDef, ProductManifest } from '@facio/products';

export type ProductDocPack = 'QUOTE_PACK' | 'ISSUED_POLICY_PACK' | 'ENDORSEMENT_PACK';

export type ProductRequiredField = {
  slug: string;
  label: string;
  source: 'quoteData';
  path: string;
  customerHash?: string;
  boTab?: string;
  required?: boolean;
  visibleWhenKey?: string;
  visibleWhenValue?: unknown;
  requiredWhenKey?: string;
  requiredWhenValue?: unknown;
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : {};
}

function normalizeToken(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function getValueAtPath(source: unknown, path: string): unknown {
  if (!path) return undefined;
  // Phase 6k: canonical `proposer.*` shape is the single source of truth.
  // No flat-shape fallback — flat policyholder reads were eliminated together
  // with `withPolicyholderAliases` / `withCanonicalPolicyholderAliases`.
  return path.split('.').filter(Boolean).reduce<unknown>((current, part) => {
    if (Array.isArray(current)) {
      const idx = Number(part);
      return Number.isInteger(idx) ? current[idx] : undefined;
    }
    const record = asRecord(current);
    return record[part];
  }, source);
}

function hasMeaningfulValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length > 0;
  return String(value).trim().length > 0;
}

function matchesCondition(data: UnknownRecord, key: string | undefined, expected: unknown): boolean {
  if (!key) return false;
  const actual = getValueAtPath(data, key);
  if (typeof expected === 'boolean') {
    if (typeof actual === 'boolean') return actual === expected;
    const token = normalizeToken(actual);
    return expected ? ['true', '1', 'yes'].includes(token) : ['false', '0', 'no', ''].includes(token);
  }
  if (typeof expected === 'number') return Number(actual) === expected;
  return normalizeToken(actual) === normalizeToken(expected);
}

type RequirementLike = Pick<ProductRequiredField, 'required' | 'visibleWhenKey' | 'visibleWhenValue' | 'requiredWhenKey' | 'requiredWhenValue'>;

function fieldIsVisible(data: UnknownRecord, field: RequirementLike): boolean {
  if (!field.visibleWhenKey) return true;
  return matchesCondition(data, field.visibleWhenKey, field.visibleWhenValue);
}

function fieldIsRequired(data: UnknownRecord, field: RequirementLike): boolean {
  if (field.requiredWhenKey) return matchesCondition(data, field.requiredWhenKey, field.requiredWhenValue);
  return field.required === true;
}

function resolveManifest(productType: string): ProductManifest | null {
  const adapter = ProductRegistry.getInstance().getAdapter(productType);
  return adapter?.getManifest() ?? null;
}

function collectQuestionnaireFields(manifest: ProductManifest): Array<{ sectionId: string; sectionTitle: string; field: FieldDef }> {
  return [...manifest.questionnaire.sections]
    .sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
    .flatMap((section) => section.fields.map((field) => ({
      sectionId: section.id,
      sectionTitle: section.title,
      field,
    })));
}

export function selectRequiredFieldsForDocPack(productType: string, _docPack: ProductDocPack): ProductRequiredField[] {
  const manifest = resolveManifest(productType);
  if (!manifest) return [];
  return collectQuestionnaireFields(manifest)
    .filter(({ field }) => field.required === true || Boolean(field.requiredWhenKey))
    .map(({ sectionId, sectionTitle, field }) => ({
      slug: field.path,
      label: field.label,
      source: 'quoteData' as const,
      path: field.path,
      customerHash: sectionId,
      boTab: sectionTitle,
      required: field.required,
      visibleWhenKey: field.visibleWhenKey,
      visibleWhenValue: field.visibleWhenValue,
      requiredWhenKey: field.requiredWhenKey,
      requiredWhenValue: field.requiredWhenValue,
    }));
}

export function selectQuoteReadyFieldKeys(productType: string): string[] {
  const manifest = resolveManifest(productType);
  if (!manifest) return [];
  const fromHints = manifest.riskModelHints.requiredForUw.map((entry) => entry.path);
  const fromQuestionnaire = collectQuestionnaireFields(manifest)
    .filter(({ field }) => field.required === true)
    .map(({ field }) => field.path);
  return Array.from(new Set([...fromHints, ...fromQuestionnaire].filter(Boolean)));
}

export function missingFieldsFromRequirements(
  quoteData: unknown,
  requirements: ProductRequiredField[],
): Array<{ slug: string; label: string; customerHash?: string; boTab?: string }> {
  const data = asRecord(quoteData);
  return requirements
    .map((requirement) => {
      if (!fieldIsVisible(data, requirement)) return null;
      if (!fieldIsRequired(data, requirement)) return null;
      const value = getValueAtPath(data, requirement.path);
      if (hasMeaningfulValue(value)) return null;
      return {
        slug: requirement.slug,
        label: requirement.label,
        customerHash: requirement.customerHash,
        boTab: requirement.boTab,
      };
    })
    .filter(Boolean) as Array<{ slug: string; label: string; customerHash?: string; boTab?: string }>;
}

export function validateManifestRequiredFields(productType: string, quoteData: unknown, docPack: ProductDocPack) {
  const requirements = selectRequiredFieldsForDocPack(productType, docPack);
  return missingFieldsFromRequirements(quoteData, requirements);
}

/**
 * Path → human label map for every questionnaire field declared in a
 * product manifest (sourced from the same canonical place that drives the
 * BO underwriting renderer). Used by issue-readiness blockers and any
 * other UX-facing surface that needs to translate a payload path like
 * `proposer.address.country` into an operator-friendly "Country".
 *
 * One source of truth — the manifest. Returning `{}` for an unknown
 * product is intentional so callers can fall back to humanized dotted
 * paths without throwing.
 */
export function selectFieldLabelsByPath(productType: string): Record<string, string> {
  const manifest = resolveManifest(productType);
  if (!manifest) return {};
  const labels: Record<string, string> = {};
  for (const { field } of collectQuestionnaireFields(manifest)) {
    const path = String(field.path || '').trim();
    const label = String(field.label || '').trim();
    if (!path || !label) continue;
    if (!labels[path]) labels[path] = label;
  }
  return labels;
}

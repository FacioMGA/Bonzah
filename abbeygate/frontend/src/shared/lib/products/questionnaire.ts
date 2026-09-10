import { ProductRegistry } from './registry';
import type { FieldDef, ProductManifest, SelectOption } from '@facio/products';

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : {};
}

function normalizeToken(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

export function getProductManifest(productType: string | null | undefined): ProductManifest | null {
  return ProductRegistry.get(String(productType || ''));
}

export function getQuestionnaireFields(productType: string | null | undefined): FieldDef[] {
  const manifest = getProductManifest(productType);
  if (!manifest) return [];
  return [...manifest.questionnaire.sections]
    .sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
    .flatMap((section) => section.fields);
}

export function getQuestionnaireField(productType: string | null | undefined, fieldKey: string): FieldDef | null {
  return getQuestionnaireFields(productType).find((field) => field.path === fieldKey) ?? null;
}

export function getQuestionnaireSelectOptions(productType: string | null | undefined, fieldKey: string): SelectOption[] {
  return getQuestionnaireField(productType, fieldKey)?.options ?? [];
}

export function hasMeaningfulValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length > 0;
  return String(value).trim().length > 0;
}

export function getValueAtPath(source: unknown, path: string): unknown {
  if (!path) return undefined;
  return path.split('.').filter(Boolean).reduce<unknown>((current, part) => {
    if (Array.isArray(current)) {
      const idx = Number(part);
      return Number.isInteger(idx) ? current[idx] : undefined;
    }
    return asRecord(current)[part];
  }, source);
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

export function isFieldVisibleForData(field: FieldDef | null | undefined, data: UnknownRecord): boolean {
  if (!field) return false;
  if (!field.visibleWhenKey) return true;
  return matchesCondition(data, field.visibleWhenKey, field.visibleWhenValue);
}

export function isFieldRequiredForData(field: FieldDef | null | undefined, data: UnknownRecord): boolean {
  if (!field) return false;
  if (field.requiredWhenKey) return matchesCondition(data, field.requiredWhenKey, field.requiredWhenValue);
  return field.required === true;
}

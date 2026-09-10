import type { FieldDef, ProductManifest } from '@facio/products';

/**
 * Manifest helpers — pure functions shared BO surfaces use when rendering
 * from a ProductManifest. No JSX here; renderers live next to their surface.
 */

export function readPath(source: unknown, path: string): unknown {
  if (!path) return undefined;
  const segments = path.split('.');
  let current: unknown = source;
  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function joinPathValues(source: unknown, paths: string[], separator = ' '): string {
  return paths
    .map((p) => readPath(source, p))
    .map((v) => coercePrimitive(v))
    .filter((v): v is string => v !== null && v.length > 0)
    .join(separator)
    .trim();
}

function coercePrimitive(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'object') {
    // Accept {label}|{value}|{name}|{title} shapes produced by some option pickers
    const rec = value as Record<string, unknown>;
    const candidate = rec.label ?? rec.value ?? rec.name ?? rec.title;
    if (typeof candidate === 'string') return candidate.trim() || null;
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return String(candidate);
    return null;
  }
  return null;
}

export function formatCurrency(value: unknown, currency = 'EUR'): string | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const symbol = currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : currency === 'USD' ? '$' : '';
  return `${symbol}${Math.round(n).toLocaleString()}`;
}

export function fieldIsVisible(field: FieldDef, data: unknown): boolean {
  if (!field.visibleWhenKey) return true;
  const v = readPath(data, field.visibleWhenKey);
  return v === field.visibleWhenValue;
}

export function fieldIsRequired(field: FieldDef, data: unknown): boolean {
  if (field.required) return true;
  if (!field.requiredWhenKey) return false;
  const v = readPath(data, field.requiredWhenKey);
  return v === field.requiredWhenValue;
}

export function hasMeaningfulValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length > 0;
  return String(value).trim().length > 0;
}

/**
 * Build a default product-summary projection for the policy list/card.
 * Returns { title, subtitle, insuredValue } — raw values; formatting is per-surface.
 */
export function projectSummary(manifest: ProductManifest, data: unknown): {
  title: string | null;
  subtitle: string | null;
  insuredValue: number | null;
} {
  const sf = manifest.summaryFields;
  const rec = (data && typeof data === 'object') ? (data as Record<string, unknown>) : {};

  const builtTitle = typeof sf.buildTitle === 'function' ? (sf.buildTitle(rec) || '').trim() : '';
  const title = builtTitle || joinPathValues(data, sf.titlePaths) || null;

  const builtSubtitle = typeof sf.buildSubtitle === 'function' ? (sf.buildSubtitle(rec) || '').trim() : '';
  const subtitle = builtSubtitle || joinPathValues(data, sf.subtitlePaths, ' · ') || null;

  const insuredValueRaw = sf.insuredValuePath ? readPath(data, sf.insuredValuePath) : null;
  const n = Number(insuredValueRaw);
  const insuredValue = Number.isFinite(n) && n > 0 ? n : null;
  return { title, subtitle, insuredValue };
}

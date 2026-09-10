import type { ListColumnSpec, ProductManifest } from '@facio/products';
import { readPath, formatCurrency, hasMeaningfulValue } from './manifestHelpers';

/**
 * Pure string projections for list columns driven by ProductManifest.
 * Kept separate from JSX renderers so both BO list and PolicyCard can share them.
 */

type ProjectedLines = {
  primary: string | null;
  secondary: string | null;
  tertiary: string | null;
};

function projectLine(data: unknown, paths: string[], separator = ' '): string | null {
  const parts = paths
    .map((p) => readPath(data, p))
    .filter(hasMeaningfulValue)
    .map((v) => String(v).trim());
  if (parts.length === 0) return null;
  return parts.join(separator).trim() || null;
}

function formatValueForPath(data: unknown, path: string, format?: 'currency' | 'text'): string | null {
  const v = readPath(data, path);
  if (!hasMeaningfulValue(v)) return null;
  if (format === 'currency') return formatCurrency(v);
  return String(v).trim() || null;
}

export function projectListColumn(data: unknown, spec: ListColumnSpec): ProjectedLines {
  const record = (data && typeof data === 'object') ? (data as Record<string, unknown>) : {};
  const built = typeof spec.buildPrimary === 'function' ? (spec.buildPrimary(record) || '').trim() : '';
  const primary = built || projectLine(data, spec.primaryPaths, ' ');
  const builtSecondary = typeof spec.buildSecondary === 'function' ? (spec.buildSecondary(record) || '').trim() : '';
  const secondary = builtSecondary || (spec.secondaryPaths ? projectLine(data, spec.secondaryPaths, ' · ') : null);
  const tertiary = spec.tertiaryPath ? formatValueForPath(data, spec.tertiaryPath, spec.tertiaryFormat) : null;
  return { primary, secondary, tertiary };
}

/** Returns the human-readable title for a wizard flow step id, from the manifest's questionnaire sections. */
export function resolveStepLabel(manifest: ProductManifest | null, stepId: string | null | undefined): string | null {
  if (!manifest || !stepId) return null;
  const normalized = String(stepId).toLowerCase().replace(/_/g, '-');
  const section = manifest.questionnaire.sections.find((s) => s.id.toLowerCase() === normalized);
  return section?.title ?? null;
}

/**
 * RiskIdentity — the core primitive that names the *thing being insured*.
 *
 * Every product insures a risk object:
 *   Motor  → Vehicle
 *   Home   → Property
 *   Travel → Trip (single or annual multi-trip)
 *
 * `RiskIdentity` is the single structure used by every consumer (BO list,
 * policy header, document view-models, email subjects, BDX risk-description)
 * to describe that object. Adapters produce it via `IProductAdapter.getRiskIdentity`;
 * the default implementation reads from the `ProductManifest.insuredObject` and
 * `summaryFields` (optionally via `buildTitle` / `buildSubtitle`).
 */
import type { ProductManifest } from '@facio/products';

export type RiskObjectKind = 'vehicle' | 'property' | 'trip' | string;

export interface RiskIdentity {
  kind: RiskObjectKind;
  /** Stable natural key when available (plate, postcode, passport, trip ref). */
  identifier?: string;
  /** Human-facing primary line — e.g. "BMW X5 2025". */
  primary: string;
  /** Optional secondary line — e.g. "Diesel · 3000cc". */
  secondary?: string;
  /** Mirror of manifest.insuredObject.cardinality for downstream conditional rendering. */
  cardinality: 'one' | 'many';
}

function readPath(source: unknown, path: string): unknown {
  if (!path) return undefined;
  const segs = path.split('.');
  let cur: unknown = source;
  for (const s of segs) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[s];
  }
  return cur;
}

function coerceText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    const candidate = rec.label ?? rec.value ?? rec.name ?? rec.title;
    if (typeof candidate === 'string') return candidate.trim() || null;
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return String(candidate);
  }
  return null;
}

function joinPaths(source: unknown, paths: string[], sep = ' '): string {
  return paths
    .map((p) => readPath(source, p))
    .map(coerceText)
    .filter((v): v is string => v !== null && v.length > 0)
    .join(sep)
    .trim();
}

/**
 * Default implementation of `getRiskIdentity`, using the manifest's
 * `summaryFields` (including optional `buildTitle` / `buildSubtitle`) and
 * `insuredObject` metadata. Adapters with conditional identity logic should
 * still override, but they can call this helper for the unmatched branch.
 */
export function defaultRiskIdentity(manifest: ProductManifest, data: unknown): RiskIdentity {
  const record = (data && typeof data === 'object') ? (data as Record<string, unknown>) : {};
  const sf = manifest.summaryFields;

  const builtTitle = typeof sf.buildTitle === 'function' ? (sf.buildTitle(record) || '').trim() : '';
  const primary = builtTitle || joinPaths(record, sf.titlePaths);

  const builtSubtitle = typeof sf.buildSubtitle === 'function' ? (sf.buildSubtitle(record) || '').trim() : '';
  const secondary = builtSubtitle || joinPaths(record, sf.subtitlePaths, ' · ');

  // Try to pick a stable identifier from the insuredObject fields (first non-empty
  // value among fields that look like natural keys — registration, vin, postcode, etc.).
  const identifierCandidates = manifest.insuredObject.fields
    .filter((f) =>
      /registration|plate|vin|ref|number|passport|postcode|postal/i.test(f.path || f.label || ''),
    )
    .map((f) => f.path);
  let identifier: string | undefined;
  for (const path of identifierCandidates) {
    const v = coerceText(readPath(record, path));
    if (v) { identifier = v; break; }
  }

  return {
    kind: manifest.insuredObject.kind,
    identifier,
    primary: primary || manifest.displayName || 'Unnamed risk',
    secondary: secondary || undefined,
    cardinality: manifest.insuredObject.cardinality,
  };
}

/**
 * RiskIdentity — the core primitive that names the *thing being insured*.
 *
 * Frontend mirror of `backend/modules/policy/domain/riskIdentity.ts`. Kept in
 * lockstep because both surfaces need to build the same description from the
 * same ProductManifest. Used by the BO policy list, policy header, document
 * preview chrome, and email subject builders.
 */
import type { ProductManifest } from '@facio/products';
import { ProductRegistry } from './registry';

export type RiskObjectKind = 'vehicle' | 'property' | 'trip' | string;

export interface RiskIdentity {
  kind: RiskObjectKind;
  identifier?: string;
  primary: string;
  secondary?: string;
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
 * Build a RiskIdentity from a manifest + data snapshot.
 * Honours `summaryFields.buildTitle` / `buildSubtitle` when provided, otherwise
 * falls back to declarative `titlePaths` / `subtitlePaths`.
 */
export function buildRiskIdentityFromManifest(manifest: ProductManifest, data: unknown): RiskIdentity {
  const record = (data && typeof data === 'object') ? (data as Record<string, unknown>) : {};
  const sf = manifest.summaryFields;

  const builtTitle = typeof sf.buildTitle === 'function' ? (sf.buildTitle(record) || '').trim() : '';
  const primary = builtTitle || joinPaths(record, sf.titlePaths);

  const builtSubtitle = typeof sf.buildSubtitle === 'function' ? (sf.buildSubtitle(record) || '').trim() : '';
  const secondary = builtSubtitle || joinPaths(record, sf.subtitlePaths, ' · ');

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

/**
 * Convenience resolver: given a policy-like record (with productType + quoteData
 * + vehicleInfo), returns a RiskIdentity or null when no product manifest is
 * registered (e.g. brand new draft with no product chosen yet).
 */
export function getRiskIdentity(policy: unknown): RiskIdentity | null {
  if (!policy || typeof policy !== 'object') return null;
  const rec = policy as Record<string, unknown>;
  const productType = String(rec.productType || '').trim();
  if (!productType) return null;
  const manifest = ProductRegistry.get(productType);
  if (!manifest) return null;
  const qd = (rec.quoteData && typeof rec.quoteData === 'object') ? rec.quoteData as Record<string, unknown> : {};
  const vi = (rec.vehicleInfo && typeof rec.vehicleInfo === 'object') ? rec.vehicleInfo as Record<string, unknown> : {};
  return buildRiskIdentityFromManifest(manifest, { ...qd, ...vi });
}

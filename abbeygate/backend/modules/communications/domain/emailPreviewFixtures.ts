import { extractVariables } from './templateRenderer.js';
import { buildBrandProfile, type BrandProfile } from './emailBranding.js';
import type { CustomerTemplateDefinition } from './customerTemplateCatalog.js';

/**
 * Safe preview fixtures for the Email Preview & Testing Centre.
 *
 * These generate deterministic, obviously-fake sample data so any email
 * template can be rendered WITHOUT touching a real policy, customer, payment
 * or claim. Values are derived generically from each template's placeholders,
 * so a newly added template automatically gets a complete fixture (and cannot
 * silently ship with unfillable variables).
 */

export type PreviewJurisdiction = 'CY' | 'GR' | 'PT' | 'ES';

/**
 * A preview fixture value: either a rendered leaf (string) or a nested branch.
 * Modelled as an explicit recursive tree rather than a bare index-signature so
 * the shape is honest and does not launder through `unknown`.
 */
export type PreviewVariableValue = string | PreviewVariableTree;
export interface PreviewVariableTree {
  [key: string]: PreviewVariableValue;
}

export const PREVIEW_JURISDICTIONS: readonly PreviewJurisdiction[] = ['CY', 'GR', 'PT', 'ES'];

// Preview-only display config per jurisdiction. This is sample scaffolding for
// rendering previews — NOT production tenant routing (which is ALS-resolved).
const PREVIEW_BRAND_CONFIG: Record<PreviewJurisdiction, { publicBaseUrl: string; fromEmail: string }> = {
  CY: { publicBaseUrl: 'https://abbeygate.cy', fromEmail: 'no-reply@abbeygate.cy' },
  GR: { publicBaseUrl: 'https://abbeygate.gr', fromEmail: 'no-reply@abbeygate.gr' },
  PT: { publicBaseUrl: 'https://abbeygate.pt', fromEmail: 'no-reply@abbeygate.pt' },
  ES: { publicBaseUrl: 'https://abbeygate.es', fromEmail: 'no-reply@abbeygate.es' },
};

export function normalizePreviewJurisdiction(raw: string | null | undefined): PreviewJurisdiction {
  const code = String(raw || '').trim().toUpperCase();
  return (PREVIEW_JURISDICTIONS as readonly string[]).includes(code) ? (code as PreviewJurisdiction) : 'CY';
}

/** Build a deterministic {@link BrandProfile} for a preview jurisdiction. */
export function buildPreviewBrand(jurisdiction: PreviewJurisdiction): BrandProfile {
  const cfg = PREVIEW_BRAND_CONFIG[jurisdiction];
  return buildBrandProfile({
    countryCode: jurisdiction,
    brokerName: 'Abbeygate',
    whiteLogoUrl: `${cfg.publicBaseUrl}/assets/branding/logo-white.png`,
    publicBaseUrl: cfg.publicBaseUrl,
    fromEmail: cfg.fromEmail,
  });
}

/** Generate a sample value for a placeholder based on its leaf name. */
function sampleValueForLeaf(path: string, jurisdiction: PreviewJurisdiction): string {
  const leaf = path.split('.').pop() || path;
  const l = leaf.toLowerCase();
  const base = PREVIEW_BRAND_CONFIG[jurisdiction].publicBaseUrl;
  if (l === 'firstname') return 'Alex';
  if (l === 'lastname') return 'Preview';
  if (l.includes('email')) return 'preview.customer@example.test';
  if (l.endsWith('url') || l === 'url' || l.includes('link')) return `${base}/preview/secure-link`;
  if (l.includes('phone')) return '+357 26 000000';
  if (l.includes('otp') || l === 'code') return '123456';
  if (l.includes('premium') || l.includes('excess') || l.includes('amount') || l.includes('price') || l.includes('total')) return '€123.45';
  if (l.includes('date')) return '1 January 2026';
  if (l.includes('number') || l.includes('reference') || l === 'ref' || l.includes('correlationid')) return 'ABG-PREVIEW-0001';
  if (l.includes('name')) return 'Alex Preview';
  if (l.includes('message') || l.includes('summary') || l.includes('detail')) return 'This is safe preview sample text for template testing.';
  if (l.includes('label') || l.includes('product')) return 'Motor';
  if (l.includes('source')) return 'PREVIEW';
  if (l.includes('status')) return 'Preview';
  // Humanise the leaf as a last resort ("vehicleDescription" -> "Vehicle Description").
  return leaf
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Placeholder paths come from template text, so refuse the prototype-pollution
// keys before walking/writing the tree (defence-in-depth even for our own
// templates; also clears the CodeQL prototype-pollution alert).
const UNSAFE_PATH_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function setPath(target: PreviewVariableTree, path: string, value: string): void {
  const parts = path.split('.');
  if (parts.some((part) => UNSAFE_PATH_KEYS.has(part))) return;
  let node = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    const existing = node[key];
    if (typeof existing === 'object' && existing !== null) {
      node = existing;
    } else {
      const next: PreviewVariableTree = {};
      node[key] = next;
      node = next;
    }
  }
  node[parts[parts.length - 1]] = value;
}

/**
 * Build a complete, safe variable object for a template definition. Every
 * placeholder in the subject/body plus every schema key is filled (except
 * brand.* / brandName, which the renderer injects). This guarantees a preview
 * renders with no missing variables.
 */
export function buildPreviewVariables(
  definition: CustomerTemplateDefinition,
  jurisdiction: PreviewJurisdiction = 'CY',
): PreviewVariableTree {
  const placeholders = new Set<string>([
    ...extractVariables(definition.subjectTemplate || ''),
    ...extractVariables(definition.bodyTemplate || ''),
    ...Object.keys(definition.variablesSchema || {}),
  ]);
  const out: PreviewVariableTree = {};
  for (const path of placeholders) {
    if (path === 'brandName' || path.startsWith('brand.')) continue;
    setPath(out, path, sampleValueForLeaf(path, jurisdiction));
  }
  return out;
}

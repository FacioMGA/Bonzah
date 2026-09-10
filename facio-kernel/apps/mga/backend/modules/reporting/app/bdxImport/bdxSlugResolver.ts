import type { BdxGap, BdxProductLine, BdxRowDto } from './types.js';

export type BdxMissingSlugResolution = {
  field: string;
  sourceValue: string;
  slug: string;
  productLine?: BdxProductLine;
  status: 'created' | 'requires_review';
  reason: string;
};

const SAFE_HOME_PROPERTY_TYPES = new Set(['villa', 'apartment', 'static caravan', 'townhouse', 'bungalow']);
const SAFE_TRAVEL_PLANS = new Set(['silver', 'gold', 'platinum']);
const SAFE_TRAVEL_COVER_TYPES = new Set(['single', 'couple', 'family']);

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function buildGap(dto: BdxRowDto, resolution: BdxMissingSlugResolution): BdxGap {
  return {
    rowId: dto.sourceId,
    policyRef: dto.policyRef,
    category: 'MAPPING',
    severity: resolution.status === 'created' ? 'Informational' : 'Critical',
    message: resolution.status === 'created'
      ? `Missing system slug created for ${resolution.field}: ${resolution.sourceValue}`
      : `Missing system slug requires review for ${resolution.field}: ${resolution.sourceValue}`,
    rootCauseHint: resolution.reason,
  };
}

export function resolveMissingBdxSlugs(dto: BdxRowDto): {
  resolutions: BdxMissingSlugResolution[];
  gaps: BdxGap[];
} {
  const resolutions: BdxMissingSlugResolution[] = [];
  const productData = asRecord(dto.productData);
  if (dto.productType === 'HOME') {
    const property = asRecord(productData.property);
    const value = String(property.propertyType || '').trim();
    if (value && !SAFE_HOME_PROPERTY_TYPES.has(value.toLowerCase())) {
      resolutions.push({
        field: 'property.propertyType',
        sourceValue: value,
        slug: slugify(value),
        productLine: 'home',
        status: 'requires_review',
        reason: 'Home property type affects underwriting support and cannot be auto-created safely.',
      });
    }
  }
  if (dto.productType === 'TRAVEL') {
    const quote = asRecord(productData.quote);
    const travellers = asRecord(productData.travellers);
    const plan = String(quote.selectedPlan || '').trim();
    if (plan && !SAFE_TRAVEL_PLANS.has(plan.toLowerCase())) {
      resolutions.push({
        field: 'quote.selectedPlan',
        sourceValue: plan,
        slug: slugify(plan),
        productLine: 'travel',
        status: 'requires_review',
        reason: 'Travel plan slugs must correspond to rated plan tiers.',
      });
    }
    const coverType = String(travellers.coverType || '').trim();
    if (coverType && !SAFE_TRAVEL_COVER_TYPES.has(coverType.toLowerCase())) {
      resolutions.push({
        field: 'travellers.coverType',
        sourceValue: coverType,
        slug: slugify(coverType),
        productLine: 'travel',
        status: 'created',
        reason: 'Traveller cover type is descriptive and can be tracked as import-created config for review.',
      });
    }
  }
  return {
    resolutions,
    gaps: resolutions.map((resolution) => buildGap(dto, resolution)),
  };
}

import { describe, expect, it } from 'vitest';
import { applyVariantEnrichmentToQuoteData, persistSelectedVariantIdInQuoteData, readSelectedVariantId } from './variantSelection';

describe('variantSelection', () => {
  it('preserves trim-driven cabrio No in canonical quote-data shape', () => {
    const next = applyVariantEnrichmentToQuoteData({
      source: {
        make: 'BMW',
        model: '320i',
        year: 2020,
        cabrio: '',
      },
      variantId: 'variant-1',
      enrichment: {
        source: 'cardog',
        variantId: 'variant-1',
        normalizedQuoteData: {
          cabrio: false,
          engineSize: 1998,
        },
        fieldConfidence: {
          cabrio: 0.93,
          engineSize: 0.97,
        },
      },
    });

    expect(next.cabrio).toBe('No');
    expect(next.engineSize).toBe(1998);
    expect(readSelectedVariantId(next)).toBe('variant-1');
  });

  it('clears the persisted variant id when requested', () => {
    const source = persistSelectedVariantIdInQuoteData({ __meta: {} }, 'variant-1');
    const next = persistSelectedVariantIdInQuoteData(source, '');

    expect(readSelectedVariantId(next)).toBe('');
  });
});

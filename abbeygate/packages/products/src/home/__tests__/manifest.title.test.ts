/**
 * ABY-101 — Home policy detail header was rendering only "Villa"
 * because `summaryFields.titlePaths` joined `property.address.line1`
 * with `property.propertyType` and `buildRiskIdentityFromManifest`
 * fell back to whichever was non-empty. The agreed copy is
 * "[N]-bedroom [type] in [city]" (e.g. "3-bedroom Villa in Paphos").
 *
 * `summaryFields.buildTitle` (when non-empty) wins over `titlePaths`
 * per `frontend/src/shared/lib/products/riskIdentity.ts`, so this is
 * the canonical place to fix the header copy across BO + customer
 * surfaces.
 */
import { describe, expect, it } from 'vitest';
import { homeManifest } from '../manifest';

describe('home manifest — summaryFields.buildTitle (ABY-101)', () => {
  const buildTitle = homeManifest.summaryFields.buildTitle!;

  it('renders "[N]-bedroom [type] in [city]" when all three fields are present', () => {
    const result = buildTitle({
      property: {
        bedrooms: 3,
        propertyType: 'Villa',
        address: { city: 'Paphos' },
      },
    });
    expect(result).toBe('3-bedroom Villa in Paphos');
  });

  it('falls back to "[type] in [city]" when bedrooms is missing', () => {
    const result = buildTitle({
      property: {
        propertyType: 'Apartment',
        address: { city: 'Limassol' },
      },
    });
    expect(result).toBe('Apartment in Limassol');
  });

  it('renders "[N]-bedroom [type]" when city is missing', () => {
    const result = buildTitle({
      property: {
        bedrooms: 2,
        propertyType: 'Townhouse',
      },
    });
    expect(result).toBe('2-bedroom Townhouse');
  });

  it('falls back to "Property in [city]" when only city is known', () => {
    const result = buildTitle({
      property: {
        address: { city: 'Nicosia' },
      },
    });
    expect(result).toBe('Property in Nicosia');
  });

  it('returns "" when nothing is known so the resolver falls back to titlePaths', () => {
    expect(buildTitle({ property: {} })).toBe('');
    expect(buildTitle({})).toBe('');
  });

  it('handles bedrooms as string from RHF (zod coercion variations)', () => {
    const result = buildTitle({
      property: {
        bedrooms: '4',
        propertyType: 'Villa',
        address: { city: 'Larnaca' },
      },
    });
    expect(result).toBe('4-bedroom Villa in Larnaca');
  });

  it('rejects bedrooms = 0 (treats as missing) so we never render "0-bedroom Villa"', () => {
    const result = buildTitle({
      property: {
        bedrooms: 0,
        propertyType: 'Villa',
        address: { city: 'Paphos' },
      },
    });
    expect(result).toBe('Villa in Paphos');
  });
});

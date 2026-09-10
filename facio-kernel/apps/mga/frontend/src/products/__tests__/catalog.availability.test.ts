import { describe, expect, it } from 'vitest';

import { isProductAvailableInCountry, productCatalog } from '../catalog';

function entryBySlug(slug: string) {
  const entry = productCatalog.find((p) => p.publicSessionSlug === slug);
  if (!entry) throw new Error(`No catalog entry for ${slug}`);
  return entry;
}

describe('catalog jurisdiction availability', () => {
  it('marks Immigration Medical (health) as Cyprus-only', () => {
    expect(entryBySlug('health').availableCountryCodes).toEqual(['CY']);
  });

  it('starts Immigration Medical on customer contact details', () => {
    expect(entryBySlug('health').firstStep).toBe('your-details');
  });

  it('leaves Home and Travel unrestricted across operating jurisdictions', () => {
    for (const slug of ['home', 'travel']) {
      expect(entryBySlug(slug).availableCountryCodes).toBeUndefined();
    }
  });

  it('offers manual products (business, open market) in every jurisdiction including GR', () => {
    for (const slug of ['business', 'open-market']) {
      expect(entryBySlug(slug).availableCountryCodes).toBeUndefined();
      expect(isProductAvailableInCountry(entryBySlug(slug), 'GR')).toBe(true);
    }
  });

  it('offers health on CY but hides it on PT/GR/ES', () => {
    const health = entryBySlug('health');
    expect(isProductAvailableInCountry(health, 'CY')).toBe(true);
    expect(isProductAvailableInCountry(health, 'PT')).toBe(false);
    expect(isProductAvailableInCountry(health, 'GR')).toBe(false);
    expect(isProductAvailableInCountry(health, 'ES')).toBe(false);
  });

  it('does not constrain when the operating host is unknown (localhost / preview)', () => {
    expect(isProductAvailableInCountry(entryBySlug('health'), null)).toBe(true);
  });

  it('excludes Motor in Greece and retains the configured Motor territories', () => {
    const motor = entryBySlug('motor');
    expect(motor.availableCountryCodes).toEqual(['CY', 'PT', 'ES']);
    expect(isProductAvailableInCountry(motor, 'GR')).toBe(false);
    expect(isProductAvailableInCountry(motor, 'ES')).toBe(true);
    expect(isProductAvailableInCountry(motor, 'PT')).toBe(true);
    expect(isProductAvailableInCountry(motor, 'CY')).toBe(true);
    expect(isProductAvailableInCountry(motor, null)).toBe(true);
  });
});

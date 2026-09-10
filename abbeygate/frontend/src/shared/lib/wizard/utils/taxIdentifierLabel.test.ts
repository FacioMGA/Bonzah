import { describe, expect, it } from 'vitest';
import { taxIdentifierFieldCopy } from './taxIdentifierLabel';

describe('taxIdentifierFieldCopy — jurisdiction-aware proposer.nif label (Theo 2026-07-21)', () => {
  it('Cyprus shows a passport number field, not a tax ID', () => {
    const copy = taxIdentifierFieldCopy('CY');
    expect(copy.label).toBe('Passport number');
    expect(copy.placeholder).toMatch(/passport/i);
    expect(copy.label).not.toMatch(/NIF|tax/i);
  });

  it('Greece labels the tax number AFM', () => {
    expect(taxIdentifierFieldCopy('GR').label).toBe('AFM');
  });

  it('Portugal keeps NIF', () => {
    expect(taxIdentifierFieldCopy('PT').label).toBe('NIF');
  });

  it('falls back to the neutral generic label for unknown / dev hosts', () => {
    expect(taxIdentifierFieldCopy(null).label).toBe('NIF / Tax ID');
    expect(taxIdentifierFieldCopy('ZZ').label).toBe('NIF / Tax ID');
  });
});

import { describe, expect, it } from 'vitest';
import { formatBinderLabel } from './binderFormatting';

describe('binderFormatting', () => {
  it('uses a full year suffix from agreement number', () => {
    expect(formatBinderLabel({
      leadCapacityProviderName: 'Lloyds',
      productLabel: 'Motor',
      agreementNumber: 'AB-2026',
    })).toBe('Lloyds – Motor – 2026');
  });

  it('uses a short year prefix from agreement number', () => {
    expect(formatBinderLabel({
      coverholderName: 'Abbeygate',
      authorizedClass: 'Home',
      agreementNumber: '26HOME',
    })).toBe('Abbeygate – Home – 2026');
  });

  it('falls back to a B-prefixed UMR fragment for the class label', () => {
    expect(formatBinderLabel({
      leadCapacityProviderName: 'Leader',
      umr: 'B123456ABCDEF2026',
      startDate: '2026-01-01',
    })).toBe('Leader – ABCDEF – 2026');
  });

  it('falls back to unknown leader, binder id, and unknown year', () => {
    expect(formatBinderLabel({ id: 'binder-1' })).toBe('Unknown leader – binder-1 – Unknown');
  });
});

import { describe, expect, it } from 'vitest';
import { UwExtensionRegistry } from './uwExtensionRegistry';

describe('UwExtensionRegistry', () => {
  it('registers extensions keyed by normalized product type', () => {
    UwExtensionRegistry.register({
      productType: 'motor',
      triggerExplanation: (code) => code === 'A' ? 'Explained' : null,
    });

    expect(UwExtensionRegistry.has('MOTOR')).toBe(true);
    expect(UwExtensionRegistry.get(' motor ')?.triggerExplanation?.('A')).toBe('Explained');
  });

  it('returns null for unknown or empty product types', () => {
    expect(UwExtensionRegistry.get('')).toBeNull();
    expect(UwExtensionRegistry.get('UNKNOWN')).toBeNull();
  });

  it('rejects extensions without a product type', () => {
    expect(() => UwExtensionRegistry.register({ productType: '' })).toThrow(
      'UwExtensionRegistry.register: extension.productType is required'
    );
  });

  it('lists registered extensions', () => {
    UwExtensionRegistry.register({ productType: 'MOTOR' });
    UwExtensionRegistry.register({ productType: 'HOME' });
    UwExtensionRegistry.register({ productType: 'TRAVEL' });

    const productTypes = UwExtensionRegistry.list().map((extension) => extension.productType);
    expect(productTypes).toEqual(expect.arrayContaining(['MOTOR', 'HOME', 'TRAVEL']));
  });
});

import { describe, expect, it } from 'vitest';
import { CANONICAL_BINDERS, canonicalBindersForProduct } from './canonicalProgramBinderSeed.js';

describe('canonical Open Market binder seed', () => {
  it('authorizes Business under the Open Market binder bucket', () => {
    const openMarketBinder = CANONICAL_BINDERS.find((binder) => binder.id === 'OPEN-MARKET-MANUAL-2026');

    expect(openMarketBinder).toBeTruthy();
    expect(openMarketBinder?.productCode).toBe('OPEN_MARKET');
    expect(openMarketBinder?.authorizedProductCodes).toContain('BUSINESS');
    expect(openMarketBinder?.config).toMatchObject({
      productType: 'OPEN_MARKET',
      scope: { selectableProducts: ['BUSINESS'] },
    });
    expect(canonicalBindersForProduct('BUSINESS').map((binder) => binder.id)).toContain('OPEN-MARKET-MANUAL-2026');
  });
});

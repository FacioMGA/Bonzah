import { describe, expect, it } from 'vitest';
import { validateQuoteDataForIssuanceCanonical } from '../quoteDataIssuanceValidator.js';
import { registerAllProducts } from '../../../../products/registerProducts.js';
import { motorGoldenFixtures } from '../../../../products/motor/goldenFixtures.js';
import { homeGoldenFixtures } from '../../../../products/home/goldenFixtures.js';
import { travelGoldenFixtures } from '../../../../products/travel/goldenFixtures.js';

registerAllProducts();

describe('multi-product customer payload — canonical issuance validation', () => {
  it.each([
    ['MOTOR', motorGoldenFixtures.minimumValid],
    ['HOME', homeGoldenFixtures.minimumValid],
    ['TRAVEL', travelGoldenFixtures.minimumValid],
  ] as const)('%s customer-produced golden fixture passes canonical adapter validation', async (productType, quoteData) => {
    const result = await validateQuoteDataForIssuanceCanonical(quoteData, productType);

    expect(result.valid).toBe(true);
    expect(result.missingForIssuedPack).toEqual([]);
    expect(result.schemaIssues).toEqual([]);
  });
});

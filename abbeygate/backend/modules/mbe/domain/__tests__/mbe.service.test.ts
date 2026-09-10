import { describe, expect, it } from 'vitest';
import { normalizeQuoteDataForPricing } from '../service.js';

describe('normalizeQuoteDataForPricing', () => {
    it('coerces numeric required excess to the pricing contract string shape', () => {
        const normalized = normalizeQuoteDataForPricing({
            requiredExcess: 500,
            coverRequired: 'Comprehensive',
        });

        expect(normalized.requiredExcess).toBe('500');
    });
});

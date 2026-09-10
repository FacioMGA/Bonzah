import { describe, test, expect } from 'vitest';
import { toDecimal, fromDecimal, roundCurrency } from '../../../../platform/utils/decimal.js';
import { calculateAutoInsurancePremium } from '../../../../products/motor/pricing/autoInsuranceCalculator.js';
import type { QuoteData } from '../../../../platform/types/autoInsurance.js';
import { registerAllProducts } from '../../../../products/registerProducts.js';

registerAllProducts();

describe('1000-Iteration Deterministic Test', () => {
    const mockQuoteData = {
        proposer: {
            firstName: 'Test',
            lastName: 'User',
            email: 'test@example.com',
            phone: '+35799123456',
            dateOfBirth: '1985-05-15',
        },
        vehicleValue: 20000,
        engineSize: 1800,
        year: 2019,
        ncb: '5+ Years',
        coverRequired: 'Comprehensive',
        kmsPerYear: '10000',
        licenseYears: '10',
        licenseType: 'Full',
        licenseIssuedIn: 'Cyprus',
        vehicleUse: 'Private',
        hasConvictions: false,
        hasClaims: false,
        hasAdditionalDrivers: false,
        requiredExcess: '300',
        vehicleType: 'Car',
        make: 'Toyota',
        model: 'Yaris',
    } as unknown as QuoteData;

    test('Premium is identical across 1000 calculations', () => {
        const results: string[] = [];

        for (let i = 0; i < 1000; i++) {
            const result = calculateAutoInsurancePremium(mockQuoteData);
            results.push(result.premium.toString());
        }

        // All results should be identical when converted to string
        const uniqueResults = new Set(results);
        expect(uniqueResults.size).toBe(1);

        // And the premium should be properly rounded
        const premium = parseFloat(results[0]!);
        const premiumStr = premium.toString();
        const decimalPart = premiumStr.split('.')[1];
        expect(decimalPart?.length || 0).toBeLessThanOrEqual(2);
    });
});

describe('Pro-Rata Refund Calculations', () => {
    test('Pro-rata refund with 50% elapsed time', () => {
        const annualPremium = toDecimal(1000);
        const factor = 0.5; // 50% remaining
        const proRata = fromDecimal(roundCurrency(annualPremium.mul(factor)));

        expect(proRata).toBe(500.00);
    });

    test('Commission calculation (25%) on pro-rata amount', () => {
        const proRataPremium = toDecimal(500);
        const commission = fromDecimal(roundCurrency(proRataPremium.mul(0.25)));

        expect(commission).toBe(125.00);
    });

    test('Complete refund calculation: €1000 premium, 6 months elapsed', () => {
        const annualPremium = 1000;
        const daysElapsed = 183;
        const totalDays = 365;
        const factor = (totalDays - daysElapsed) / totalDays; // ~0.4986

        const insurerPremiumNetOfMif = annualPremium - 9; // 991 (minus MIF surcharge)
        const proRata = fromDecimal(roundCurrency(toDecimal(insurerPremiumNetOfMif).mul(factor)));
        const commission = fromDecimal(roundCurrency(toDecimal(proRata).mul(0.25)));
        const adminFee = 35;
        const roadsideFee = 0;

        const refund = fromDecimal(
            roundCurrency(
                toDecimal(proRata)
                    .minus(commission)
                    .minus(adminFee)
                    .minus(roadsideFee)
            )
        );

        // Pro-rata: 991 * 0.4986 = 494.14
        expect(proRata).toBe(494.14);
        // Commission: 494.14 * 0.25 = 123.54
        expect(commission).toBe(123.54);
        // Refund: 494.14 - 123.54 - 35 = 335.60
        expect(refund).toBe(335.60);
    });

    test('Refund with multiple subtractions maintains precision', () => {
        const proRata = toDecimal(500);
        const commission = toDecimal(125);
        const adminFee = 35;
        const roadsideFee = 86;

        const refund = fromDecimal(
            roundCurrency(
                proRata
                    .minus(commission)
                    .minus(adminFee)
                    .minus(roadsideFee)
            )
        );

        // 500 - 125 - 35 - 86 = 254.00
        expect(refund).toBe(254.00);
    });
});

import { Decimal } from 'decimal.js';
import { toDecimal, fromDecimal, roundCurrency, financiallyEqual } from '../../../../platform/utils/decimal.js';
import { calculateAutoInsurancePremium as calculateMotorPremium } from '../../../../products/motor/pricing/autoInsuranceCalculator.js';
import { loadAbbeygateAutoCyprus2022Matrix } from '../../../../products/motor/pricing/data/loader.js';
import type { QuoteData } from '../../../../platform/types/autoInsurance.js';
import { registerAllProducts } from '../../../../products/registerProducts.js';
import { runWithOperatingTenant } from '../../../../platform/tenant/tenantAls.js';
import { getTenantFixtures } from '../../../../products/testHelpers/tenantFixtures.js';

registerAllProducts();
const motorModel = loadAbbeygateAutoCyprus2022Matrix();
const cyTenant = getTenantFixtures().find((tenant) => tenant.countryCode === 'CY')!;
const calculateAutoInsurancePremium = (...[quoteData, overrideExcess, appliedEndorsements = []]: Parameters<typeof calculateMotorPremium>) =>
    runWithOperatingTenant(cyTenant, () => calculateMotorPremium(quoteData, overrideExcess, appliedEndorsements, motorModel));

describe('Decimal Precision in Premium Calculations', () => {
    describe('Utility Functions', () => {
        test('toDecimal should handle numbers, strings, and Decimal instances', () => {
            expect(toDecimal(123.45).toNumber()).toBe(123.45);
            expect(toDecimal('456.78').toNumber()).toBe(456.78);
            expect(toDecimal('€99.99').toNumber()).toBe(99.99);
            expect(toDecimal(new Decimal(789.12)).toNumber()).toBe(789.12);
            expect(toDecimal(null).toNumber()).toBe(0);
            expect(toDecimal(undefined).toNumber()).toBe(0);
        });

        test('roundCurrency should round to 2 decimal places', () => {
            expect(fromDecimal(roundCurrency(toDecimal(123.456)))).toBe(123.46);
            expect(fromDecimal(roundCurrency(toDecimal(123.454)))).toBe(123.45);
            expect(fromDecimal(roundCurrency(toDecimal(123.455)))).toBe(123.46); // HALF_UP
        });

        test('financiallyEqual should compare within 1 cent tolerance', () => {
            expect(financiallyEqual(toDecimal(100.00), toDecimal(100.00))).toBe(true);
            expect(financiallyEqual(toDecimal(100.00), toDecimal(100.005))).toBe(true);
            expect(financiallyEqual(toDecimal(100.00), toDecimal(100.02))).toBe(false);
        });
    });

    describe('NCD Discount Precision', () => {
        test('60% NCD discount should be exact to the penny', () => {
            const grossPremium = 456.78;
            const ncdPct = 0.60; // 60% discount

            // Using Decimal (implemented solution)
            const decimalResult = fromDecimal(roundCurrency(toDecimal(grossPremium).mul(ncdPct)));

            // Expected: 456.78 * 0.60 = 274.068 → rounds to 274.07
            expect(decimalResult).toBe(274.07);

            // The Decimal result should be deterministic
            const repeat = fromDecimal(roundCurrency(toDecimal(grossPremium).mul(ncdPct)));
            expect(repeat).toBe(decimalResult);
        });

        test('65% NCD discount (5+ years) should be exact', () => {
            const grossPremium = 1234.56;
            const ncdPct = 0.65;

            const result = fromDecimal(roundCurrency(toDecimal(grossPremium).mul(ncdPct)));

            // 1234.56 * 0.65 = 802.464 → rounds to 802.46
            expect(result).toBe(802.46);
        });
    });

    describe('Total Premium Calculation', () => {
        test('Total should match sum of components exactly', () => {
            const subtotal = 400.25;
            const mifSurcharge = 9.0;
            const stampDuty = 0.0;

            const total = fromDecimal(
                roundCurrency(
                    toDecimal(subtotal).plus(mifSurcharge).plus(stampDuty)
                )
            );

            expect(total).toBe(409.25); // Exact to 2 decimal places
        });

        test('Complex calculation with multiple components', () => {
            const riskPremium = 487.33;
            const ncdPct = 0.50;
            const onlineDiscountPct = 0.03;
            const mifSurcharge = 9.0;

            // Step 1: NCD
            const ncdAmount = fromDecimal(roundCurrency(toDecimal(riskPremium).mul(ncdPct)));
            expect(ncdAmount).toBe(243.67); // 487.33 * 0.50 = 243.665 → 243.67

            // Step 2: After NCD
            const afterNcd = fromDecimal(roundCurrency(toDecimal(riskPremium).minus(ncdAmount)));
            expect(afterNcd).toBe(243.66); // 487.33 - 243.67

            // Step 3: Online discount
            const onlineDiscount = fromDecimal(roundCurrency(toDecimal(afterNcd).mul(onlineDiscountPct)));
            expect(onlineDiscount).toBe(7.31); // 243.66 * 0.03 = 7.3098 → 7.31

            // Step 4: After online discount
            const netPremium = fromDecimal(roundCurrency(toDecimal(afterNcd).minus(onlineDiscount)));
            expect(netPremium).toBe(236.35); // 243.66 - 7.31

            // Step 5: Add MIF surcharge
            const total = fromDecimal(roundCurrency(toDecimal(netPremium).plus(mifSurcharge)));
            expect(total).toBe(245.35); // 236.35 + 9.00
        });
    });

    describe('Deterministic Calculation', () => {
        // Phase 6k canonical motor shape — proposer block carries
        // every personal-detail; the test only rates on a handful so
        // we cast the partial to QuoteData (no full-coverage fields
        // required by the pricing path).
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

        test('Same quote should produce identical premium every time', () => {
            let firstResult: number | null = null;

            for (let i = 0; i < 100; i++) {
                const result = calculateAutoInsurancePremium(mockQuoteData);
                const premium = result.premium;

                if (firstResult === null) {
                    firstResult = premium;
                } else {
                    // Every calculation should be BIT-IDENTICAL
                    expect(premium).toBe(firstResult);
                }
            }

            expect(firstResult).not.toBeNull();
            expect(typeof firstResult).toBe('number');
            // Premium should have at most 2 decimal places
            // Convert to string to check decimal places without floating-point multiplication errors
            const premiumStr = firstResult!.toString();
            const decimalPart = premiumStr.split('.')[1];
            expect(decimalPart?.length || 0).toBeLessThanOrEqual(2);
        });

        test('Premium breakdown components should sum to total', () => {
            const result = calculateAutoInsurancePremium(mockQuoteData);

            // Extract breakdown
            const breakdown = result.calculationDetails.costBreakdown;

            // Verify total = subtotal + MIF surcharge + fees
            const calculatedTotal = fromDecimal(
                roundCurrency(
                    toDecimal(breakdown.subtotalNetPremium)
                        .plus(breakdown.mifSurcharge)
                        .plus(breakdown.policyFee)
                )
            );

            // Should match the total premium
            expect(financiallyEqual(toDecimal(calculatedTotal), toDecimal(breakdown.totalPremium))).toBe(true);
        });
    });

    describe('Edge Cases', () => {
        test('Very small premiums should round correctly', () => {
            const amount = 0.005;
            const rounded = fromDecimal(roundCurrency(toDecimal(amount)));
            expect(rounded).toBe(0.01); // Rounds up (HALF_UP)
        });

        test('Very large premiums should maintain precision', () => {
            const amount = 999999.99;
            const withTax = fromDecimal(roundCurrency(toDecimal(amount).plus(9.0)));
            expect(withTax).toBe(1000008.99);
        });

        test('Zero values should be exact', () => {
            const zero = fromDecimal(roundCurrency(toDecimal(0)));
            expect(zero).toBe(0.00);
        });
    });

    describe('Percentage Calculations', () => {
        test('3% online discount should be exact', () => {
            const amounts = [100, 250.50, 456.78, 1234.56];

            amounts.forEach(amount => {
                const discount = fromDecimal(roundCurrency(toDecimal(amount).mul(0.03)));
                const expected = Math.round(amount * 0.03 * 100) / 100;

                // Decimal result should match expected rounded value
                expect(Math.abs(discount - expected)).toBeLessThanOrEqual(0.01);
            });
        });

        test('Multiple percentage operations should not drift', () => {
            let value = toDecimal(1000);

            // Apply 10% discount 5 times
            for (let i = 0; i < 5; i++) {
                value = value.mul(0.9);
            }

            const result = fromDecimal(roundCurrency(value));

            // 1000 * 0.9^5 = 590.49
            expect(result).toBe(590.49);
        });
    });
});

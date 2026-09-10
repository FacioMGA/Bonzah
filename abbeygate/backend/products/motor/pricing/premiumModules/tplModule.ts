/**
 * TPL (Third-Party Liability) Pricing Module
 *
 * CHAMPS: Pure calculation function extracted from autoInsuranceCalculator.ts.
 * Computes the TPL base premium and applies all factor tables.
 */

import { toDecimal, fromDecimal, roundCurrency } from '../../../../platform/utils/decimal.js';
import type { AutoInsurancePremiumCalculation } from '../autoInsurancePricingTypes.js';
import {
    tplBasePremiumFromAge,
    tplMileageFactorFromScheme,
} from '../factors/abbeygateFactors.js';

type TplStep = NonNullable<AutoInsurancePremiumCalculation['calculationDetails']['steps']>[number];

export type TplInputs = {
    age: number;
    kms: number;
    claimsFactor: number;
    licencePeriodFactor: number;
    twoNamedDriversDiscount: number;
    openDriverAgeBandDiscount: number;
    useFactor: number;
    convictionFactor: number;
};

export type TplResult = {
    tplRaw: number;
    tplBase: number;
    tplClaimsFactor: number;
    tplMileageFactor: number;
    tplLicenseFactor: number;
    steps: TplStep[];
};

export function calculateTplPremium(inputs: TplInputs): TplResult {
    const {
        age, kms, claimsFactor, licencePeriodFactor,
        twoNamedDriversDiscount, openDriverAgeBandDiscount, useFactor, convictionFactor,
    } = inputs;

    const steps: TplStep[] = [];

    const tplBase = tplBasePremiumFromAge(age);
    const tplClaimsFactor = claimsFactor;
    const tplMileageFactor = tplMileageFactorFromScheme(kms);
    const tplLicenseFactor = licencePeriodFactor;

    let tplRaw = fromDecimal(
        roundCurrency(
            toDecimal(tplBase)
                .mul(tplClaimsFactor)
                .mul(tplMileageFactor)
                .mul(tplLicenseFactor)
                .mul(twoNamedDriversDiscount)
                .mul(openDriverAgeBandDiscount)
                .mul(useFactor)
                .mul(convictionFactor)
        )
    );

    // Apply Minimum TPL Cap (€140)
    if (tplRaw < 140) tplRaw = 140;

    steps.push({
        id: 'tpl',
        name: 'Third Party Liability (TPL)',
        kind: 'subtotal',
        inputs: { tplBase, tplClaimsFactor, tplMileageFactor, tplLicenseFactor, openDriverAgeBandDiscount },
        output: tplRaw,
        notes: 'Base × claims × mileage × licence, capped at €140',
    });

    return { tplRaw, tplBase, tplClaimsFactor, tplMileageFactor, tplLicenseFactor, steps };
}

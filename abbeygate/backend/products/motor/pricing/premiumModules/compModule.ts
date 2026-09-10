/**
 * Comprehensive (Own-Damage) Pricing Module
 *
 * CHAMPS: Pure calculation function extracted from autoInsuranceCalculator.ts.
 * Handles standard, motorbike, classic, and motorcaravan premium computation.
 */

import { toDecimal, fromDecimal, roundCurrency } from '../../../../platform/utils/decimal.js';
import type { QuoteData } from '../../../../platform/types/autoInsurance.js';
import type { AutoInsurancePremiumCalculation } from '../autoInsurancePricingTypes.js';
import type { AbbeygateAutoCyprus2022Matrix } from '../data/abbeygate-auto-cyprus-2022.schema.js';
import {
    compExcessFactorFromScheme,
    motorcycleBasePremiumFromMatrix,
    motorcycleRiderAgeFactorFromWorkbook,
    motorcycleNcdFactorFromWorkbook,
    motorcycleCountryFactorFromWorkbook,
    motorcycleFixedFeeFromWorkbook,
    lookupBasePremiumFromMatrix,
} from '../factors/abbeygateFactors.js';
import { isCabrioRisk } from '../canonicalRules.js';

type CompStep = NonNullable<AutoInsurancePremiumCalculation['calculationDetails']['steps']>[number];

export type CompInputs = {
    normalizedQuoteData: QuoteData;
    isComprehensive: boolean;
    isTpo: boolean;
    isMotorbike: boolean;
    isClassic: boolean;
    isMotorcaravan: boolean;
    age: number;
    proposerAgeFactor: number;
    vehicleAgeFactor: number;
    claimsFactor: number;
    licencePeriodFactor: number;
    twoNamedDriversDiscount: number;
    openDriverAgeBandDiscount: number;
    useFactor: number;
    convictionFactor: number;
    referenceCompExcess: number;
    classicContext: {
        basePremium: number;
        policyExcess: number;
        mileageBand: string;
        vehicleGroup: string;
        groupMatchType: string;
        ageBand: string;
    } | null;
    matrix: AbbeygateAutoCyprus2022Matrix;
    kms: number;
};

export type CompResult = {
    compRaw: number;
    compBase: number;
    compAgeFactor: number;
    compClaimsFactor: number;
    compExcessFactor: number;
    compLicenseFactor: number;
    motorbikeWorkbookRated: boolean;
    /** Motorbike override of tplRaw (when motorbike TPO). undefined = no override. */
    tplOverride?: number;
    steps: CompStep[];
};

export function calculateCompPremium(inputs: CompInputs): CompResult {
    const {
        normalizedQuoteData, isComprehensive, isTpo, isMotorbike, isClassic,
        isMotorcaravan: _isMotorcaravan,
        age, proposerAgeFactor, vehicleAgeFactor, claimsFactor, licencePeriodFactor,
        twoNamedDriversDiscount, openDriverAgeBandDiscount, useFactor, convictionFactor, referenceCompExcess,
        classicContext, matrix, kms,
    } = inputs;

    const steps: CompStep[] = [];
    let compBase = 0;
    let compAgeFactor = 0;
    let compClaimsFactor = 0;
    let compExcessFactor = 0;
    let compLicenseFactor = 0;
    let compRaw = 0;
    let motorbikeWorkbookRated = false;
    let tplOverride: number | undefined;

    if (!isComprehensive && !isTpo) {
        return { compRaw, compBase, compAgeFactor, compClaimsFactor, compExcessFactor, compLicenseFactor, motorbikeWorkbookRated, steps };
    }

    const engineSize = Number(normalizedQuoteData.engineSize || 0);
    const vehicleValue = normalizedQuoteData.vehicleValue || 0;

    // ── Motorbike Branch ────────────────────────────────────
    if (isMotorbike) {
        compBase = motorcycleBasePremiumFromMatrix(engineSize, matrix.motorcycle.basePremium);
        const riderAgeFactor = motorcycleRiderAgeFactorFromWorkbook(age);
        const ncdFactor = motorcycleNcdFactorFromWorkbook(String(normalizedQuoteData.ncb || ''));
        const countryFactor = motorcycleCountryFactorFromWorkbook(
            String(normalizedQuoteData.countryOfRegistration || normalizedQuoteData.vehicleLocation || '')
        );
        const fixedFee = motorcycleFixedFeeFromWorkbook(
            String(normalizedQuoteData.countryOfRegistration || normalizedQuoteData.vehicleLocation || '')
        );
        const workbookCompBeforeTpo = fromDecimal(
            roundCurrency(
                toDecimal(compBase).mul(riderAgeFactor).mul(ncdFactor).mul(countryFactor)
            )
        );
        const workbookComp = fromDecimal(roundCurrency(toDecimal(workbookCompBeforeTpo).plus(fixedFee)));

        steps.push(
            { id: 'comp.base.motorbike', name: 'Motorbike base premium (cc band)', kind: 'table_lookup', inputs: { engineSize }, output: compBase, notes: 'Motor bike rater base table' },
            { id: 'motorbike.riderAge.workbook', name: 'Motorbike rider age factor', kind: 'factor', inputs: { age }, factor: riderAgeFactor },
            { id: 'motorbike.ncd.workbook', name: 'Motorbike NCD factor', kind: 'factor', inputs: { ncb: normalizedQuoteData.ncb }, factor: ncdFactor },
            { id: 'motorbike.country.workbook', name: 'Motorbike country factor', kind: 'factor', inputs: { country: normalizedQuoteData.countryOfRegistration || normalizedQuoteData.vehicleLocation || 'CY' }, factor: countryFactor },
            { id: 'motorbike.fixedFee.workbook', name: 'Motorbike fixed fee', kind: 'fee', amount: fixedFee },
        );

        if (isTpo) {
            tplOverride = fromDecimal(roundCurrency(toDecimal(workbookCompBeforeTpo).mul(0.6).plus(fixedFee)));
            compRaw = 0;
        } else {
            tplOverride = 0;
            compRaw = workbookComp;
        }
        motorbikeWorkbookRated = true;
        steps.push({
            id: 'comp.subtotal.motorbike.workbook', name: 'Motorbike workbook subtotal', kind: 'subtotal',
            inputs: { compBase, riderAgeFactor, ncdFactor, countryFactor, fixedFee, coverRequired: normalizedQuoteData.coverRequired },
            output: isTpo ? tplOverride : compRaw,
        });
    }

    // ── Classic Branch ──────────────────────────────────────
    else if (isClassic && classicContext) {
        compBase = Number(classicContext.basePremium || 0);
        steps.push({
            id: 'comp.base.classic', name: 'Classic base premium (mileage × vehicle group)', kind: 'table_lookup',
            inputs: {
                make: normalizedQuoteData.make, model: normalizedQuoteData.model,
                vehicleYear: normalizedQuoteData.year, engineSize, kmsPerYear: kms,
                mileageBand: classicContext.mileageBand, vehicleGroup: classicContext.vehicleGroup,
                groupMatchType: classicContext.groupMatchType,
            },
            output: compBase, notes: 'Classic Car rates.xlsx matrix lookup',
        });
    }

    // ── Standard Branch ─────────────────────────────────────
    else {
        // Cabriolet/convertible scheme rule: rate one engine band higher
        // in the base matrix to load for additional roof / body risk.
        const cabrio = isCabrioRisk(normalizedQuoteData);
        const bumpEngineBands = cabrio ? 1 : 0;
        compBase = lookupBasePremiumFromMatrix(
            engineSize,
            Number(vehicleValue || 0),
            matrix.baseMatrix,
            { bumpEngineBands }
        );
        steps.push({
            id: 'comp.base', name: 'Base premium (Engine × Value)', kind: 'table_lookup',
            inputs: { engineSize, vehicleValue, cabrio, bumpEngineBands },
            output: compBase,
            notes: cabrio
                ? 'Hidden Workings matrix lookup (cabriolet: +1 engine band)'
                : 'Hidden Workings matrix lookup',
        });
    }

    // ── Comp Factors (non-motorbike) ────────────────────────
    if (motorbikeWorkbookRated) {
        compAgeFactor = 1.0;
        compClaimsFactor = 1.0;
        compLicenseFactor = 1.0;
    } else {
        compAgeFactor = proposerAgeFactor;
        compClaimsFactor = claimsFactor;
        compLicenseFactor = licencePeriodFactor;
        compExcessFactor = compExcessFactorFromScheme(referenceCompExcess);

        const compBeforeAddedDrivers = fromDecimal(
            roundCurrency(
                toDecimal(compBase)
                    .mul(compAgeFactor).mul(compClaimsFactor).mul(compLicenseFactor)
                    .mul(compExcessFactor).mul(vehicleAgeFactor)
                    .mul(twoNamedDriversDiscount).mul(openDriverAgeBandDiscount).mul(useFactor).mul(convictionFactor)
            )
        );
        compRaw = compBeforeAddedDrivers;

        steps.push(
            { id: 'comp.age', name: 'Proposer age factor', kind: 'factor', inputs: { age }, factor: compAgeFactor },
            { id: 'comp.excess', name: 'Excess factor', kind: 'factor', inputs: { excess: referenceCompExcess }, factor: compExcessFactor, notes: `Excess: €${referenceCompExcess}` },
            { id: 'comp.vehicleAge', name: 'Vehicle age factor', kind: 'factor', inputs: { vehicleYear: normalizedQuoteData.year, factorSource: 'Vehicle Age table' }, factor: vehicleAgeFactor },
            { id: 'comp.licence', name: 'Licence period factor', kind: 'factor', inputs: { proposerLicenseYears: Number(normalizedQuoteData.licenseYears) || 0, effectiveLicenseYears: Number(normalizedQuoteData.licenseYears) || 0 }, factor: compLicenseFactor },
            { id: 'comp.claims', name: 'Claims factor (scheme)', kind: 'factor', inputs: { hasClaims: normalizedQuoteData.hasClaims, claimsCountLast5Years: normalizedQuoteData.claimsCountLast5Years, claimsTotalCostLast5Years: normalizedQuoteData.claimsTotalCostLast5Years, maxFaultClaimCostLast5Years: normalizedQuoteData.maxFaultClaimCostLast5Years }, factor: compClaimsFactor },
            { id: 'comp.convictions', name: 'Convictions factor (scheme)', kind: 'factor', inputs: { hasConvictions: normalizedQuoteData.hasConvictions, convictionClass: normalizedQuoteData.convictionClass, majorConvictionWithinYears: normalizedQuoteData.majorConvictionWithinYears }, factor: convictionFactor },
            { id: 'comp.use', name: 'Vehicle use factor (scheme)', kind: 'factor', inputs: { vehicleUse: normalizedQuoteData.vehicleUse }, factor: useFactor },
        );

        if (twoNamedDriversDiscount !== 1.0) {
            steps.push({ id: 'drivers.twoNamedDiscount', name: 'Named drivers discount', kind: 'factor', inputs: { driverPricingBasis: 'twoNamedDrivers' }, factor: twoNamedDriversDiscount });
        }
        if (openDriverAgeBandDiscount !== 1.0) {
            steps.push({ id: 'drivers.openAgeBandDiscount', name: 'Open driver age-band discount', kind: 'factor', inputs: { driverRestriction: normalizedQuoteData.driverRestriction }, factor: openDriverAgeBandDiscount });
        }

        steps.push({
            id: 'comp.subtotal', name: 'Comprehensive subtotal (pre added-driver loading)', kind: 'subtotal',
            inputs: { compBase, compAgeFactor, compClaimsFactor, compLicenseFactor, vehicleAgeFactor, twoNamedDriversDiscount, openDriverAgeBandDiscount, useFactor, convictionFactor },
            output: compBeforeAddedDrivers,
        });
    }

    return { compRaw, compBase, compAgeFactor, compClaimsFactor, compExcessFactor, compLicenseFactor, motorbikeWorkbookRated, tplOverride, steps };
}

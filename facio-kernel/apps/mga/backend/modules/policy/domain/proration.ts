/**
 * Domain rules and invariants for Endorsements and MTAs (Mid-Term Adjustments).
 * These are pure functions that enforce Abbeygate business logic without side-effects (no DB calls).
 */

import { parseRecord } from '../../../platform/json/parseRecord.js';

function round2(input: number): number {
    if (!Number.isFinite(input)) return 0;
    return Math.round(input * 100) / 100;
}

export function computeCancellationFinancials(input: {
    grossPremium: number;
    policyStart: Date;
    policyEnd: Date;
    cancellationDate: Date;
    nonRefundedFixedAmount: number;
    nonRefundedPct: number;
}) {
    const dayMs = 24 * 60 * 60 * 1000;
    const totalDays = Math.max(1, Math.floor((input.policyEnd.getTime() - input.policyStart.getTime()) / dayMs) + 1);
    const rawDaysInForce = Math.floor((input.cancellationDate.getTime() - input.policyStart.getTime()) / dayMs) + 1;
    const daysInForce = Math.max(0, Math.min(totalDays, rawDaysInForce));
    const daysRemaining = Math.max(0, totalDays - daysInForce);

    // Unearned premium logic
    const unearnedPremium = round2(Number(input.grossPremium || 0) * (daysRemaining / totalDays));

    // Non-refunded fee computation
    const nonRefundedPctAmount = round2(Number(input.grossPremium || 0) * Math.max(0, input.nonRefundedPct) / 100);
    const nonRefundedComponent = round2(Math.max(input.nonRefundedFixedAmount, nonRefundedPctAmount, 0));

    // Final refund calc
    const refundAmount = round2(Math.max(0, unearnedPremium - nonRefundedComponent));
    const earnedPremium = round2(Math.max(0, Number(input.grossPremium || 0) - unearnedPremium));

    return {
        totalDays,
        daysInForce,
        daysRemaining,
        earnedPremium,
        unearnedPremium,
        nonRefundedComponent,
        refundAmount,
    };
}

export function computeRemainingTermMonths(effectiveDate: Date, policyEnd: Date): number {
    const dayMs = 24 * 60 * 60 * 1000;
    const remainingDays = Math.max(1, Math.floor((policyEnd.getTime() - effectiveDate.getTime()) / dayMs));
    return Math.max(1, Math.round((remainingDays / 30.4375) * 100) / 100);
}

export function applyEndorsementTermProration<T extends object>(args: {
    quoteResponse: T;
    policyStart: Date;
    policyEnd: Date;
    draftEnd: Date;
}) {
    const dayMs = 24 * 60 * 60 * 1000;
    const baseDays = Math.max(1, Math.floor((args.policyEnd.getTime() - args.policyStart.getTime()) / dayMs) + 1);
    const draftDays = Math.max(1, Math.floor((args.draftEnd.getTime() - args.policyStart.getTime()) / dayMs) + 1);
    const factorRaw = draftDays / baseDays;
    const factor = Number.isFinite(factorRaw) ? Math.max(0.01, Math.min(3, factorRaw)) : 1;

    if (Math.abs(factor - 1) < 0.0001) {
        return { quoteResponse: args.quoteResponse, factor: 1, baseDays, draftDays };
    }

    const quoteResponseRecord = parseRecord(args.quoteResponse);
    const primaryOption = parseRecord(quoteResponseRecord.primaryOption);
    const costDetails = parseRecord(primaryOption.costDetails);
    const breakdown = parseRecord(primaryOption.breakdown);
    const trace = parseRecord(primaryOption.calculationTrace);
    const steps = Array.isArray(trace.steps) ? trace.steps : [];

    const scale = (value: unknown) => round2((Number(value) || 0) * factor);

    const scaledSteps = steps.map((step) => {
        const row = parseRecord(step);
        const next: Record<string, unknown> = { ...row };
        if (row.amount !== undefined) next.amount = scale(row.amount);
        if (row.output !== undefined) next.output = scale(row.output);
        return next;
    });

    scaledSteps.push({
        id: 'endorsement.term.proration',
        name: 'Endorsement term proration',
        kind: 'adjustment',
        factor: round2(factor),
        notes: `Prorated by policy period (${draftDays}/${baseDays} days).`,
        inputs: { baseDays, draftDays },
    });

    const scaledPrimaryOption = {
        ...primaryOption,
        annualPremium: scale(primaryOption.annualPremium),
        monthlyPremium: scale(primaryOption.monthlyPremium),
        totalPremium: scale(primaryOption.totalPremium),
        breakdown: {
            ...breakdown,
            tplFinal: scale(breakdown.tplFinal ?? breakdown.tpl ?? 0),
            compFinal: scale(breakdown.compFinal ?? breakdown.comp ?? 0),
            finalPremium: scale(breakdown.finalPremium),
        },
        costDetails: {
            ...costDetails,
            grossPremium: scale(costDetails.grossPremium),
            ncdAmount: scale(costDetails.ncdAmount),
            onlineDiscount: scale(costDetails.onlineDiscount),
            subtotalNetPremiumBeforeUwAdj: scale(costDetails.subtotalNetPremiumBeforeUwAdj),
            uwAdjustmentAmount: scale(costDetails.uwAdjustmentAmount),
            subtotalNetPremium: scale(costDetails.subtotalNetPremium),
            mifSurcharge: scale(costDetails.mifSurcharge),
            stampDuty: scale(costDetails.stampDuty),
            policyFee: scale(costDetails.policyFee),
            totalPremium: scale(costDetails.totalPremium),
        },
        calculationTrace: {
            ...trace,
            steps: scaledSteps,
        },
    };

    const nextQuoteResponse = Object.assign({}, quoteResponseRecord, {
        primaryOption: scaledPrimaryOption,
        annualPremium: scale(quoteResponseRecord.annualPremium),
    }) as T;
    const result: { quoteResponse: T; factor: number; baseDays: number; draftDays: number } = {
        quoteResponse: nextQuoteResponse,
        factor,
        baseDays,
        draftDays,
    };
    return result;
}

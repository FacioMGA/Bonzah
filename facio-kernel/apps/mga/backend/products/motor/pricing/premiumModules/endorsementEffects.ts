/**
 * MBE Endorsement Effects Module
 *
 * CHAMPS: Pure function extracted from autoInsuranceCalculator.ts.
 * Processes ADD_EXCESS, ADD_PREMIUM_ROW, and CONDITIONAL_EFFECT rules
 * from applied endorsements.
 */

import { toDecimal, fromDecimal, roundCurrency } from '../../../../platform/utils/decimal.js';
import { MagicBRegistry } from '../../../../modules/mbe/domain/registry.js';

const motorCatalog = () => MagicBRegistry.motorOnly();
import { asRecord, ncdDiscountPctFromScheme } from '../factors/abbeygateFactors.js';
import type {
    AddExcessEffect,
    AddPremiumPctOfNetEffect,
    AddPremiumRowEffect,
    ConditionalEffect,
    EndorsementEffect,
} from '../../../../modules/mbe/domain/types.js';
import type { AutoInsurancePremiumCalculation } from '../autoInsurancePricingTypes.js';

type EffStep = NonNullable<AutoInsurancePremiumCalculation['calculationDetails']['steps']>[number];

export type EndorsementInput = {
    appliedEndorsements: Array<{ code: string; params?: unknown }>;
    quoteDataExtra: Record<string, unknown>;
    /**
     * Subtotal net premium (after NCD, after UW adjustments, before MIF).
     * Required to resolve `ADD_PREMIUM_PCT_OF_NET` effects (see ADR-0023).
     * Optional only for backward compatibility with callers that don't yet
     * pass it; when omitted, percentage-of-net effects evaluate to €0.
     */
    subtotalNetPremium?: number;
    /** Customer's NCB band string from quoteData.ncb (e.g. '5+ Years'). */
    ncb?: string;
    ncdDiscounts: ReadonlyArray<{ ncb: string; discount: number }>;
};

export type EndorsementEffectsResult = {
    mbeAdditionalExcess: number;
    /** Flat per-policy fees applied AFTER tax (e.g. ULR €86). */
    mbeEndorsementPremium: number;
    /**
     * Percentage-of-net loadings applied BEFORE tax (e.g. Protected NCD +10%).
     * The motor calculator adds this between `subtotalNetPremium` and the tax
     * call so it participates in the tax base when the regime is percentage-IPT.
     */
    mbeNetLoadingPremium: number;
    steps: EffStep[];
};

/**
 * Iterate over applied endorsements, resolve their templates from the registry,
 * and sum up excess additions and premium row amounts.
 */
export function processEndorsementEffects(input: EndorsementInput): EndorsementEffectsResult {
    const { appliedEndorsements, quoteDataExtra, subtotalNetPremium, ncb, ncdDiscounts } = input;
    const steps: EffStep[] = [];
    let mbeAdditionalExcess = 0;
    let mbeEndorsementPremium = 0;
    let mbeNetLoadingPremium = 0;

    const catalog = motorCatalog();
    for (const app of appliedEndorsements) {
        const tmpl = catalog.get(app.code);
        if (!tmpl) continue;

        const context = { ...asRecord(tmpl.default_params), ...asRecord(app.params) };

        for (const eff of tmpl.rules.effects) {
            let effectiveEffect: EndorsementEffect = eff;

            if (eff.type === 'CONDITIONAL_EFFECT') {
                const condEff = eff as ConditionalEffect;
                let conditionMet = false;
                const condition = asRecord(condEff.condition);
                if (condition?.type === 'in_territory') {
                    const territory = String(quoteDataExtra.territory || 'CY');
                    if (territory === String(condition.territory || '')) conditionMet = true;
                } else {
                    conditionMet = true;
                }
                if (conditionMet) {
                    effectiveEffect = condEff.effect;
                } else {
                    continue;
                }
            }

            if (effectiveEffect.type === 'ADD_EXCESS') {
                const addExcess = effectiveEffect as AddExcessEffect;
                const amount = Number(context[addExcess.amount_param] || 0);
                if (addExcess.stacking === 'add') {
                    mbeAdditionalExcess = fromDecimal(roundCurrency(toDecimal(mbeAdditionalExcess).plus(amount)));
                    steps.push({
                        id: `endorsement.excess.${app.code}`,
                        name: `Excess (${app.code})`,
                        kind: 'factor',
                        factor: 1,
                        notes: `Additional Excess +€${amount}`,
                    });
                }
            } else if (effectiveEffect.type === 'ADD_PREMIUM_ROW') {
                if (String(app.code || '').trim().toUpperCase() === 'CV 24') {
                    continue;
                }
                const pMap = (effectiveEffect as AddPremiumRowEffect).params_map;
                const amountVal = Number(context[pMap.amount] || 0);

                if (amountVal !== 0) {
                    mbeEndorsementPremium = fromDecimal(roundCurrency(toDecimal(mbeEndorsementPremium).plus(amountVal)));
                    const basisVal = pMap.basis && context[pMap.basis] ? context[pMap.basis] : pMap.basis;
                    const itemName = pMap.item_name || tmpl.title;
                    steps.push({
                        id: `endorsement.premium.${app.code}`,
                        name: itemName,
                        kind: 'fee',
                        amount: amountVal,
                        notes: `Basis: ${basisVal}`,
                    });
                }
            } else if (effectiveEffect.type === 'ADD_PREMIUM_PCT_OF_NET') {
                // Percentage-of-net loading (ADR-0023). Applied BEFORE tax;
                // the motor calculator threads the resulting amount into its
                // premium-payable ladder between `subtotalNetPremium` and the
                // tax call. Gated on optional `min_ncd_pct` prerequisite.
                const pctEff = effectiveEffect as AddPremiumPctOfNetEffect;
                const percentage = Number(pctEff.percentage);
                const itemName = pctEff.item_name || tmpl.title;
                const base = Number(subtotalNetPremium ?? 0);
                const minNcdPct = Number.isFinite(Number(pctEff.min_ncd_pct))
                    ? Number(pctEff.min_ncd_pct)
                    : null;
                const customerNcdPct = ncdDiscountPctFromScheme(String(ncb || ''), ncdDiscounts);
                const prerequisiteMet = minNcdPct === null || customerNcdPct >= minNcdPct;

                if (!prerequisiteMet) {
                    steps.push({
                        id: `endorsement.netLoading.${app.code}`,
                        name: itemName,
                        kind: 'fee',
                        amount: 0,
                        inputs: { percentage, base, customerNcdPct, minNcdPct },
                        notes: `Requires NCD ≥ ${(minNcdPct ?? 0) * 100}% — not charged.`,
                    });
                    continue;
                }

                if (!Number.isFinite(percentage) || percentage === 0 || base <= 0) continue;

                const loading = fromDecimal(roundCurrency(toDecimal(base).mul(percentage)));
                mbeNetLoadingPremium = fromDecimal(
                    roundCurrency(toDecimal(mbeNetLoadingPremium).plus(loading))
                );
                steps.push({
                    id: `endorsement.netLoading.${app.code}`,
                    name: itemName,
                    kind: 'fee',
                    amount: loading,
                    inputs: { percentage, base, customerNcdPct, minNcdPct },
                    notes: `${Math.round(percentage * 1000) / 10}% × €${base}`,
                });
            }
        }
    }

    return { mbeAdditionalExcess, mbeEndorsementPremium, mbeNetLoadingPremium, steps };
}

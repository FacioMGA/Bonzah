import type { RecommendationCatalog, CatalogCandidate, QuoteResponseLike, QuoteOptionLike, AutoBundleAttrs } from '../catalog.js';
import { makeAutoBundleId } from '../catalog.js';
import { normalizeProgramMbeProductConfig, resolveAppliedEndorsementsForQuote } from '../../../../mbe/domain/programProduct.js';
import type { QuoteData } from '../../../../../platform/types/autoInsurance.js';

type PricingModule = typeof import('../../../../../products/motor/pricing/autoInsuranceCalculator.js');
type CanonicalRulesModule = typeof import('../../../../../products/motor/pricing/canonicalRules.js');
const pricingModule: PricingModule = await import('../../../../../products/motor/pricing/autoInsuranceCalculator.js');
const canonicalRulesModule: CanonicalRulesModule = await import('../../../../../products/motor/pricing/canonicalRules.js');

const ALLOWED_EXCESS = [250, 500, 750, 1000];
type UnknownRecord = Record<string, unknown>;
const asRecord = (value: unknown): UnknownRecord =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : {};
const toFinitePositive = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const minimumDeductibleFloor = (quoteData: QuoteData, _quoteResponse: QuoteResponseLike | null): number => {
  const ruleMinimum = canonicalRulesModule.computeCalculatedPolicyExcess(quoteData);
  return Math.max(0, ruleMinimum);
};

/**
 * Abbeygate Motor (MOTOR) bundle catalog.
 *
 * v1 bundle space:
 * - Excess (pricing dimension)\n+ * - Claim protection (CV 172)\n+ * - VIP Roadside (COV-ROADSIDE + COV-ROADSIDE-VIP)\n+ *
 * The catalog produces candidates broadly, then `resolveQuoteOption` computes a priced QuoteOption for
 * candidates that are eligible and realizable under MBE + pricing.
 */
export const abbeygateAutoCatalogV1: RecommendationCatalog = {
  key: 'abbeygate:auto',
  version: '1',
  context: { tenantId: 'default', productType: 'MOTOR' },

  listCandidates(args: { quoteData: QuoteData; quoteResponse: QuoteResponseLike | null }): CatalogCandidate[] {
    const candidates: CatalogCandidate[] = [];
    const minimumExcess = minimumDeductibleFloor(args.quoteData, args.quoteResponse);
    const allowedExcess = ALLOWED_EXCESS.filter((v) => v >= minimumExcess);

    // Conservative default: keep bundle space bounded to avoid explosion.
    // Later: drive the allowed set from tenant config / binder config.
    for (const excess of allowedExcess) {
      for (const claimProtection of [false, true]) {
        for (const vipRoadside of [false, true]) {
          const attrs: AutoBundleAttrs = { excess, claimProtection, vipRoadside };
          candidates.push({ bundleId: makeAutoBundleId(attrs), attrs, optionKey: makeAutoBundleId(attrs) });
        }
      }
    }

    return candidates;
  },

  resolveQuoteOption(args: {
    quoteData: QuoteData;
    quoteResponse: QuoteResponseLike | null;
    candidate: CatalogCandidate;
  }) {
    const c = args.candidate;
    const attrs = asRecord(c.attrs);
    const excess = Number(attrs.excess);
    const claimProtection = Boolean(attrs.claimProtection);
    const vipRoadside = Boolean(attrs.vipRoadside);

    if (!Number.isFinite(excess) || excess <= 0) return null;
    const minimumExcess = minimumDeductibleFloor(args.quoteData, args.quoteResponse);
    if (excess < minimumExcess) return null;

    // Try to map to an existing priced option by excess if the bundle has no add-ons.
    // This preserves UX parity with the current quote response while we expand the bundle space.
    if (!claimProtection && !vipRoadside && args.quoteResponse) {
      const all = [args.quoteResponse.primaryOption, ...(args.quoteResponse.alternatives || [])].filter(Boolean);
      const hit = all.find((o) => Number(o?.voluntaryExcess ?? 0) === excess);
      if (hit) {
        return {
          bundleId: c.bundleId,
          attrs: { excess, claimProtection, vipRoadside },
          quoteOption: hit as QuoteOptionLike,
          optionKey: `excess=${excess}`,
        };
      }
    }

    // Otherwise compute a priced option via pricing engine + MBE applied endorsements.
    // We use program product config defaults but override option enablement explicitly for the bundle.
    const cfg = normalizeProgramMbeProductConfig(asRecord(asRecord(args.quoteData)?.__meta)?.mbeProductConfig);

    // IMPORTANT:
    // Only explicitly override templates we are *actively controlling* in the bundle.
    // Do NOT force-disable defaults from the active program config (that causes premium discrepancies).
    const selectedOptions: Record<string, boolean> = {
      // Explicitly control bundle dimensions so recommendation pricing matches /rate behavior.
      'CV 172': claimProtection,
      // Roadside base is mandatory for abbeygate motor.
      'COV-ROADSIDE': true,
      'COV-ROADSIDE-VIP': vipRoadside,
    };

    const applied = resolveAppliedEndorsementsForQuote({
      quoteData: args.quoteData,
      cfg,
      selectedOptions,
    });

    const calc = pricingModule.calculateAutoInsurancePremium(args.quoteData, excess, applied);
    const resolvedTotalExcess = toFinitePositive(calc?.policyExcess ?? excess);
    if (resolvedTotalExcess < minimumExcess) return null;
    const annualPremium = Number(calc?.calculationDetails?.costBreakdown?.totalPremium ?? calc?.premium ?? 0);

    // Basic sanity: if pricing fails or yields invalid premium, do not emit option.
    if (!Number.isFinite(annualPremium) || annualPremium <= 0) return null;

    const parts: string[] = [];
    parts.push(`Excess €${excess}`);
    if (claimProtection) parts.push('NCB Protection');
    if (vipRoadside) parts.push('VIP Roadside');

    const name = parts.join(' • ');
    const quoteOption: QuoteOptionLike = {
      name,
      annualPremium,
      monthlyPremium: annualPremium ? Math.round((annualPremium / 12) * 100) / 100 : undefined,
      compulsoryExcess: 0,
      voluntaryExcess: excess,
      totalExcess: resolvedTotalExcess,
      tag: 'Recommended',
      description: parts.join(' • '),
      breakdown: calc?.calculationDetails?.premiumBreakdown,
      costDetails: calc?.calculationDetails?.costBreakdown,
      calculationTrace: calc?.calculationDetails?.steps ? { steps: calc.calculationDetails.steps } : undefined,
    };

    return {
      bundleId: c.bundleId,
      attrs: { excess, claimProtection, vipRoadside },
      quoteOption,
      optionKey: c.optionKey || c.bundleId,
    };
  },
};


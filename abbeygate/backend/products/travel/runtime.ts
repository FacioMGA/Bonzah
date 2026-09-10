import type {
  BindRulesResult,
  BuildQuoteResponseContext,
  BuildVersionRowsArgs,
  CustomerJourneyMeta,
  DocPackGenerationArgs,
  DocPackGenerationResult,
  EndorsementPremiumResult,
  QuoteResponseResult,
  UwNormalizationResult,
  VersionMeta,
  VersionRow,
} from '../../modules/policy/domain/productContracts.js';
import type { PremiumCalculation } from '../../platform/types/index.js';
import type { ClaimsContract } from '../../modules/claims/domain/claimsContract.js';
import type { ManifestProductRuntimeConfig } from '../../modules/policy/domain/ManifestRuntimeProductAdapter.js';
import type { ProductEngines, UwEngineResult } from '../../modules/policy/domain/productEngines.js';
import { resolveProductEngines } from '../../modules/policy/domain/productEngines.js';
import { travelManifest } from '@facio/products';
import { calculateTravelPremium, type TravelQuoteData } from './pricing/travelCalculator.js';
import { toTravelPricingQuoteData } from './quoteDataAuthority.js';
import { evaluateTravelUw, DEFAULT_TRAVEL_UW_CONFIG, type UwDecision } from './underwriting/travelUwAutomation.js';
import { travelDefaultClaimsContract } from './claims/defaultClaimsContract.js';
import { travelGoldenFixtures } from './goldenFixtures.js';
import { TRAVEL_REQUIRED_ISSUED_DOC_TYPES } from './documents/documentPackContract.js';

const travelEngines: ProductEngines = {
  rating: {
    engineId: 'travel.compiled.rating',
    kind: 'compiled',
    calculate(input) {
      return { premiumCalculation: calculateTravelPremium(toTravelPricingQuoteData(input.quoteData)).premium };
    },
    buildQuoteResponse(input) {
      return buildTravelQuoteResponse(input.quoteData, input.context);
    },
    async getRatingMatrixSnapshot() {
      return {
        source: 'backend/products/travel/pricing/data/brit-travel-2025.json',
        sheet: 'brit-sept-2025',
        note: 'Plan x tripType x area x coverType x days x age rate cells',
      };
    },
    calculateEndorsementPremium(quoteData, appliedEndorsements = []) {
      const derived = applyTravelEndorsementsToQuoteData(stripTravelOptionalCoverageState(toTravelPricingQuoteData(quoteData)), appliedEndorsements);
      const { breakdown } = calculateTravelPremium(derived);
      return Promise.resolve({ premium: breakdown.grossPremium, policyExcess: 0 });
    },
  },
  underwriting: {
    engineId: 'travel.compiled.uw',
    kind: 'compiled',
    evaluate(input): UwEngineResult {
      const qd = toTravelPricingQuoteData(input.quoteData);
      const decision = evaluateTravelUw(mapTravelUwInput(qd), DEFAULT_TRAVEL_UW_CONFIG);
      const decisionAsRecord = uwDecisionToRecord(decision);
      return { decision: decisionAsRecord, analysis: decisionAsRecord };
    },
  },
  wording: {
    engineId: 'travel.compiled.wording',
    kind: 'compiled',
    getDocPackJobName() {
      return 'DOC.GENERATE_TRAVEL_DOC_PACK';
    },
    async render(args) {
      // Production wording engine: renders Handlebars templates → PDF →
      // uploads to storage → persists Document rows. The previous stub
      // returned only `TRAVEL_SCHEDULE_PDF` with a `stub://...` URI and
      // never wrote a `Document` row, which caused
      // `DOC.GENERATE_ISSUED_POLICY_PACK` to throw on the missing
      // `TRAVEL_CERTIFICATE_PDF` and the welcome-email orchestrator to
      // fail with `Issued-pack DB validation failed (missing docs)`.
      const { executeTravelDocPackGeneration } = await import('./documents/generateTravelDocPack.js');
      return executeTravelDocPackGeneration({
        policyId: args.policyId,
        riskTransactionId: args.riskTransactionId ?? null,
        docPack: args.docPack,
        source: args.source,
        generatedByUserId: args.generatedByUserId ?? null,
        templateVersion: args.templateVersion ?? undefined,
        db: args.db as never,
      });
    },
  },
};

export const travelProductRuntimeConfig: ManifestProductRuntimeConfig = {
  productType: 'TRAVEL',
  displayName: 'Travel Insurance',
  executionMode: 'runtime_config',
  manifest: travelManifest,
  defaultClaimsContract: travelDefaultClaimsContract satisfies ClaimsContract,
  requiredIssuedDocTypes: TRAVEL_REQUIRED_ISSUED_DOC_TYPES,
  goldenFixtures: travelGoldenFixtures,
  customerJourney: { pricingStep: 'quote', uwStep: 'trip-details', detailsStep: 'policy-holder' },
  intake: {
    publicSessionSlug: 'travel',
    publicEntryPath: '/quote/travel/new',
    firstStep: 'eligibility',
    validationMode: 'manifest_only',
  },
  rating: {
    framework: 'unified-rating',
    mode: 'table_assets',
    assetRefs: ['backend/products/travel/pricing/data/brit-travel-2025.json'],
    traceSchemaVersion: 'v1',
  },
  engines: travelEngines,
  getDocPackJobName(): string {
    return resolveProductEngines(travelProductRuntimeConfig.engines).wording.getDocPackJobName();
  },
  calculatePremium(data: unknown): PremiumCalculation {
    const result = resolveProductEngines(travelProductRuntimeConfig.engines).rating.calculate({ productType: 'TRAVEL', quoteData: data });
    if (result instanceof Promise) throw new Error('Travel rating engine returned async result for calculatePremium');
    return result.premiumCalculation;
  },
  async buildQuoteResponse(quoteData: unknown, _programMeta: unknown, context?: BuildQuoteResponseContext): Promise<QuoteResponseResult> {
    return resolveProductEngines(travelProductRuntimeConfig.engines).rating.buildQuoteResponse({ productType: 'TRAVEL', quoteData, context });
  },
  validateBindRules(_quoteData: unknown, _binderConfig: unknown): BindRulesResult {
    return { valid: true, errors: [] };
  },
  normalizeUwData(quoteData: unknown): UwNormalizationResult {
    const qd = asRecord(quoteData);
    return {
      normalizedQuoteData: qd,
      productFields: {
        tripInfo: asRecord(qd.trip),
        travellersInfo: asRecord(qd.travellers),
      },
    };
  },
  buildVersionMeta(quoteData: unknown): VersionMeta {
    const qd = asRecord(quoteData);
    const trip = asRecord(qd.trip);
    const plan = String(asRecord(qd.quote).selectedPlan || 'silver');
    return {
      sectionLabel: 'Travel',
      coverageLabel: `${plan.charAt(0).toUpperCase() + plan.slice(1)} — ${trip.planType || 'single_trip'}`,
      insuredValueDisplay: `${Array.isArray(trip.destinations) ? trip.destinations.length : 0} destination(s)`,
      bdxClassOfBusiness: 'TRAVEL',
    };
  },
  getCustomerJourneyMeta(): CustomerJourneyMeta {
    return travelProductRuntimeConfig.customerJourney;
  },
  buildVersionRows(args: BuildVersionRowsArgs): VersionRow[] {
    return [{
      section: 'Travel',
      riskTransType: args.riskTransTypeLabel,
      limitText: args.versionMeta?.coverageLabel || 'Plan',
      excessText: '—',
      premium: args.premiumDeltaTotal,
      currency: 'EUR',
    }];
  },
  async generateDocPack(args: DocPackGenerationArgs): Promise<DocPackGenerationResult> {
    return resolveProductEngines(travelProductRuntimeConfig.engines).wording.render(args);
  },
  async getRatingMatrixSnapshot(): Promise<Record<string, unknown> | null> {
    return resolveProductEngines(travelProductRuntimeConfig.engines).rating.getRatingMatrixSnapshot();
  },
  async calculateEndorsementPremium(
    quoteData: unknown,
    appliedEndorsements: Array<{ code: string; params?: unknown }> = [],
  ): Promise<EndorsementPremiumResult> {
    return resolveProductEngines(travelProductRuntimeConfig.engines).rating.calculateEndorsementPremium(quoteData, appliedEndorsements);
  },
};

async function buildTravelQuoteResponse(quoteData: unknown, context?: BuildQuoteResponseContext): Promise<QuoteResponseResult> {
  // ABY-258 — `applied` is the MBE-resolved endorsement codes; we
  // additionally merge any raw `quoteData.addons.<flag>=true` so the
  // customer's wizard selections never silently fall off the rate
  // (see `mergedAppliedEndorsements` docstring for the failure modes
  // observed in production).
  const merged = mergedAppliedEndorsements(quoteData, context?.resolvedCoverageSet?.applied);
  const qd = applyTravelEndorsementsToQuoteData(
    stripTravelOptionalCoverageState(toTravelPricingQuoteData(quoteData)),
    merged,
  );
  const uwDecision = evaluateTravelUw(mapTravelUwInput(qd), DEFAULT_TRAVEL_UW_CONFIG);

  if (uwDecision.lane === 'decline') {
    return {
      quoteResponse: { status: 'DECLINED', uwDecision, primaryOption: null },
      underwritingAnalysis: uwDecisionToRecord(uwDecision),
    };
  }

  // ADR-0054 — a declared prior travel claim over €500 is a hard referral
  // with NO auto price. Surface the UW-owned reason (code + verbatim copy)
  // and null the primaryOption, mirroring the decline short-circuit. The
  // calculator also refers for this band as a defensive backstop.
  if (uwDecision.lane === 'referral' && uwDecision.reasons.some((r) => r.code === 'PRIOR_TRAVEL_CLAIM_OVER_THRESHOLD')) {
    return {
      quoteResponse: { status: 'REFERRAL', uwDecision, primaryOption: null },
      underwritingAnalysis: uwDecisionToRecord(uwDecision),
    };
  }

  // Compute the WITH-ADDONS premium for the currently selected plan.
  // Drives `primaryOption.annualPremium` (the actual billed gross) and
  // the lane decision (decline / referral). Spread qd.quote so
  // maxTripDays (and any other quote fields) are preserved — without
  // this, Annual Multi-Trip calls reach resolveMaxTripDays with
  // undefined and throw.
  //
  // ABY-251 — the per-plan COMPARISON premiums on `planOptions` are
  // computed separately below as NO-ADDON gross so the Step 4 plan
  // picker doesn't inflate every plan price by the customer's current
  // addon selection. The `silverResult/goldResult/platinumResult` trio
  // that used to live here was a one-to-one shadow of the now-canonical
  // `silverNoAddon/goldNoAddon/platinumNoAddon` below and has been
  // removed — `selectedResult` is the only WITH-ADDONS computation we
  // still need at this level.
  const calcForPlan = (plan: 'silver' | 'gold' | 'platinum') =>
    calculateTravelPremium({ ...qd, quote: { ...qd.quote, selectedPlan: plan } });

  const selectedResult = calcForPlan((qd.quote?.selectedPlan as 'silver' | 'gold' | 'platinum') || 'silver');
  const { premium, breakdown, refer, reason, declined, declineReason } = selectedResult;

  if (declined) {
    return {
      quoteResponse: {
        status: 'DECLINED',
        uwDecision: { lane: 'decline', reasons: [{ code: 'NO_RATE', message: declineReason || 'No rate available' }] },
        primaryOption: null,
      },
      underwritingAnalysis: { lane: 'decline' },
    };
  }
  if (refer) {
    return {
      quoteResponse: {
        status: 'REFERRAL',
        uwDecision: { lane: 'referral', reasons: [{ code: 'RATE_REFERRAL', message: reason || 'Manual review required' }] },
        primaryOption: null,
      },
      underwritingAnalysis: { lane: 'referral' },
    };
  }

  // ABY-251 / ABY-272 — every consumer needs the no-addon gross premium
  // of each plan tier:
  //   - The Step 4 plan picker compares plans against each other and MUST
  //     show the price of each plan as if the customer had selected no
  //     addons (otherwise the prices visibly inflate the moment the
  //     customer adds an addon on Step 5 and then comes back to Step 4
  //     to switch tier — every plan would carry the same addon load).
  //   - The Step 5/6 wizard sidebar reads `breakdown.lines` directly
  //     (ABY-264) so the customer sees Base / each Addon / Tax / Admin
  //     fee / Total as separate, honest line items. ABY-272 retired the
  //     legacy `noAddonGrossPremium + Σ addonGrossPrices` identity
  //     because admin fee and IPT scale with the net premium and don't
  //     sit on the addon — those numbers were a polite lie. The new
  //     spine is: addon card price === breakdown addon line === the
  //     calculator's `addonBreakdown[flag]`. Period.
  //
  // Computed once here from a single stripped baseline so the surfaces
  // above can never drift. `primaryOption.noAddonGrossPremium` remains
  // the plan-price field used by the Step 4 plan picker comparison.
  const strippedForPlanCompare = stripTravelOptionalCoverageState(qd);
  const calcForPlanNoAddon = (plan: 'silver' | 'gold' | 'platinum') =>
    calculateTravelPremium({
      ...strippedForPlanCompare,
      quote: { ...strippedForPlanCompare.quote, selectedPlan: plan },
    });
  const silverNoAddon = calcForPlanNoAddon('silver');
  const goldNoAddon = calcForPlanNoAddon('gold');
  const platinumNoAddon = calcForPlanNoAddon('platinum');
  const selectedPlanCode = (qd.quote?.selectedPlan as 'silver' | 'gold' | 'platinum') || 'silver';
  const selectedNoAddon =
    selectedPlanCode === 'silver' ? silverNoAddon : selectedPlanCode === 'gold' ? goldNoAddon : platinumNoAddon;
  const noAddonGrossPremium =
    selectedNoAddon.declined || selectedNoAddon.refer ? null : selectedNoAddon.breakdown.grossPremium;

  const primaryOption = {
    annualPremium: premium.premium,
    // ABY-251 — no-addon gross premium of the currently selected plan,
    // used by the Step 4 plan-comparison line. The Step 5/6 wizard
    // sidebar reads `breakdown.lines` directly (ABY-264 / ABY-272) so
    // this field is no longer the basis for any addition identity —
    // it is purely the comparison number on the plan picker.
    noAddonGrossPremium,
    netPremium: breakdown.netPremium,
    iptAmount: breakdown.iptAmount,
    adminFee: breakdown.adminFee,
    breakdown,
    costDetails: { subtotalNetPremium: breakdown.netPremium },
  };

  // Per-plan premiums for the plan comparison UI (Step 4 plan picker).
  // ABY-251 — these are the NO-ADDON gross premiums (base + IPT + admin
  // fee). See the `noAddonGrossPremium` block above for why. The selected
  // plan's WITH-ADDONS gross remains on `primaryOption.annualPremium`.
  // Gracefully omit a plan if it has no rate.
  const toPlanOption = (result: ReturnType<typeof calculateTravelPremium>) =>
    result.declined || result.refer
      ? null
      : { premium: result.premium.premium, breakdown: result.breakdown };

  const planOptions = {
    silver: toPlanOption(silverNoAddon),
    gold: toPlanOption(goldNoAddon),
    platinum: toPlanOption(platinumNoAddon),
  };

  // Minimum annual multi-trip premium for the upsell banner.
  // Always uses the default max-trip-days of 17 and the silver tier.
  const annualSilverResult = calculateTravelPremium({
    ...qd,
    quote: { selectedPlan: 'silver', maxTripDays: 17 },
    trip: { ...qd.trip, planType: 'annual_multi_trip' },
  });
  const annualMinPremium =
    annualSilverResult.declined || annualSilverResult.refer
      ? null
      : annualSilverResult.premium.premium;

  // Per-addon prices for the wizard options step ("+€X.XX" stamp on each
  // addon card) and the BO coverage tab.
  //
  // ABY-272 — these MUST be the exact same numbers the canonical
  // `breakdown.lines` array will surface once the customer adds the
  // addon (`breakdown.addonBreakdown[flag]`). Previously this map was
  // computed as `Δ grossPremium = (with-addon gross) - (no-addon gross)`,
  // which silently included a slice of admin-fee and IPT swings that
  // also move when the net premium tier changes. The customer saw
  // "Business Cover +€31" on the card and then "Business Cover €20" in
  // the breakdown for the SAME addon on the SAME screen — three
  // pricing functions for one business concept, exactly the spine
  // violation `docs/architecture/contracts/canonical-ownership.md`
  // forbids. The calculator's per-addon line is the single writer; the
  // card now reads it verbatim.
  //
  // Keys are the addon flag names (winterSports, businessCover, …) to
  // match the form field path `addons.<flag>` used in both the wizard
  // and the manifest.
  //
  // ABY-247 still holds: the per-addon line is independent of which
  // addons are already applied, because `calculateAddonAmount` derives
  // it from `basePremium` × catalogue rule, not from
  // `(grossPremium - selectedNoAddon)` — so toggling one addon never
  // collapses another's price to zero.
  const baseForSelected: TravelQuoteData = {
    ...strippedForPlanCompare,
    quote: { ...strippedForPlanCompare.quote, selectedPlan: selectedPlanCode },
  };

  const ADDON_FLAGS = [
    'winterSports',
    'businessCover',
    'golfCover',
    'terrorism',
    'sportsEquipment',
    'wedding',
    'gadget',
  ] as const;

  const addonPrices: Record<string, number> = {};
  for (const flag of ADDON_FLAGS) {
    const withAddon = calculateTravelPremium({ ...baseForSelected, addons: { [flag]: true } });
    if (withAddon.declined || withAddon.refer) continue;
    const lineAmount = withAddon.breakdown.addonBreakdown[flag];
    if (typeof lineAmount === 'number' && lineAmount > 0) {
      addonPrices[flag] = Number(lineAmount.toFixed(2));
    }
  }

  return {
    quoteResponse: {
      status: uwDecision.lane === 'referral' ? 'REFERRAL' : 'QUOTED',
      currency: 'EUR',
      primaryOption,
      planOptions,
      annualMinPremium,
      addonPrices,
      uwDecision,
    },
    underwritingAnalysis: uwDecisionToRecord(uwDecision),
  };
}

/**
 * Lift a structurally-typed UwDecision into the platform's Record<string, unknown>
 * UwEngineResult contract. Explicit field copy avoids any broad cast.
 */
function uwDecisionToRecord(d: UwDecision): Record<string, unknown> {
  return { lane: d.lane, reasons: d.reasons, isExpat: d.isExpat };
}

function mapTravelUwInput(qd: TravelQuoteData) {
  const trip = asRecord(qd.trip);
  const travellers = asRecord(qd.travellers);
  const eligibility = asRecord(qd.eligibility);
  const risk = asRecord(qd.risk);
  const travellerDobValues = [
    String(travellers.leadTravellerDOB || ''),
    ...(Array.isArray(travellers.additionalTravellerDOBs) ? travellers.additionalTravellerDOBs.map(String) : []),
  ].filter((dob) => dob.trim());
  const oldestTravellerAge = travellerDobValues.length
    ? Math.max(...travellerDobValues.map((dob) => ageFromDOB(dob)))
    : ageFromDOB('');
  const leadDob = String(travellers.leadTravellerDOB || '');
  return {
    leadTravellerAge: oldestTravellerAge,
    policyholderAge: leadDob.trim() ? ageFromDOB(leadDob) : undefined,
    destinations: Array.isArray(trip.destinations) ? trip.destinations.map(String) : [],
    countryOfResidence: String(eligibility.countryOfResidence || ''),
    tripDurationDays: tripDurationDays(String(trip.startDate || ''), String(trip.endDate || '')),
    tripType: String(trip.planType || '') === 'annual_multi_trip' ? 'Multi trip' : 'Single trip',
    // ADR-0025 objective expat eligibility inputs.
    nationality: String(eligibility.nationality || ''),
    hasOtherNationality: eligibility.hasOtherNationality === true,
    otherNationality: String(eligibility.otherNationality || ''),
    willRemainResident: eligibility.willRemainResident === true ? true : eligibility.willRemainResident === false ? false : undefined,
    legallyPermittedToReside: eligibility.legallyPermittedToReside === true ? true : eligibility.legallyPermittedToReside === false ? false : undefined,
    informationAccurate: eligibility.informationAccurate === true ? true : eligibility.informationAccurate === false ? false : undefined,
    // ADR-0054 prior-claims history — drives the over-€500 referral.
    hasPreviousTravelClaim: risk.hasPreviousTravelClaim === true,
    previousTravelClaimBand:
      risk.previousTravelClaimBand === 'up_to_500' || risk.previousTravelClaimBand === 'over_500'
        ? (risk.previousTravelClaimBand as 'up_to_500' | 'over_500')
        : undefined,
  };
}

function stripTravelOptionalCoverageState(base: TravelQuoteData): TravelQuoteData {
  return {
    ...base,
    addons: {},
  };
}

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
}

function ageFromDOB(dob: string): number {
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return 30;
  const today = new Date();
  let age = today.getFullYear() - d.getFullYear();
  const m = today.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age -= 1;
  return age;
}

function tripDurationDays(startIso: string, endIso: string): number {
  const s = new Date(startIso); const e = new Date(endIso);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return 9;
  return Math.max(1, Math.ceil((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)));
}

/**
 * Bidirectional addon mapping (single source of truth).
 *
 * `TRAVEL_ADDON_CODE_TO_FLAG` drives `applyTravelEndorsementsToQuoteData`
 * (post-strip restoration from MBE-resolved endorsement codes back into
 * the `quoteData.addons.<flag>` shape the calculator reads).
 *
 * `TRAVEL_ADDON_FLAG_TO_CODE` drives `mergedAppliedEndorsements`
 * (ABY-258 — defensive bridge so the customer's selected flags from
 * `quoteData.addons.*` always reach the rate calculation, even if the
 * MBE coverage resolver returns an empty `applied` array — which is the
 * shape we caught in production on session `KR6gpbSR…` and on the
 * already-issued `ABOLV1000097`).
 */
const TRAVEL_ADDON_CODE_TO_FLAG: Readonly<Record<string, string>> = Object.freeze({
  'TRAVEL-WINTER-SPORTS': 'winterSports',
  'TRAVEL-BUSINESS-COVER': 'businessCover',
  'TRAVEL-GOLF-COVER': 'golfCover',
  'TRAVEL-TERRORISM': 'terrorism',
  'TRAVEL-SPORTS-EQUIPMENT': 'sportsEquipment',
  'TRAVEL-WEDDING': 'wedding',
  'TRAVEL-GADGET': 'gadget',
});

const TRAVEL_ADDON_FLAG_TO_CODE: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    Object.entries(TRAVEL_ADDON_CODE_TO_FLAG).map(([code, flag]) => [flag, code]),
  ),
);

/**
 * ABY-258 — merge the customer's selected addon flags from
 * `quoteData.addons.*` with the MBE-resolved endorsement codes on
 * `context.resolvedCoverageSet.applied`.
 *
 * Why this exists
 * ---------------
 * `buildTravelQuoteResponse` strips `quoteData.addons` before rating
 * and re-applies only what arrives via `context.resolvedCoverageSet.applied`.
 * The spine-correct path is for the MBE coverage resolver to translate
 * `addons.gadget=true` into `{ code: 'TRAVEL-GADGET' }` via the
 * `selectedWhen` rule on the endorsement template — and a contract test
 * (`coverageSelectionContract.test.ts:98-115`) proves it works in
 * isolation. But in production we observed empty `applied` arrays
 * even when `quoteData.addons` had 5 flags set to `true` (Effie's
 * `KR6gpbSR…` session, `ABOLV1000097` already issued + active with
 * `addons.gadget=true` but `breakdown.addonsTotal=0`). Customer paid
 * for a policy that did not include the addons they had selected.
 *
 * Possible upstream failure modes (any of these silently zeroes
 * `applied`):
 *  - `snapshot.coverageSelection.selected['TRAVEL-GADGET'] === false`
 *    explicitly disables the addon even when `addons.gadget === true`
 *  - Program metadata `mbeProductConfig` missing travel options on
 *    production
 *  - Silent fallthrough in `resolveEffectiveCoverageContract`
 *
 * Belt-and-suspenders: if the resolver works the explicit set wins
 * (set-based dedup on the uppercase code); if it falls over for any
 * of the reasons above, raw flags from `quoteData.addons` are still
 * honoured.
 */
function mergedAppliedEndorsements(
  quoteData: unknown,
  applied: Array<{ code: string; params?: unknown }> | undefined,
): Array<{ code: string; params?: unknown }> {
  const explicit = applied || [];
  const explicitCodes = new Set(explicit.map((e) => String(e.code || '').toUpperCase()));
  const qdRecord = asRecord(quoteData);
  const addonsRecord = asRecord(qdRecord.addons) as Record<string, unknown>;
  const fromFlags: Array<{ code: string }> = [];
  for (const [flag, code] of Object.entries(TRAVEL_ADDON_FLAG_TO_CODE)) {
    if (addonsRecord[flag] === true && !explicitCodes.has(code.toUpperCase())) {
      fromFlags.push({ code });
    }
  }
  return fromFlags.length === 0 ? explicit : [...explicit, ...fromFlags];
}

function applyTravelEndorsementsToQuoteData(
  base: TravelQuoteData,
  applied: Array<{ code: string; params?: unknown }>,
): TravelQuoteData {
  const codes = new Set(applied.map((e) => String(e.code || '').toUpperCase()));
  const addonsBase = base && typeof base === 'object' && 'addons' in base && base.addons && typeof base.addons === 'object'
    ? (base.addons as Record<string, boolean>)
    : {};
  const addons: Record<string, boolean> = { ...addonsBase };
  for (const [code, flag] of Object.entries(TRAVEL_ADDON_CODE_TO_FLAG)) {
    if (codes.has(code)) addons[flag] = true;
  }
  const enriched: TravelQuoteData = { ...base, addons };
  return enriched;
}

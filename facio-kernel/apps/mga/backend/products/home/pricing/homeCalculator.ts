import type { PremiumCalculation } from '../../../platform/types/index.js';
import type { CalculationStep } from '../../../platform/types/pricing.js';
import { getTenantConfig } from '../../../platform/tenant/tenantConfig.js';
import { applyTenantTaxes } from '../../shared/tenantTaxes.js';
import { resolveJurisdictionProductConfig } from '../../../modules/jurisdiction/domain/productConfiguration.js';
import {
  type PropertyUse,
  type HomeRates,
  type HomePricingRules,
  type WorkbookRateBlock,
} from './data/loader.js';
import { classifyWildfireRisk, type WildfireRiskClassification } from '../underwriting/wildfireRisk.js';
import { HOME_SOLAR_PANEL_DEFAULT_CALCULATOR_VERSION } from '@facio/products';

// ADR-0014 (closed by PR 5): home rate cards live as JSON + zod + loader
// at `data/loader.js`. The previous deprecated re-export shim is gone;
// consumers import from the loader. The deleted import path is pinned
// by `tools/quality/deleted-identifiers.json`.
export const HOME_CALCULATOR_VERSION = HOME_SOLAR_PANEL_DEFAULT_CALCULATOR_VERSION;

/**
 * Home pricing engine.
 *
 * Sources:
 *   - Base rates: 3rd Version HOME Calculator NEW 14-3-2022.xlsx, uplifted
 *     +20% across all territories (Peter Sheppard 2026-08-18: "add 20% to
 *     the base rates before discounts, all territories"). The uplift lives
 *     in the rate card values themselves (home-rates-2026.json, ADR-0074)
 *     — every loading, discount, term, fee and minimum is unchanged.
 *   - Loadings: combustible wooden (100%), static caravan (25%), previous claims.
 *   - Discounts: NCB, increased excess, age 45+, alarm, property age.
 *   - Minimum premium: 100 EUR.
 *   - IPT + admin: per legacy Abbeygate Home schedule the Cyprus binder
 *     has **no policy-level IPT** (Local Taxes line is always 0.00 — the
 *     insurer settles any local tax outside the customer bill). PT keeps
 *     the rate-based IPT (9%). ES uses 8.15% net + CCS rider; GR uses a
 *     15% rate via the tenant table.
 */

export interface HomeQuoteData {
  propertyUse?: PropertyUse;
  propertyType?: string;
  propertyTown?: string;
  propertyProvince?: string;
  propertyPostcode?: string;
  propertyCountry?: string;
  wildfireOfficialHazardClass?: string;
  buildingsSumInsured?: number;
  contentsSumInsured?: number;
  accidentalDamageBuildings?: boolean;
  accidentalDamageContents?: boolean;
  allRiskJewellery?: number;
  allRiskOther?: number;
  solarPanels?: number;

  woodenConstruction?: boolean;
  nonCombustibleMaterial?: boolean;
  alarm?: boolean | 'Yes' | 'No';
  yearBuilt?: 'Prior to 1980' | '1980 to 1989' | '1990 or Later';
  previousClaims?: 'None' | '1 claim < 1000' | '2 claims < 3000' | '3 claims or > 3000';
  noClaimsDiscount?: '0 Years' | '1 Year' | '2 Years' | '3 Years' | '4 Years' | '5+ Years';
  increasedExcess?: 'STD 150 XS' | '350 XS' | '750 XS';
  proposerOver45?: boolean;
  proposerDomicileCountry?: string;
  discretionaryDiscount?: number; // 0 - 0.20
  greekPostcode?: '10' | '11' | 'kefalonia' | 'zakinthos' | 'lefkada' | 'santorini' | 'other';
  europAssistance?: boolean;
}

export interface HomeBreakdown {
  buildingsRate: number;
  contentsRate: number;
  jewelleryRate: number;
  otherAllRisksRate: number;
  buildingsPremium: number;
  contentsPremium: number;
  jewelleryPremium: number;
  otherAllRisksPremium: number;
  basePremium: number;
  loadings: number;
  loadingBreakdown: Record<string, number>;
  afterLoadings: number;
  discounts: number;
  discountBreakdown: Record<string, number>;
  afterDiscounts: number;
  wildfireRisk?: WildfireRiskClassification;
  /**
   * Underwriting profit loading amount in EUR (ADR-0036) — `afterDiscounts × rate`.
   * Sits between `afterDiscounts` and `netPremium`; `netPremium` is the
   * LOADED amount (i.e. `afterDiscounts + uwProfitLoading`) that the
   * tax engine and minimum-premium floor see.
  */
  uwProfitLoading: number;
  /**
   * Europ Assistance partner pass-through in EUR (ADR-0042). This is
   * payable by the customer but is not part of underwritten net premium.
   */
  europAssistanceFee: number;
  netPremium: number;
  iptAmount: number;
  adminFee: number;
  grossPremium: number;
}

function asNumber(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function isTrue(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  const s = String(v || '').trim().toLowerCase();
  return s === 'yes' || s === 'true' || s === '1';
}

function configuredRate(rates: Record<string, number>, key?: string): number {
  return key ? rates[key] ?? 0 : 0;
}

function propertyAgeDiscount(yearBuilt: string | undefined, rules: HomePricingRules): number {
  return configuredRate(rules.propertyAgeDiscounts, yearBuilt);
}

function ncbDiscount(ncb: string | undefined, rules: HomePricingRules): number {
  return configuredRate(rules.noClaimsDiscounts, ncb);
}

function increasedExcessDiscount(excess: string | undefined, rules: HomePricingRules): number {
  return configuredRate(rules.increasedExcessDiscounts, excess);
}

function claimsLoading(claims: string | undefined, rules: HomePricingRules): number {
  return configuredRate(rules.previousClaimsLoadings, claims);
}

function greekPostcodeLoading(pc: string | undefined, rules: HomePricingRules): number {
  return pc && rules.greekPostcodeLoading.postcodes.includes(pc) ? rules.greekPostcodeLoading.rate : 0;
}

function wildfireLoading(input: HomeQuoteData, rates: HomeRates): { rate: number; classification: WildfireRiskClassification | null } {
  if (!input.propertyCountry) return { rate: 0, classification: null };
  const classification = classifyWildfireRisk({
    country: input.propertyCountry,
    town: input.propertyTown,
    province: input.propertyProvince,
    postcode: input.propertyPostcode,
    officialHazardClass: input.wildfireOfficialHazardClass,
  });
  if (classification.tier === 'amber') return { rate: rates.wildfireLoading.amber, classification };
  if (classification.tier === 'yellow') return { rate: rates.wildfireLoading.yellow, classification };
  if (classification.tier === 'green') return { rate: rates.wildfireLoading.green, classification };
  return { rate: 0, classification };
}

export function calculateHomePremium(input: HomeQuoteData, rates: HomeRates): { premium: PremiumCalculation; breakdown: HomeBreakdown; declined: boolean; declineReason?: string } {
  const tenant = getTenantConfig();
  const jurisdictionConfig = resolveJurisdictionProductConfig({ productCode: 'HOME', tenant });
  void jurisdictionConfig;
  // `spine/v2` Wave 5: tax-profile validity is now guaranteed at config
  // time. CY/HOME has no entry in `CONFIGS`, so resolve fails loud
  // before we get here. PT/HOME always has `PT_HOME_TENANT_IPT_TEMPORARY`.
  const use: PropertyUse = input.propertyUse === 'Holiday' ? 'Holiday' : 'Permanent';
  // Required sums must be validated by the profile/wizard before reaching
  // the calculator — refuse silent NaN/undefined fallback. Buildings or
  // contents may legitimately be 0 (contents-only / buildings-only policy)
  // but at least one MUST be positive.
  const buildings = Number(input.buildingsSumInsured);
  const contents = Number(input.contentsSumInsured);
  if (!Number.isFinite(buildings) || buildings < 0) {
    throw new Error('[homeCalculator] buildingsSumInsured must be a non-negative finite number — refusing silent fallback. Validate upstream.');
  }
  if (!Number.isFinite(contents) || contents < 0) {
    throw new Error('[homeCalculator] contentsSumInsured must be a non-negative finite number — refusing silent fallback. Validate upstream.');
  }
  if (buildings === 0 && contents === 0) {
    throw new Error('[homeCalculator] both buildings and contents are 0 — at least one must be positive. Validate upstream.');
  }
  const block = rates.workbook[tenant.countryCode]?.[use] ?? null;

  if (!block) {
    return {
      premium: {
        premium: 0,
        basis: 'HYBRID',
        calculationDetails: {
          steps: [{
            id: 'home.declined', name: 'Declined', kind: 'total',
            inputs: { country: tenant.country, use }, output: 0,
            notes: `Home insurance not offered for ${tenant.country}/${use}`,
          }],
          calculatorVersion: HOME_CALCULATOR_VERSION,
        },
      },
      breakdown: zeroBreakdown(),
      declined: true,
      declineReason: `Home insurance not offered for ${tenant.country}/${use}`,
    };
  }

  const steps: CalculationStep[] = [];

  const jewelleryRate = block.jewellery ?? 0;
  const otherAllRisksRate = block.otherAllRisks ?? 0;

  const buildingsPremium = calculateWorkbookBuildingsPremium(block, use, buildings, Boolean(input.accidentalDamageBuildings));
  const contentsPremium = calculateWorkbookContentsPremium(block, use, contents, Boolean(input.accidentalDamageContents));
  const jewelleryPremium = asNumber(input.allRiskJewellery) * jewelleryRate;
  const otherAllRisksPremium = asNumber(input.allRiskOther) * otherAllRisksRate;
  const solarFee = calculateWorkbookSolarPremium(block, asNumber(input.solarPanels));
  // ABY-300 / ADR-0042 — Home Emergency Assistance is bundled by default
  // for HOME quotes on CY and GR (mirrors the canonical endorsement
  // template `HOME-EUROP-ASSISTANCE`: `enabledByDefault: true`,
  // `jurisdiction: ['CY', 'GR']`). Pre-fix the BO and the public wizard
  // disagreed on whether the €12 was included — wizard quotes were €12
  // short of the BO-issued premium for the same risk on Cyprus.
  // Operator overrides (BO MBE detach) explicit `false` still apply.
  // Pricing intentionally is NOT carried in the rate card: this is a
  // partner pass-through, not underwritten premium. It is therefore
  // excluded from country/risk loadings, customer discounts, and the
  // underwriting-profit loading. Statutory tax is applied separately by
  // the canonical Home tax calculation (ADR-0042).
  const europAssistanceAvailable = rates.pricingRules.europAssistance.countryCodes.includes(tenant.countryCode);
  const europAssistanceSelected = input.europAssistance === undefined
    ? europAssistanceAvailable
    : Boolean(input.europAssistance) && europAssistanceAvailable;
  const europAssistanceFee = europAssistanceSelected ? rates.pricingRules.europAssistance.fee : 0;
  const basePremium = buildingsPremium + contentsPremium + jewelleryPremium + otherAllRisksPremium + solarFee;

  steps.push(
    { id: 'home.buildings', name: 'Buildings base premium', kind: 'rate_base',
      inputs: { sumInsured: buildings, rate: block.buildingsBase, overRate: block.buildingsOver, accidentalDamageRate: block.buildingsAd }, output: round2(buildingsPremium) },
    { id: 'home.contents', name: 'Contents base premium', kind: 'rate_base',
      inputs: { sumInsured: contents, rate: block.contentsBase, overRate: block.contentsOver, accidentalDamageRate: block.contentsAd }, output: round2(contentsPremium) },
  );
  if (jewelleryPremium > 0) steps.push({
    id: 'home.jewellery', name: 'All-risk jewellery', kind: 'rate_base',
    inputs: { sumInsured: asNumber(input.allRiskJewellery), rate: jewelleryRate }, output: round2(jewelleryPremium),
  });
  if (otherAllRisksPremium > 0) steps.push({
    id: 'home.otherAllRisks', name: 'All-risk other', kind: 'rate_base',
    inputs: { sumInsured: asNumber(input.allRiskOther), rate: otherAllRisksRate }, output: round2(otherAllRisksPremium),
  });
  if (solarFee > 0) steps.push({
    id: 'home.solar', name: 'Solar panel cover', kind: 'rate_base',
    inputs: { sumInsured: asNumber(input.solarPanels), rate: block.solar, minimumPremium: 25 },
    output: round2(solarFee),
  });
  if (europAssistanceFee > 0) steps.push({
    id: 'home.europAssistance', name: 'Europ Assistance Home Emergency Assistance', kind: 'fee',
    amount: europAssistanceFee,
  });
  steps.push({ id: 'home.basePremium', name: 'Base premium', kind: 'subtotal', output: round2(basePremium) });

  const loadingBreakdown: Record<string, number> = {};
  // ADR-0052 — flat per-country base loading. Greece shares the Cyprus
  // base rate card but carries a +20% country uplift: "the Greek premium
  // is 20% loading on top of the Cyprus premium" and the island +35%
  // sits "on top" of that (Abbeygate underwriting, Theo 2026-07-17). So
  // the country loading is applied to the base FIRST to form the Greek
  // premium, and every risk loading below COMPOUNDS on it (× country ×
  // risk), not additively. The rate is sourced from
  // `home-rates.countryBaseLoading` (0 for countries with no uplift).
  const countryBaseLoad = rates.countryBaseLoading[tenant.countryCode] ?? 0;
  const countryLoadedBase = basePremium * (1 + countryBaseLoad);
  if (countryBaseLoad > 0) {
    loadingBreakdown.countryBaseLoading = countryBaseLoad;
    steps.push({
      id: 'home.loading.countryBase',
      name: `${tenant.country} country loading`,
      kind: 'factor',
      factor: 1 + countryBaseLoad,
      inputs: { countryCode: tenant.countryCode, source: 'home-rates.countryBaseLoading' },
      notes: `+${Math.round(countryBaseLoad * 100)}%`,
    });
  }
  // Risk loadings compound on the country-loaded base (see above); they
  // are summed here and applied as a single multiplier to
  // `countryLoadedBase`.
  let loadings = 0;
  const combustible = isTrue(input.woodenConstruction);
  if (combustible) {
    loadingBreakdown.combustibleConstruction = rates.pricingRules.combustibleConstructionLoading; loadings += rates.pricingRules.combustibleConstructionLoading;
    steps.push({ id: 'home.loading.combustible', name: 'Combustible construction loading', kind: 'factor', factor: 1 + rates.pricingRules.combustibleConstructionLoading });
  }
  if (input.propertyType === 'Static Caravan') {
    loadingBreakdown.staticCaravan = rates.pricingRules.staticCaravanLoading; loadings += rates.pricingRules.staticCaravanLoading;
    steps.push({ id: 'home.loading.staticCaravan', name: 'Static caravan loading', kind: 'factor', factor: 1 + rates.pricingRules.staticCaravanLoading });
  }
  const claimsLoad = claimsLoading(input.previousClaims, rates.pricingRules);
  if (claimsLoad > 0) {
    loadingBreakdown.previousClaims = claimsLoad; loadings += claimsLoad;
    steps.push({ id: 'home.loading.previousClaims', name: 'Previous claims loading', kind: 'factor', factor: 1 + claimsLoad, inputs: { previousClaims: input.previousClaims } });
  }
  const pcLoad = greekPostcodeLoading(input.greekPostcode, rates.pricingRules);
  if (pcLoad > 0) {
    loadingBreakdown.greekPostcode = pcLoad; loadings += pcLoad;
    steps.push({ id: 'home.loading.greekPostcode', name: 'Greek postcode loading', kind: 'factor', factor: 1 + pcLoad, inputs: { postcode: input.greekPostcode } });
  }
  const wildfire = wildfireLoading(input, rates);
  if (wildfire.rate > 0) {
    loadingBreakdown.wildfire = wildfire.rate; loadings += wildfire.rate;
    steps.push({
      id: 'home.loading.wildfire',
      name: 'Locus wildfire risk loading',
      kind: 'factor',
      factor: 1 + wildfire.rate,
      inputs: {
        tier: wildfire.classification?.tier,
        matchedOn: wildfire.classification?.matchedOn,
        matchedLabel: wildfire.classification?.matchedLabel,
        source: 'home-rates.wildfireLoading',
      },
      notes: `+${Math.round(wildfire.rate * 100)}%`,
    });
  }

  const afterLoadings = countryLoadedBase * (1 + loadings);
  if (loadings > 0 || countryBaseLoad > 0) steps.push({ id: 'home.afterLoadings', name: 'Premium after loadings', kind: 'subtotal', output: round2(afterLoadings) });

  const discountBreakdown: Record<string, number> = {};
  const discountAmountBreakdown: Record<string, number> = {};
  const propertyAge = propertyAgeDiscount(input.yearBuilt, rates.pricingRules);
  let afterPropertyAge = afterLoadings;
  if (propertyAge > 0) {
    discountBreakdown.propertyAge = propertyAge;
    discountAmountBreakdown.propertyAge = afterLoadings * propertyAge;
    afterPropertyAge = afterLoadings - discountAmountBreakdown.propertyAge;
    steps.push({ id: 'home.discount.propertyAge', name: 'Property age discount', kind: 'discount', factor: 1 - propertyAge, inputs: { yearBuilt: input.yearBuilt } });
  }
  const alarmDiscount = isTrue(input.alarm) ? rates.pricingRules.alarmDiscount : 0;
  let afterAlarm = afterPropertyAge;
  if (alarmDiscount > 0) {
    discountBreakdown.alarm = alarmDiscount;
    discountAmountBreakdown.alarm = afterPropertyAge * alarmDiscount;
    afterAlarm = afterPropertyAge - discountAmountBreakdown.alarm;
    steps.push({ id: 'home.discount.alarm', name: 'Alarm discount', kind: 'discount', factor: 1 - alarmDiscount });
  }
  const over45 = isTrue(input.proposerOver45) ? rates.pricingRules.proposerOver45Discount : 0;
  const excess = increasedExcessDiscount(input.increasedExcess, rates.pricingRules);
  let afterExcess = afterAlarm;
  if (excess > 0) {
    discountBreakdown.increasedExcess = excess;
    discountAmountBreakdown.increasedExcess = afterPropertyAge * excess;
    afterExcess = afterAlarm - discountAmountBreakdown.increasedExcess;
    steps.push({ id: 'home.discount.increasedExcess', name: 'Increased excess discount', kind: 'discount', factor: 1 - excess, inputs: { excess: input.increasedExcess } });
  }
  let afterOver45 = afterExcess;
  if (over45 > 0) {
    discountBreakdown.proposerOver45 = over45;
    discountAmountBreakdown.proposerOver45 = afterAlarm * over45;
    afterOver45 = afterExcess - discountAmountBreakdown.proposerOver45;
    steps.push({ id: 'home.discount.proposerOver45', name: 'Proposer age 45+ discount', kind: 'discount', factor: 1 - over45 });
  }
  const ncb = ncbDiscount(input.noClaimsDiscount, rates.pricingRules);
  let afterNcb = afterOver45;
  if (ncb > 0) {
    discountBreakdown.noClaimsDiscount = ncb;
    discountAmountBreakdown.noClaimsDiscount = afterExcess * ncb;
    afterNcb = afterOver45 - discountAmountBreakdown.noClaimsDiscount;
    steps.push({ id: 'home.discount.ncb', name: 'No claims discount', kind: 'discount', factor: 1 - ncb, inputs: { ncb: input.noClaimsDiscount } });
  }
  const discretionary = Math.max(0, Math.min(rates.pricingRules.discretionaryDiscountCap, asNumber(input.discretionaryDiscount)));
  let afterDiscounts = afterNcb;
  if (discretionary > 0) {
    discountBreakdown.discretionary = discretionary;
    discountAmountBreakdown.discretionary = afterNcb * discretionary;
    afterDiscounts = afterNcb - discountAmountBreakdown.discretionary;
    steps.push({ id: 'home.discount.discretionary', name: 'Discretionary discount', kind: 'discount', factor: 1 - discretionary });
  }

  const discounts = propertyAge + alarmDiscount + over45 + ncb + excess + discretionary;
  if (discounts > 0) steps.push({ id: 'home.afterDiscounts', name: 'Premium after discounts', kind: 'subtotal', output: round2(afterDiscounts) });

  // ADR-0036 — Underwriting profit loading. Applied on `afterDiscounts`
  // (the underwritten net premium, after risk loadings and customer
  // discounts) and BEFORE the per-country tax engine + minimum-premium
  // floor. The rate is loaded from the same JSON that owns home rates
  // (no `.ts` literal — single-source remains intact); per Peter
  // 2026-05-29 it applies uniformly across every country the binder
  // covers, hence no per-tenant branch here.
  const uwProfitLoadingConfig = rates.underwritingProfitLoading;
  const uwProfitLoading = round2(afterDiscounts * uwProfitLoadingConfig.rate);
  const loadedNet = round2(afterDiscounts + uwProfitLoading);
  if (uwProfitLoading > 0) {
    steps.push({
      id: 'home.uwProfitLoading',
      name: 'Underwriting profit loading',
      kind: 'factor',
      amount: uwProfitLoading,
      factor: uwProfitLoadingConfig.rate,
      inputs: { appliesTo: uwProfitLoadingConfig.appliesTo, base: round2(afterDiscounts), source: 'home-rates.underwritingProfitLoading' },
    });
  }

  const taxes = applyHomeWorkbookTaxes(
    tenant.countryCode,
    use,
    loadedNet,
    buildings,
    contents,
    europAssistanceFee,
    rates.minPremium,
  );
  if (taxes.minimumApplied) {
    steps.push({ id: 'home.minimumPremium', name: 'Minimum premium applied', kind: 'subtotal', output: taxes.grossPremium, notes: `floor ${rates.minPremium}` });
  }
  if (taxes.iptAmount > 0) {
    steps.push({ id: 'home.tax.ipt', name: 'Insurance premium tax', kind: 'tax', amount: taxes.iptAmount });
  }
  if (taxes.adminFee > 0) {
    steps.push({ id: 'home.fee.admin', name: 'Admin fee', kind: 'fee', amount: taxes.adminFee });
  }
  steps.push({ id: 'home.grossPremium', name: 'Gross premium', kind: 'total', output: taxes.grossPremium });

  const breakdown: HomeBreakdown = {
    buildingsRate: block.buildingsBase,
    contentsRate: block.contentsBase,
    jewelleryRate,
    otherAllRisksRate,
    buildingsPremium: round2(buildingsPremium),
    contentsPremium: round2(contentsPremium),
    jewelleryPremium: round2(jewelleryPremium),
    otherAllRisksPremium: round2(otherAllRisksPremium),
    basePremium: round2(basePremium),
    loadings,
    loadingBreakdown,
    afterLoadings: round2(afterLoadings),
    discounts,
    discountBreakdown,
    afterDiscounts: round2(afterDiscounts),
    wildfireRisk: wildfire.classification ?? undefined,
    uwProfitLoading,
    europAssistanceFee: taxes.europAssistanceFee,
    netPremium: taxes.netPremium,
    iptAmount: taxes.iptAmount,
    adminFee: taxes.adminFee,
    grossPremium: taxes.grossPremium,
  };

  return {
    premium: {
      premium: taxes.grossPremium,
      basis: 'HYBRID',
      calculationDetails: {
        fixedAmount: taxes.grossPremium,
        proRataFactor: 1,
        steps,
        calculatorVersion: HOME_CALCULATOR_VERSION,
      },
    },
    breakdown,
    declined: false,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function calculateWorkbookBuildingsPremium(block: WorkbookRateBlock, use: PropertyUse, sumInsured: number, accidentalDamage: boolean): number {
  if (accidentalDamage) return block.buildingsAd == null ? 0 : sumInsured * block.buildingsAd;
  if (use === 'Holiday') return sumInsured * block.buildingsBase;
  if (sumInsured < 100_001) return sumInsured * block.buildingsBase;
  if (sumInsured > 400_000) return (sumInsured * 0.35 * block.buildingsBase) + (sumInsured * 0.65 * block.buildingsOver);
  return (100_000 * block.buildingsBase) + ((sumInsured - 100_000) * block.buildingsOver);
}

function calculateWorkbookContentsPremium(block: WorkbookRateBlock, use: PropertyUse, sumInsured: number, accidentalDamage: boolean): number {
  const basePremium = use === 'Holiday'
    ? calculateHolidayContentsBase(block, sumInsured)
    : calculatePermanentContentsBase(block, sumInsured);
  if (!accidentalDamage) return basePremium;
  const adPremium = block.contentsAd == null ? 0 : sumInsured * block.contentsAd;
  return use === 'Holiday' ? adPremium : Math.max(basePremium, adPremium);
}

function calculatePermanentContentsBase(block: WorkbookRateBlock, sumInsured: number): number {
  if (sumInsured < 28_001) return sumInsured * block.contentsBase;
  if (sumInsured > 70_000) return (sumInsured * 0.35 * block.contentsBase) + (sumInsured * 0.65 * block.contentsOver);
  return (20_000 * block.contentsBase) + ((sumInsured - 20_000) * block.contentsOver);
}

function calculateHolidayContentsBase(block: WorkbookRateBlock, sumInsured: number): number {
  if (sumInsured < 20_001) return sumInsured * block.contentsBase;
  return (20_000 * block.contentsBase) + ((sumInsured - 20_000) * block.contentsOver);
}

function calculateWorkbookSolarPremium(block: WorkbookRateBlock, sumInsured: number): number {
  if (sumInsured <= 0) return 0;
  return Math.max(25, sumInsured * block.solar);
}

function applyHomeWorkbookTaxes(
  countryCode: string,
  use: PropertyUse,
  netBeforeMinimum: number,
  buildings: number,
  contents: number,
  partnerPassThroughFee: number,
  minPremium: number,
) {
  const country = String(countryCode).toUpperCase();
  let iptAmount = 0;
  if (country === 'ES') {
    const ccsRate = use === 'Holiday' ? 0.00008 : 0.00007;
    iptAmount = (netBeforeMinimum * 0.0815) + ((buildings + contents) * ccsRate);
  } else if (country === 'PT') {
    iptAmount = netBeforeMinimum * 0.129;
  } else if (country === 'CY') {
    // Legacy Abbeygate Home schedule (NH82515223207-04-2026.pdf) prints
    // `Local Taxes (Payable by the insured/Payable by the Insurer) Eur0.00`.
    // Cyprus Lloyd's coverholder Home policies under binder B176025EEA6551
    // have no policy-level IPT on the customer bill.
    iptAmount = 0;
  } else if (country === 'GR') {
    iptAmount = netBeforeMinimum * 0.15;
  } else {
    const tenantTaxes = applyTenantTaxes(getTenantConfig(), Math.max(netBeforeMinimum, minPremium));
    return { ...tenantTaxes, europAssistanceFee: 0, minimumApplied: false };
  }

  // ADR-0042: Europ Assistance is not underwritten premium, so it is not
  // included in the amount to which the minimum-premium rule applies.
  // Greece nevertheless levies 15% IPT on it; Cyprus levies no policy IPT.
  const partnerPassThroughIpt = country === 'GR' ? partnerPassThroughFee * 0.15 : 0;
  const adminFee = 18;
  const taxedPremium = netBeforeMinimum + iptAmount;
  const minimumApplied = taxedPremium < 113;
  const underwrittenGrossPremium = minimumApplied ? 131 : taxedPremium + adminFee;
  const underwrittenNetPremium = round2(
    minimumApplied ? underwrittenGrossPremium - round2(iptAmount) - adminFee : netBeforeMinimum,
  );
  const underwrittenIptAmount = round2(iptAmount);
  const roundedPartnerPassThroughIpt = round2(partnerPassThroughIpt);
  const roundedUnderwrittenGrossPremium = round2(underwrittenGrossPremium);
  return {
    // Preserve ADR-0036's semantic: netPremium is the loaded
    // underwritten amount. The partner fee is a separate payable line.
    netPremium: underwrittenNetPremium,
    europAssistanceFee: partnerPassThroughFee,
    iptAmount: round2(underwrittenIptAmount + roundedPartnerPassThroughIpt),
    adminFee,
    grossPremium: round2(roundedUnderwrittenGrossPremium + partnerPassThroughFee + roundedPartnerPassThroughIpt),
    minimumApplied,
  };
}

function zeroBreakdown(): HomeBreakdown {
  return {
    buildingsRate: 0, contentsRate: 0, jewelleryRate: 0, otherAllRisksRate: 0,
    buildingsPremium: 0, contentsPremium: 0, jewelleryPremium: 0, otherAllRisksPremium: 0,
    basePremium: 0, loadings: 0, loadingBreakdown: {}, afterLoadings: 0,
    discounts: 0, discountBreakdown: {}, afterDiscounts: 0,
    wildfireRisk: undefined,
    uwProfitLoading: 0,
    europAssistanceFee: 0,
    netPremium: 0, iptAmount: 0, adminFee: 0, grossPremium: 0,
  };
}

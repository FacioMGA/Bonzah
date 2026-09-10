/**
 * Home UW automation.
 *
 * Rules derived from the Helvetia rating guide + policy wording:
 *   - DECLINE: Greek postcodes 10/11 (Athens) = "No Quote Risk"
 *   - DECLINE: property type not in supported list
 *   - REFER: combustible wooden construction (subject to referral & acceptance)
 *   - REFER: previous claims count 3+ (auto refer to AF or PS)
 *   - REFER: pre-2000 property with subsidence/earthquake cover (architect signed reformation required)
 *   - REFER: property used for any business, trade or professional purpose
 *   - REFER: holiday home where proposer is domiciled outside the tenant country
 *     AND outside the UK/EU (non-resident EU/UK domiciles may bind online)
 *   - REFER: proposer nationality matches the Abbeygate operating market
 *     (CY / PT / GR / ES / IT) — local-market broker appetite; must be
 *     reviewed by UW before any online quote is released
 *   - REFER: property plot size of 5,000 m2 or more
 *   - REFER: Holiday Home + high risk items / All Risks Unspecified coverage requested (not offered)
 *   - REFER: Holiday Home + accidental damage cover requested (not offered)
 *   - REFER: specified high risk item value exceeds 20% of the contents sum insured
 *   - REFER: specified high risk items present without a safe confirmed (Section C / AB106)
 */

import { isUkOrEuDomicileCountry, matchLocalMarketNationalityReferral } from '@facio/products';
import { classifyWildfireRisk, type WildfireRiskClassification } from './wildfireRisk.js';

export interface HomeUwConfig {
  allowedPropertyTypes: string[];
  allowedRiskCountries: string[];
  maxBuildingsSumInsured?: number;
  maxContentsSumInsured?: number;
  maxAllRisksUnspecifiedSumInsured?: number;
  maxSolarPanelsSumInsured?: number;
  declineClaimsCountOver: number;
  referClaimsCountAtLeast: number;
  combustibleConstructionRefer: boolean;
  greekPostcodeDecline: string[];
}

export const DEFAULT_HOME_UW_CONFIG: HomeUwConfig = {
  allowedPropertyTypes: ['Villa', 'Townhouse', 'Apartment', 'Static Caravan'],
  allowedRiskCountries: ['Cyprus', 'Portugal', 'Spain', 'Greece'],
  maxBuildingsSumInsured: 1_500_000,
  maxContentsSumInsured: 100_000,
  maxAllRisksUnspecifiedSumInsured: 5_000,
  maxSolarPanelsSumInsured: 20_000,
  declineClaimsCountOver: 3,
  referClaimsCountAtLeast: 2,
  combustibleConstructionRefer: true,
  greekPostcodeDecline: ['10', '11'],
};

export type UwLane = 'accept' | 'referral' | 'decline';
export type HomeUwTriggerLane = 'yellow' | 'red';

export type HomeUwTrigger = {
  lane: HomeUwTriggerLane;
  code: string;
  message: string;
  fields: string[];
  explanation: string;
};

export interface UwDecision {
  lane: UwLane;
  outcome: UwLane;
  reasons: Array<{ code: string; message: string }>;
  triggers: HomeUwTrigger[];
}

interface HomeUwInput {
  propertyType?: string;
  propertyCountry?: string;
  propertyTown?: string;
  propertyProvince?: string;
  propertyPostcode?: string;
  landAreaSqm?: number;
  wildfireOfficialHazardClass?: string;
  buildingsSumInsured?: number;
  contentsSumInsured?: number;
  woodenConstruction?: boolean;
  previousClaims?: 'None' | '1 claim < 1000' | '2 claims < 3000' | '3 claims or > 3000';
  yearBuilt?: 'Prior to 1980' | '1980 to 1989' | '1990 or Later';
  proposerNationality?: string;
  proposerDomicileCountry?: string;
  tenantCountry?: string;
  usage?: { permanentHome?: boolean; rentedOut?: boolean; businessUse?: boolean };
  coverage?: { allRiskJewellery?: number; allRiskOther?: number; solarPanels?: number; accidentalDamageBuildings?: boolean; accidentalDamageContents?: boolean };
  specifiedItems?: Array<{ sumInsured?: number }>;
  safeOnPremises?: boolean;
  doorsFiveLeverLocks?: boolean;
  windowsSecured?: boolean;
  urbanArea?: boolean;
  within20MinFireStation?: boolean;
  greekPostcode?: string;
  wildfireRisk?: WildfireRiskClassification;
}

// Lloyd's coverholder Home wording caps each high-value contents item at 20%
// of the contents sum insured; anything above that goes to a manual review.
const HIGH_RISK_PCT_OF_CONTENTS = 0.2;
const LARGE_PLOT_REFERRAL_SQM = 5_000;

const HOME_TRIGGER_EXPLANATIONS: Record<string, string> = {
  PROPERTY_TYPE_NOT_SUPPORTED: 'The selected property type is outside the Home product appetite.',
  COUNTRY_NOT_SUPPORTED: 'The risk country is outside the Home product territorial appetite.',
  GREEK_POSTCODE_NO_QUOTE: 'This Greek postcode is excluded from automatic Home quoting.',
  WILDFIRE_RED_REFERRAL: 'The property location is in a red wildfire-risk territory and needs underwriting review.',
  COMBUSTIBLE_CONSTRUCTION: 'Combustible construction requires manual review before Home cover can proceed.',
  PRE_2000_EARTHQUAKE_SUBSIDENCE: 'Older properties need review for earthquake, subsidence, or landslip exposure.',
  HOLIDAY_HOME_NON_RESIDENT_DOMICILE: 'A holiday home with a proposer domiciled outside the UK/EU needs underwriter review.',
  HOLIDAY_ALL_RISKS_NOT_OFFERED: 'All risks or high-risk item cover is not available automatically for holiday homes.',
  HOLIDAY_ACCIDENTAL_DAMAGE_NOT_OFFERED: 'Accidental damage cover is not available automatically for holiday homes.',
  TWO_CLAIMS: 'Two prior Home claims require underwriter review before automatic acceptance.',
  CLAIMS_THRESHOLD: 'The Home claims history exceeds the automatic acceptance threshold.',
  BUILDINGS_SUM_INSURED_EXCEEDED: 'The buildings sum insured exceeds the Home automatic authority threshold.',
  CONTENTS_SUM_INSURED_EXCEEDED: 'The contents sum insured exceeds the Home automatic authority threshold.',
  ALL_RISKS_SUM_INSURED_EXCEEDED: 'The unspecified All Risks sum insured exceeds the Home automatic authority threshold.',
  SOLAR_PANELS_SUM_INSURED_EXCEEDED: 'The solar panels sum insured exceeds the Home automatic authority threshold.',
  JEWELLERY_HIGH_VALUE_ITEMS_REFERRAL: 'Jewellery and specified high-value items require underwriter review.',
  LARGE_PLOT_SIZE_REFERRAL: 'Large plots need underwriting review before Home cover can proceed online.',
  REMOTE_NON_URBAN_NO_FIRE_STATION: 'A remote non-urban property without nearby fire-station access requires review.',
  BUSINESS_USE_OF_PROPERTY: 'Business, trade, or professional use changes the occupancy risk and requires review.',
  INSUFFICIENT_DOOR_WINDOW_SECURITY: 'Door or window security does not meet automatic Home acceptance criteria.',
  HIGH_VALUE_ITEMS_OVER_20PCT: 'Declared high-value items exceed the Home Section C automatic limit.',
  SPECIFIED_HIGH_RISK_NO_SAFE: 'Specified high-risk items require safe storage confirmation before automatic acceptance.',
  LOCAL_MARKET_NATIONALITY_REFERRAL: 'Nationals of Abbeygate operating territories (CY/PT/GR/ES/IT) are outside the online Home appetite and need underwriter review before a quote is released.',
};

function normalizedCountry(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function specifiedHighRiskAmounts(input: HomeUwInput): number[] {
  const jewellery = Number(input.coverage?.allRiskJewellery || 0);
  const items = Array.isArray(input.specifiedItems) ? input.specifiedItems : [];
  const itemAmounts = items
    .map((item) => Number(item?.sumInsured || 0))
    .filter((amount) => amount > 0);
  return [jewellery, ...itemAmounts].filter((amount) => amount > 0);
}

export function evaluateHomeUw(input: HomeUwInput, config: HomeUwConfig = DEFAULT_HOME_UW_CONFIG): UwDecision {
  const reasons: UwDecision['reasons'] = [];
  const triggers: HomeUwTrigger[] = [];
  const push = (lane: HomeUwTriggerLane, code: string, message: string, fields: string[]) => {
    reasons.push({ code, message });
    triggers.push({ lane, code, message, fields, explanation: HOME_TRIGGER_EXPLANATIONS[code] || message });
  };
  const decision = (lane: UwLane): UwDecision => ({ lane, outcome: lane, reasons, triggers });

  // DECLINES
  if (input.propertyType && !config.allowedPropertyTypes.includes(input.propertyType)) {
    push('red', 'PROPERTY_TYPE_NOT_SUPPORTED', `Property type ${input.propertyType} is not supported`, ['property.propertyType']);
    return decision('decline');
  }
  if (input.propertyCountry && !config.allowedRiskCountries.includes(input.propertyCountry)) {
    push('red', 'COUNTRY_NOT_SUPPORTED', `Risk country ${input.propertyCountry} is not within appetite`, ['property.address.country']);
    return decision('decline');
  }
  if (input.greekPostcode && config.greekPostcodeDecline.includes(input.greekPostcode)) {
    push('red', 'GREEK_POSTCODE_NO_QUOTE', `Greek postcode ${input.greekPostcode} is excluded (Athens)`, ['property.address.postcode']);
    return decision('decline');
  }
  if (input.previousClaims === '3 claims or > 3000') {
    push('yellow', 'CLAIMS_THRESHOLD', 'More than 3 claims or claims total > €3,000 requires manual review', ['risk.previousClaims']);
  }
  if (config.maxBuildingsSumInsured && Number(input.buildingsSumInsured) > config.maxBuildingsSumInsured) {
    push('yellow', 'BUILDINGS_SUM_INSURED_EXCEEDED', `Buildings sum insured exceeds €${config.maxBuildingsSumInsured.toLocaleString()}`, ['coverage.buildings']);
  }
  if (config.maxContentsSumInsured && Number(input.contentsSumInsured) > config.maxContentsSumInsured) {
    push('yellow', 'CONTENTS_SUM_INSURED_EXCEEDED', `Contents sum insured exceeds €${config.maxContentsSumInsured.toLocaleString()}`, ['coverage.contents']);
  }
  if (
    config.maxAllRisksUnspecifiedSumInsured
    && Number(input.coverage?.allRiskOther) > config.maxAllRisksUnspecifiedSumInsured
  ) {
    push(
      'yellow',
      'ALL_RISKS_SUM_INSURED_EXCEEDED',
      `All Risks Unspecified sum insured exceeds €${config.maxAllRisksUnspecifiedSumInsured.toLocaleString()}`,
      ['coverage.allRiskOther'],
    );
  }
  if (
    config.maxSolarPanelsSumInsured
    && Number(input.coverage?.solarPanels) > config.maxSolarPanelsSumInsured
  ) {
    push(
      'yellow',
      'SOLAR_PANELS_SUM_INSURED_EXCEEDED',
      `Solar panels sum insured exceeds €${config.maxSolarPanelsSumInsured.toLocaleString()}`,
      ['coverage.solarPanelCover'],
    );
  }

  // REFERRALS
  const wildfireRisk = input.propertyCountry
    ? input.wildfireRisk ?? classifyWildfireRisk({
      country: input.propertyCountry,
      town: input.propertyTown,
      province: input.propertyProvince,
      postcode: input.propertyPostcode,
      officialHazardClass: input.wildfireOfficialHazardClass,
    })
    : null;
  if (wildfireRisk?.tier === 'red') {
    push(
      'yellow',
      'WILDFIRE_RED_REFERRAL',
      'Red wildfire territory requires referral before quote until exact location and surrounding vegetation are reviewed',
      ['property.address.country', 'property.address.city', 'property.address.postcode'],
    );
  }

  if (input.woodenConstruction && config.combustibleConstructionRefer) {
    push('yellow', 'COMBUSTIBLE_CONSTRUCTION', 'Combustible (wooden) construction subject to referral and acceptance', ['property.woodenConstruction']);
  }
  if (typeof input.landAreaSqm === 'number' && input.landAreaSqm >= LARGE_PLOT_REFERRAL_SQM) {
    push(
      'yellow',
      'LARGE_PLOT_SIZE_REFERRAL',
      `Property plot size ${input.landAreaSqm.toLocaleString()}m2 is at or above the 5,000m2 automatic referral threshold`,
      ['property.landAreaSqm'],
    );
  }
  if (input.yearBuilt === 'Prior to 1980') {
    push('yellow', 'PRE_2000_EARTHQUAKE_SUBSIDENCE', 'Pre-1980 property: earthquake/subsidence/landslip requires architect-signed reformation report', ['property.yearBuilt']);
  }
  // Abbeygate is an expat broker: same-market nationals must be referred
  // before any Home quote is released. Cross-territory operating nationals
  // are expats and can proceed. Canonical matcher: @facio/products.
  const localNational = matchLocalMarketNationalityReferral(
    input.proposerNationality,
    input.propertyCountry || input.tenantCountry,
  );
  if (localNational) {
    push(
      'yellow',
      'LOCAL_MARKET_NATIONALITY_REFERRAL',
      `Proposer of ${localNational.demonym} nationality requires underwriter review before a quote can be released`,
      ['proposer.nationality'],
    );
  }
  const isHoliday = input.usage?.permanentHome === false;
  const domicileDiffersFromTenant =
    normalizedCountry(input.proposerDomicileCountry) &&
    normalizedCountry(input.tenantCountry) &&
    normalizedCountry(input.proposerDomicileCountry) !== normalizedCountry(input.tenantCountry);
  if (
    isHoliday &&
    domicileDiffersFromTenant &&
    !isUkOrEuDomicileCountry(input.proposerDomicileCountry)
  ) {
    push(
      'yellow',
      'HOLIDAY_HOME_NON_RESIDENT_DOMICILE',
      `Holiday home where proposer domicile (${input.proposerDomicileCountry}) is outside the UK/EU requires underwriter review`,
      ['usage.permanentHome', 'proposer.domicileCountry'],
    );
  }
  if (isHoliday && ((Number(input.coverage?.allRiskJewellery) || 0) > 0 || (Number(input.coverage?.allRiskOther) || 0) > 0)) {
    push(
      'yellow',
      'HOLIDAY_ALL_RISKS_NOT_OFFERED',
      'High Risk Items / All Risks Unspecified cover is not available on Holiday Home policies',
      ['usage.permanentHome', 'coverage.allRiskJewellery', 'coverage.allRiskOther'],
    );
  }
  if (
    isHoliday
    && (input.coverage?.accidentalDamageBuildings === true || input.coverage?.accidentalDamageContents === true)
  ) {
    push(
      'yellow',
      'HOLIDAY_ACCIDENTAL_DAMAGE_NOT_OFFERED',
      'Accidental damage cover is not available on Holiday Home policies',
      ['usage.permanentHome', 'coverage.accidentalDamageBuildings', 'coverage.accidentalDamageContents'],
    );
  }
  if (input.previousClaims === '2 claims < 3000') {
    push('yellow', 'TWO_CLAIMS', 'Two prior claims — review recommended', ['risk.previousClaims']);
  }

  // Fire-station proximity — a property that is NOT in an urban area and is
  // NOT within 20 minutes of a fire station has a materially slower emergency
  // response and must be referred for underwriter review. Urban properties
  // are accepted without the proximity question. Applies on all territories.
  if (input.urbanArea === false && input.within20MinFireStation === false) {
    push(
      'yellow',
      'REMOTE_NON_URBAN_NO_FIRE_STATION',
      'Non-urban property more than 20 minutes from a fire station requires referral',
      ['property.urbanArea', 'property.within20MinFireStation'],
    );
  }

  // Business use — a property used for any business, trade or professional
  // purpose carries additional liability/occupancy risk that is outside the
  // online appetite. Refer so an underwriter can obtain the exact use and
  // liability exposure before quoting. Applies on all territories.
  if (input.usage?.businessUse === true) {
    push(
      'yellow',
      'BUSINESS_USE_OF_PROPERTY',
      'Property used for business, trade or professional purpose requires underwriter review',
      ['usage.businessUse'],
    );
  }

  // Physical security — a property without key operated locks on external doors,
  // or without interior locks on easily accessible windows and patio doors, is
  // not an automatic online accept and must be referred for underwriter review.
  if (input.doorsFiveLeverLocks === false || input.windowsSecured === false) {
    push(
      'yellow',
      'INSUFFICIENT_DOOR_WINDOW_SECURITY',
      'Property without key operated door locks and/or interior window locks requires referral',
      ['security.doorsFiveLeverLocks', 'security.windowsSecured'],
    );
  }

  // Section C — specified high risk items.
  const highRiskAmounts = specifiedHighRiskAmounts(input);
  const hasSpecifiedHighRisk = highRiskAmounts.length > 0;
  if (hasSpecifiedHighRisk) {
    push(
      'yellow',
      'JEWELLERY_HIGH_VALUE_ITEMS_REFERRAL',
      'Jewellery and specified high-value items require underwriter review',
      ['coverage.allRiskJewellery', 'coverage.specifiedItems'],
    );
    const contents = Number(input.contentsSumInsured || 0);
    const perItemCap = contents * HIGH_RISK_PCT_OF_CONTENTS;
    const totalHighRisk = highRiskAmounts.reduce((sum, amount) => sum + amount, 0);
    // Refer when any single high value item, or the aggregate of all
    // specified high risk items, exceeds 20% of the contents sum insured
    // (or when no contents sum is set against which to apply the cap).
    const exceedsCap = contents <= 0 || totalHighRisk > perItemCap || highRiskAmounts.some((amount) => amount > perItemCap);
    if (exceedsCap) {
      push(
        'yellow',
        'HIGH_VALUE_ITEMS_OVER_20PCT',
        contents > 0
          ? `High value items exceed 20% of the contents sum insured (max €${Math.round(perItemCap).toLocaleString()})`
          : 'High value items declared without a contents sum insured to apply the 20% limit',
        ['coverage.allRiskJewellery', 'coverage.allRiskOther', 'coverage.contents'],
      );
    }
    if (input.safeOnPremises !== true) {
      push(
        'yellow',
        'SPECIFIED_HIGH_RISK_NO_SAFE',
        'Specified high risk items require a safe at the premises (AB106)',
        ['security.safeOnPremises'],
      );
    }
  }

  if (reasons.length === 0) return decision('accept');
  return decision('referral');
}

import { resolveHomeSolarPanelCoverAmount } from '@facio/products';
import type { HomeQuoteData } from './pricing/homeCalculator.js';

type UnknownRecord = Record<string, unknown>;

function asRecord(v: unknown): UnknownRecord {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as UnknownRecord) : {};
}

/**
 * ABY-334 — the "proposer aged 45+" pricing factor is DERIVED from the
 * proposer's date of birth, never asked as a separate question. This is
 * the canonical owner of the over-45 determination for home; the wizard
 * mirrors it (so the required validation field is populated) but the
 * system computes it itself. Boundary is age ≥ 45, matching the
 * `home.discount.proposerOver45` pricing step ("Proposer age 45+").
 */
export function isProposerAged45OrOver(dateOfBirth: unknown): boolean {
  const dob = String(dateOfBirth || '').trim();
  if (!dob) return false;
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return false;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age -= 1;
  return age >= 45;
}

/**
 * Product-owned projection from canonical backend quote data to the Home
 * pricing/UW input shape. Runtime code should consume this rather than
 * reinterpreting `unknown` inline.
 */
export function toHomePricingQuoteData(data: unknown, operatingCountryCode: string): HomeQuoteData {
  const qd = asRecord(data);
  const property = asRecord(qd.property);
  const propertyAddress = asRecord(property.address);
  const propertyWildfire = asRecord(property.wildfire);
  const proposer = asRecord(qd.proposer);
  const coverage = asRecord(qd.coverage);
  const risk = asRecord(qd.risk);
  const usage = asRecord(qd.usage);
  const isHolidayHome = usage.permanentHome === false;
  return enforceHomeCoverEligibility({
    propertyUse: isHolidayHome ? 'Holiday' : 'Permanent',
    propertyType: String(property.propertyType || ''),
    propertyTown: String(propertyAddress.city || ''),
    propertyProvince: String(propertyAddress.province || propertyAddress.state || ''),
    propertyPostcode: String(propertyAddress.postcode || propertyAddress.zip || ''),
    propertyCountry: String(propertyAddress.country || ''),
    wildfireOfficialHazardClass: String(propertyWildfire.icnfStructuralHazardClass || ''),
    buildingsSumInsured: Number(coverage.buildings || 0),
    contentsSumInsured: Number(coverage.contents || 0),
    // ABY-449 / ABY-454 / ABY-455 — accidental damage and all-risks cover
    // are not offered on holiday homes. Strip stale/browser/API selections
    // at the canonical pricing projection so forbidden cover cannot replace
    // or inflate the holiday base premium.
    accidentalDamageBuildings: isHolidayHome ? false : Boolean(coverage.accidentalDamageBuildings),
    accidentalDamageContents: isHolidayHome ? false : Boolean(coverage.accidentalDamageContents),
    allRiskJewellery: isHolidayHome ? 0 : Number(coverage.allRiskJewellery || 0),
    allRiskOther: isHolidayHome ? 0 : Number(coverage.allRiskOther || 0),
    solarPanels: resolveHomeSolarPanelCoverAmount(operatingCountryCode, coverage.solarPanelCover),
    woodenConstruction: Boolean(property.woodenConstruction),
    nonCombustibleMaterial: Boolean(property.nonCombustibleMaterial),
    alarm: property.alarm as boolean | 'Yes' | 'No' | undefined,
    yearBuilt: property.yearBuilt as HomeQuoteData['yearBuilt'],
    previousClaims: risk.previousClaims as HomeQuoteData['previousClaims'],
    noClaimsDiscount: risk.noClaimsDiscount as HomeQuoteData['noClaimsDiscount'],
    increasedExcess: risk.increasedExcess as HomeQuoteData['increasedExcess'],
    // ABY-334 — computed from DOB, not from the submitted answer.
    proposerOver45: isProposerAged45OrOver(proposer.dateOfBirth),
    proposerDomicileCountry: String(proposer.domicileCountry || ''),
    discretionaryDiscount: Number(risk.discretionaryDiscount || 0),
  });
}

/** Applies Home coverage minima after BO/MBE endorsement selections. */
export function enforceHomeCoverageDefaults(data: HomeQuoteData, operatingCountryCode: string): HomeQuoteData {
  return {
    ...data,
    solarPanels: resolveHomeSolarPanelCoverAmount(operatingCountryCode, data.solarPanels),
  };
}

/**
 * Rating must never consume cover that the product does not offer for the
 * selected risk. Keep this separate from the raw request used by UW so an
 * attempted forbidden selection is still visible as a referral signal.
 */
export function enforceHomeCoverEligibility(data: HomeQuoteData): HomeQuoteData {
  if (data.propertyUse !== 'Holiday') return data;
  return {
    ...data,
    accidentalDamageBuildings: false,
    accidentalDamageContents: false,
    allRiskJewellery: 0,
    allRiskOther: 0,
  };
}

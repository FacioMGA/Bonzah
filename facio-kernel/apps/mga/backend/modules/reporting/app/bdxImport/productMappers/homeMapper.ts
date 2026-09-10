import type { BdxRawRow, BdxRowDto } from '../types.js';
import type { JurisdictionProductConfig } from '../../../../jurisdiction/domain/productConfiguration.js';
import {
  asDateString,
  asNumber,
  asRecord,
  asString,
  buildCommonDto,
  canonicalEntry,
  importProposerEmail,
  pick,
  yn,
  type LloydsV52MappingSpec,
  type UnknownRecord,
} from './shared.js';

export const homeLloydsV52MappingSpec: LloydsV52MappingSpec = {
  productLine: 'home',
  productType: 'HOME',
  policyFields: {
    policyRef: ['Certificate Ref', 'Policy or Group Ref', "Broker's Ref Number"],
    entry: ['Risk, Transaction Type', 'Transaction Type - Original Premium etc.', 'Entry Reason'],
  },
  insuredFields: {
    firstName: ['Insured First Name', 'Policy Holder First Name'],
    lastName: ['Insured Full Name, Last Name or Company Name', 'Policy Holder Surname / Compnay Name'],
    country: ['Insured Country (see code list)', 'Policy Holder Country', 'Risk Country'],
    address: ['Insured Address', 'Policy Holder Property Name / No and Street'],
    city: ['Policy Holder Town / City', 'Risk Town / City'],
    postcode: ['Insured Postcode, Zip Code or Similar', 'Policy Holder Post Code 1', 'Risk Postcode 1'],
  },
  coverFields: {
    buildings: ['Buildings Sum Insured'],
    contents: ['Contents Sum Insured'],
    allRisk: ['All Risk Sum Insured'],
    solar: ['Solar Sum Insured'],
    accidentalDamage: ['Accidental Damage'],
  },
  premiumFields: {
    gross: ['Risk Gross Total Premium (ex Ipt)', 'Total gross written premium'],
    commission: ['Total Commission', 'Coverholder commission amount for whole risk/written premium'],
    tax: ['IPT', 'Total taxes payable locally'],
    net: ['Risk Net Total Premium (ex Ipt)', 'Net written Premium to London in original currency'],
    total: ['Total Gross Premium including IPT'],
    fees: ['Broker Fee', 'Other Fees or Deductions written Amount'],
  },
  dateFields: {
    inception: ['Risk Start Date', 'Risk Inception Date', 'Policy Start Date', 'Risk Inception Date Risk Start Date'],
    expiry: ['Risk End Date & Transaction End Date', 'Risk Expiry Date', 'Policy Renewal Date', 'Risk Expiry Date Risk End Date & Transaction End Date'],
    booked: ['Date Issue of Schedule', 'Effective Date of Transaction', 'Policy issuance date'],
  },
  riskFields: {
    propertyType: ['Property Type'],
    yearBuilt: ['Building Year Built'],
    bedrooms: ['No Of Beds'],
    flatRoof: ['Flat Roof'],
    unoccupied: ['Unoccupied (Y/N)'],
    listedBuilding: ['Listed Building'],
  },
};

function moneyFromExactColumn(r: UnknownRecord, key: string): number | null {
  return asNumber(r[key]);
}

function firstPositiveMoney(r: UnknownRecord, keys: string[]): number {
  for (const key of keys) {
    const value = moneyFromExactColumn(r, key);
    if (value !== null && value > 0) return value;
  }
  return 0;
}

function boundedPositiveInt(value: unknown, min: number, max: number): number | null {
  const parsed = asNumber(value);
  if (parsed === null) return null;
  const rounded = Math.floor(parsed);
  return rounded >= min && rounded <= max ? rounded : null;
}

function normalizeYearBuilt(value: unknown): string {
  const raw = asString(value);
  if (/prior|pre|before|197|196|195|194|193|192|191|190/i.test(raw)) return 'Prior to 1980';
  if (/1980|1981|1982|1983|1984|1985|1986|1987|1988|1989/i.test(raw)) return '1980 to 1989';
  if (/1990|later|after|200|201|202/i.test(raw)) return '1990 or Later';
  return '1990 or Later';
}

function normalizePropertyType(value: unknown): string {
  const raw = asString(value);
  const normalized = raw.toLowerCase().replace(/\s+/g, '');
  if (!normalized) return 'Villa';
  if (normalized.includes('apartment') || normalized === 'flat') return 'Apartment';
  if (normalized.includes('townhouse') || normalized === 'semi' || normalized.includes('semi-detached')) return 'Townhouse';
  if (normalized.includes('bungalow')) return 'Bungalow';
  if (normalized.includes('villa')) return 'Villa';
  return raw;
}

function isUsableCity(value: string): boolean {
  if (value.length < 2) return false;
  if (/^[.\-_/]+$/.test(value)) return false;
  if (/^\d{4}-?\d{3}$/i.test(value)) return false;
  return value.toLowerCase() !== 'portugal';
}

function resolveHomeCity(r: Record<string, unknown>, defaults?: JurisdictionProductConfig['bdxConfig']['importDefaults']): string {
  const candidates = [
    pick(r, homeLloydsV52MappingSpec.insuredFields.city),
    r['Location of Risk - Country Sub-division: State, Province, Territory, Canton etc.'],
    r['Insured Country Sub-division: State, Province, Territory, Canton etc.'],
    defaults?.defaultCity,
  ];
  for (const candidate of candidates) {
    const value = asString(candidate);
    if (isUsableCity(value)) return value;
  }
  return defaults?.defaultCity || '';
}

export function mapHomeRawRowToDto(row: BdxRawRow, sourceRowNumber: number, jurisdictionConfig?: JurisdictionProductConfig): BdxRowDto {
  const r = asRecord(row);
  const defaults = jurisdictionConfig?.bdxConfig.importDefaults;
  const policyRef = asString(pick(r, homeLloydsV52MappingSpec.policyFields.policyRef)) || `home-${sourceRowNumber}`;
  const firstName = asString(pick(r, homeLloydsV52MappingSpec.insuredFields.firstName));
  const lastName = asString(pick(r, homeLloydsV52MappingSpec.insuredFields.lastName));
  const country = asString(pick(r, homeLloydsV52MappingSpec.insuredFields.country)) || defaults?.defaultCountry || '';
  const line1 = asString(pick(r, homeLloydsV52MappingSpec.insuredFields.address));
  const city = resolveHomeCity(r, defaults);
  const postcode = asString(pick(r, homeLloydsV52MappingSpec.insuredFields.postcode));
  const inceptionDate = asDateString(pick(r, homeLloydsV52MappingSpec.dateFields.inception));
  const expiryDate = asDateString(pick(r, homeLloydsV52MappingSpec.dateFields.expiry));
  // Beazley Lloyds home BDX extracts (evidence: BeazleyLloydsBDX.xlsx,
  // rows 2-5775, cols 167-193) carry a one-column-shifted home schedule
  // block: property type appears under "Interested Party Name"; the
  // buildings/contents/solar sum-insured values appear under the adjacent
  // "... Gross Premium" headers. This is an explicit Lloyds v5.2 export shape,
  // not a generic fallback chain.
  const propertyType = normalizePropertyType(pick(r, ['Property Type', 'Interested Party Name']));
  const gross = asNumber(pick(r, homeLloydsV52MappingSpec.premiumFields.gross)) ?? 0;
  const commission = asNumber(pick(r, homeLloydsV52MappingSpec.premiumFields.commission)) ?? 0;
  const tax = asNumber(pick(r, homeLloydsV52MappingSpec.premiumFields.tax)) ?? 0;
  const net = asNumber(pick(r, homeLloydsV52MappingSpec.premiumFields.net)) ?? Math.max(0, gross - commission);
  const fees = asNumber(pick(r, homeLloydsV52MappingSpec.premiumFields.fees)) ?? 0;
  const bedrooms = boundedPositiveInt(r['No Of Beds'], 1, 20)
    ?? boundedPositiveInt(r['Flat Roof'], 1, 20)
    ?? defaults?.defaultBedrooms
    ?? 0;
  const yearBuilt = normalizeYearBuilt(pick(r, ['Building Year Built', 'No Of Beds']));
  const buildingsSumInsured = firstPositiveMoney(r, ['Buildings Sum Insured', 'Buildings Gross Premium (ex IPT)']);
  const contentsSumInsured = firstPositiveMoney(r, ['Contents Sum Insured', 'Contents Gross Premium (ex IPT)']);
  const allRiskSumInsured = firstPositiveMoney(r, ['All Risk Sum Insured', 'All Risk Gross  Premium (ex IPT)']);
  const solarSumInsured = firstPositiveMoney(r, ['Solar Sum Insured', 'Solar Gross Premium (ex ipt)']);
  const productData = {
    bdxImportAssertions: {
      profile: 'BDX_HISTORICAL_HOME_LLOYDS_V52_BEAZLEY_2025_2026',
      source: 'Beazley Lloyds BDX 2025-06-01..2026-06-30',
      reason: 'Historical already-issued Home policies require canonical quoteData reconstruction for import; risk questions absent from Lloyds BDX are recorded as migration assertions, not customer answers.',
    },
    proposer: {
      firstName: firstName || 'Imported',
      lastName: lastName || 'Homeowner',
      email: importProposerEmail(r, policyRef, sourceRowNumber),
      phone: defaults?.defaultPhone || '',
      dateOfBirth: '1980-01-01',
      nationality: defaults?.defaultNationality || country,
      domicileCountry: country,
      address: { line1, city, country, postcode },
    },
    property: {
      address: { line1, city, country, postcode },
      sameAsProposer: true,
      propertyType,
      bedrooms,
      floorAreaSqm: 100,
      landAreaSqm: 0,
      urbanArea: true,
      within20MinFireStation: true,
      permanentHome: !yn(r['Unoccupied (Y/N)']),
      woodenConstruction: false,
      nonCombustibleMaterial: true,
      alarm: 'No',
      yearBuilt,
    },
    risk: {
      previousClaims: 'None',
      noClaimsDiscount: '0 Years',
      increasedExcess: 'STD 150 XS',
      proposerOver45: false,
    },
    usage: {
      permanentHome: !yn(r['Unoccupied (Y/N)']),
      businessUse: false,
      rentedOut: false,
    },
    security: {
      doorsFiveLeverLocks: true,
      windowsSecured: true,
      additionalSecurity: false,
      safeOnPremises: false,
    },
    coverage: {
      buildings: buildingsSumInsured,
      contents: contentsSumInsured,
      accidentalDamageBuildings: yn(r['Accidental Damage']),
      accidentalDamageContents: yn(r['Accidental Damage']),
      allRiskJewellery: allRiskSumInsured,
      allRiskOther: 0,
      solarPanelCover: solarSumInsured,
    },
    eligibility: { confirmation: true },
    policy: { startDate: inceptionDate },
  };

  return buildCommonDto({
    row,
    sourceRowNumber,
    productLine: 'home',
    productType: 'HOME',
    sourceId: policyRef,
    policyRef,
    entry: canonicalEntry(pick(r, homeLloydsV52MappingSpec.policyFields.entry)),
    insured: `${firstName} ${lastName}`.trim() || policyRef,
    inceptionDate,
    expiryDate,
    bookedDate: asDateString(pick(r, homeLloydsV52MappingSpec.dateFields.booked)),
    gross,
    commission,
    tax,
    fees,
    net,
    total: asNumber(pick(r, homeLloydsV52MappingSpec.premiumFields.total)) ?? gross + tax + fees,
    postcode,
    cover: propertyType || 'Home',
    excess: asNumber(r['Deductible or Excess Amount']),
    productData,
  });
}

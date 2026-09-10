import type { BdxRawRow, BdxRowDto } from './types.js';
import { mapHomeRawRowToDto } from './productMappers/homeMapper.js';
import { mapTravelRawRowToDto } from './productMappers/travelMapper.js';
import { motorLloydsV52MappingSpec } from './productMappers/motorMapper.js';
import { importPlaceholderEmail } from './productMappers/shared.js';
import type { JurisdictionProductConfig } from '../../../jurisdiction/domain/productConfiguration.js';

type UnknownRecord = Record<string, unknown>;
type EnrichedQuoteData = Record<string, unknown>;

function asRecord(v: unknown): UnknownRecord {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as UnknownRecord) : {};
}

function asString(v: unknown): string {
  return v === null || v === undefined ? '' : String(v).trim();
}

function formatDateParts(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function asDateString(v: unknown): string {
  if (!v) return '';
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().split('T')[0];
  const raw = String(v).trim();
  const dayFirst = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dayFirst) {
    const day = Number(dayFirst[1]);
    const month = Number(dayFirst[2]);
    const year = Number(dayFirst[3]);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day
    ) {
      return formatDateParts(year, month, day);
    }
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().split('T')[0];
}

function asNumber(v: unknown): number | null {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const parsed = Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function pickValue(row: UnknownRecord, aliases: string[]): unknown {
  for (const alias of aliases) {
    const value = row[alias];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return null;
}

// Canonical Abbeygate-Cyprus motor BDX endorsement-dialect map. The source
// BDX files emitted by the operator (Symphony, Volante) ship endorsement
// codes in the `AB N` form. The canonical product registry uses `CV N`. This
// map is the SINGLE source of truth for the translation, and lives next to
// the parser so the round-trip from a BDX cell to the rated quote stays in
// one file.
//
// History note: this table + the classic-vehicle resolver for `AB 171` were
// deleted in `824718b4` ("refactor(spine/v2): delete legacy/back-compat
// paths") on the assumption that source spreadsheets would arrive with
// canonical codes. They do not — every Cyprus motor BDX from Jan 2025
// onward uses the `AB N` dialect. The deletion silently broke ~10k motor
// rows; restoring it here, with the original 8 codes plus the AB 171
// classic-vehicle resolver, is the minimum to unblock the import.
const BDX_ENDORSEMENT_ALIAS_MAP: Record<string, string> = {
  'AB 4': 'CV 4',
  'AB 5': 'CV 5',
  'AB 7': 'CV 7',
  'AB 22': 'CV 22',
  'AB 23': 'CV 23',
  'AB 24': 'CV 24',
  'AB 46': 'CV 46',
  'ABG 001': 'ABG001',
  'ABG001': 'ABG001',
};

const BDX_ENDORSEMENT_IGNORED_TOKENS = new Set(['2026-12-02 00:00:00']);

function splitEndorsementTokens(raw: string): string[] {
  return raw
    .split(',')
    .flatMap((part) => {
      const token = part.trim();
      if (!token) return [];
      const chainedCodes = token.match(/\b(?:ABG\s*0*01|AB\s*\d+|CV\s*\d+)\b/gi);
      if (chainedCodes && chainedCodes.length > 1) return chainedCodes;
      return [token.replace(/-+$/g, '').trim()];
    })
    .filter(Boolean);
}

function isClassicVehicleCandidate(args: {
  details: string;
  make: string;
  model: string;
  vehicleYear: number | null;
}): boolean {
  const haystack = `${args.details} ${args.make} ${args.model}`.toLowerCase();
  if (/(classic|vintage|historic|heritage|veteran)/.test(haystack)) return true;
  const currentYear = new Date().getFullYear();
  return Boolean(args.vehicleYear && args.vehicleYear <= currentYear - 25);
}

function parseEndorsements(
  raw: string,
  args: { details: string; make: string; model: string; vehicleYear: number | null },
): string[] {
  return [
    ...new Set(
      splitEndorsementTokens(raw)
        .map((x) => {
          // Normalize `cv4` → `CV 4`, `AB7` → `AB 7`, leave `ABG001` glued.
          const upper = x.toUpperCase();
          let normalized: string;
          if (/^[A-Z]+\s[0-9]+$/.test(upper)) {
            normalized = upper;
          } else {
            const m = upper.match(/^([A-Z]{1,2})([0-9]+)$/);
            normalized = m ? `${m[1]} ${m[2]}` : upper;
          }
          if (BDX_ENDORSEMENT_IGNORED_TOKENS.has(normalized)) return '';
          // `AB 171` is the operator-shorthand for the classic-vehicle
          // jacket. The product registry models it as ABG001 (classic
          // motor) and only attaches it to classic-vehicle candidates;
          // on a modern car the code is dropped rather than failing.
          if (normalized === 'AB 171') {
            return isClassicVehicleCandidate(args) ? 'ABG001' : '';
          }
          return BDX_ENDORSEMENT_ALIAS_MAP[normalized] || normalized;
        })
        .filter(Boolean),
    ),
  ];
}

function isLikelyElectricVehicleFromParts(args: { make: string; model: string; details: string }): boolean {
  const haystack = `${args.make} ${args.model} ${args.details}`.toLowerCase();
  return haystack.includes('electric')
    || haystack.includes(' e-tron')
    || haystack.includes('etron')
    || haystack.includes(' ev ')
    || haystack.endsWith(' ev')
    || haystack.includes('(0)')
    || haystack.includes(' xpower e')
    || haystack.includes(' elite e')
    || haystack.includes('ix xdrive');
}

export function mapRawRowToDto(row: BdxRawRow, sourceRowNumber: number, jurisdictionConfig?: JurisdictionProductConfig): BdxRowDto {
  const r = asRecord(row);
  const productLine = asString(r.__productLine).toLowerCase();
  // `spine/v2` Wave 5: routing reads `__productLine` ONLY. The prior
  // `Class of Business` fallback was a second decision authority — the
  // reviewer flagged it as a duplicated source of truth. Operators
  // tagging rows with the wrong product now fail loud at this gate
  // instead of silently routing into the wrong product pipeline.
  if (productLine === 'travel') return mapTravelRawRowToDto(row, sourceRowNumber, jurisdictionConfig);
  if (productLine === 'home') return mapHomeRawRowToDto(row, sourceRowNumber, jurisdictionConfig);
  if (productLine !== 'motor') {
    throw new Error(
      `Unsupported BDX __productLine='${productLine || '<empty>'}' on row ${sourceRowNumber}. ` +
      `Tag the row with __productLine='motor' | 'travel' | 'home' before import.`,
    );
  }
  const spec = motorLloydsV52MappingSpec;
  const sourceSheetName = asString(r.__sheetName) || 'Sheet1';
  const sourceFile = asString(r.__sourceFile);
  const sourceMonth = asString(r.__sourceMonth);
  const sourceId = asString(pickValue(r, [...spec.policyFields.sourceId])) || `row-${sourceRowNumber}`;
  const policyRef = asString(pickValue(r, [...spec.policyFields.policyRef]));
  const entry = asString(pickValue(r, [...spec.policyFields.entry])).toUpperCase();
  const endorsementRaw = asString(pickValue(r, [...spec.policyFields.endorsement]));
  const gross = asNumber(pickValue(r, [...spec.premiumFields.gross])) ?? 0;
  const commission = asNumber(pickValue(r, [...spec.premiumFields.commission])) ?? 0;
  const tax = (asNumber(pickValue(r, [...spec.premiumFields.mifPayable])) ?? 0)
    + (asNumber(pickValue(r, [...spec.premiumFields.stampPayable])) ?? 0);
  const fees = asNumber(pickValue(r, [...(spec.premiumFields.fees || [])])) ?? 0;
  const net = asNumber(pickValue(r, [...spec.premiumFields.net])) ?? 0;
  const total = asNumber(pickValue(r, [...spec.premiumFields.total])) ?? gross + tax + fees;
  const details = asString(pickValue(r, [...spec.riskFields.details]));
  const make = asString(pickValue(r, [...spec.riskFields.make]));
  const model = asString(pickValue(r, [...spec.riskFields.model]));
  const vehicleYear = asNumber(pickValue(r, [...spec.riskFields.vehicleYear]));
  const rawEngineSize = asNumber(pickValue(r, [...spec.riskFields.engineSize]));
  const inceptionDate = asDateString(pickValue(r, [...spec.dateFields.inception]));
  const expiryDate = asDateString(pickValue(r, [...spec.dateFields.expiry]));
  // `spine/v2` Wave 5 deleted `applyApprovedBdxCorrections` — the
  // pre-Wave-5 table hard-coded fixes for individual policy refs
  // (e.g. `ABLV1006371` → expiry from 2016 to 2026) which is dirty-data
  // laundering inside our import code. Bad source rows must fail import
  // and be fixed at the source spreadsheet instead.
  const dtoEngineSize = rawEngineSize ?? (isLikelyElectricVehicleFromParts({ make, model, details }) ? 0 : null);
  return {
    ...(sourceFile ? { sourceFile } : {}),
    sourceSheetName,
    ...(sourceMonth ? { sourceMonth } : {}),
    sourceRowNumber,
    productLine: 'motor',
    productType: 'MOTOR',
    ...(asString(r.__tenantSite) ? { tenantSite: asString(r.__tenantSite) } : {}),
    sourceId,
    policyRef,
    rowKey: `${sourceSheetName}::${policyRef}::${sourceId}::${sourceRowNumber}`,
    termKey: '',
    policyChainKey: '',
    entry,
    insured: asString(pickValue(r, [...spec.insuredFields.name])),
    endorsementRaw,
    bookedDate: asDateString(pickValue(r, [...spec.dateFields.booked])),
    inceptionDate,
    expiryDate,
    dateOfBirth: asDateString(pickValue(r, [...spec.insuredFields.dateOfBirth])),
    occupation: asString(pickValue(r, [...spec.insuredFields.occupation])),
    postcode: asString(pickValue(r, [...spec.insuredFields.postcode])),
    make,
    model,
    engineSize: dtoEngineSize,
    ncbYears: asNumber(pickValue(r, [...spec.riskFields.ncbYears])),
    claimProtection: asString(pickValue(r, [...spec.riskFields.claimProtection])),
    vehicleValue: asNumber(pickValue(r, [...spec.riskFields.vehicleValue])),
    vehicleYear,
    registration: asString(pickValue(r, [...spec.riskFields.registration])),
    cover: asString(pickValue(r, [...spec.coverFields.cover])),
    excess: asNumber(pickValue(r, [...spec.coverFields.excess])),
    drivers: asString(pickValue(r, [...spec.coverFields.drivers])),
    use: asString(pickValue(r, [...spec.coverFields.use])),
    premiumPayable: asNumber(pickValue(r, [...spec.premiumFields.total])),
    grossPremium: asNumber(pickValue(r, [...spec.premiumFields.gross])),
    mifPayable: asNumber(pickValue(r, [...spec.premiumFields.mifPayable])),
    stampPayable: asNumber(pickValue(r, [...spec.premiumFields.stampPayable])),
    commission: asNumber(pickValue(r, [...spec.premiumFields.commission])),
    payableToArb: asNumber(pickValue(r, [...spec.premiumFields.net])),
    note: asString(pickValue(r, [...spec.policyFields.note])),
    details,
    declared: { gross, commission, tax, fees, net, total },
    parsedEndorsements: parseEndorsements(endorsementRaw, { details, make, model, vehicleYear }),
  };
}

function splitInsuredName(insured: string) {
  const clean = insured.trim();
  if (!clean) return { firstName: 'Unknown', lastName: 'Insured' };
  const parts = clean.split(/\s+/g);
  if (parts.length === 1) return { firstName: parts[0], lastName: 'Insured' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function mapNcbLabel(ncbYears: number | null): string {
  if (ncbYears === null || ncbYears <= 0) return 'None';
  if (ncbYears >= 5) return '5+ Years';
  if (ncbYears === 4) return '4 Years';
  if (ncbYears === 3) return '3 Years';
  if (ncbYears === 2) return '2 Years';
  return '1 Year';
}

function mapCover(cover: string): string {
  return cover.toLowerCase() === 'tpo' ? 'Third Party Liability' : 'Comprehensive';
}

function mapVehicleType(details: string): string {
  const d = details.toLowerCase();
  if (d.includes('motorcaravan') || d.includes('motorhome') || d.includes('caravan')) return 'Motorcaravan';
  if (d.includes('m/c') || d.includes('motor')) return 'Motorbike';
  if (d.includes('classic')) return 'Classic Car';
  return 'Private Car';
}

function mapVehicleUse(use: string): string {
  if (use === 'Class 2' || use === 'Class 3') return use;
  if (use === 'Class 1') return 'Class 1';
  return 'SDP';
}

function deriveLicenseYears(dateOfBirth: string): number {
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return 10;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) age -= 1;
  return Math.max(1, Math.min(50, age - 17));
}

function computeTermMonths(startDate: string, endDate: string): number | null {
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return null;
  const dayMs = 24 * 60 * 60 * 1000;
  const days = Math.max(1, Math.floor((end.getTime() - start.getTime()) / dayMs));
  return Math.max(1, Math.round((days / 30.4375) * 100) / 100);
}

function deriveMbePolicyTermMonths(dto: BdxRowDto): number | null {
  const proratedEntries = new Set(['PAM', 'ADJ', 'CAN', 'FIVA-PAM', 'NTU', 'NB/COC']);
  const effectiveDate = proratedEntries.has(dto.entry) ? (dto.bookedDate || dto.inceptionDate) : dto.inceptionDate;
  if (!effectiveDate || !dto.expiryDate) return null;
  return computeTermMonths(effectiveDate, dto.expiryDate);
}

function isLikelyElectricVehicle(dto: BdxRowDto): boolean {
  const haystack = `${dto.make} ${dto.model} ${dto.details}`.toLowerCase();
  return haystack.includes('electric')
    || haystack.includes(' e-tron')
    || haystack.includes('etron')
    || haystack.includes(' ev ')
    || haystack.endsWith(' ev')
    || haystack.includes('(0)')
    || haystack.includes(' xpower e')
    || haystack.includes(' elite e')
    || haystack.includes('ix xdrive');
}

function deriveFuelType(dto: BdxRowDto): string {
  return isLikelyElectricVehicle(dto) ? 'Electric' : 'Petrol';
}

function deriveEngineSize(dto: BdxRowDto): number {
  if (dto.engineSize && dto.engineSize > 0) return Number(dto.engineSize);
  return isLikelyElectricVehicle(dto) ? 0 : 1000;
}

export function buildQuoteDataFromDto(dto: BdxRowDto, jurisdictionConfig?: JurisdictionProductConfig): EnrichedQuoteData {
  if (dto.productData && dto.productType && dto.productType !== 'MOTOR') {
    return {
      ...dto.productData,
      __migrationMeta: {
        source: `BDX_${dto.productType}`,
        sourceFile: dto.sourceFile,
        sourceSheetName: dto.sourceSheetName,
        sourceMonth: dto.sourceMonth,
        sourceRowNumber: dto.sourceRowNumber,
        rowKey: dto.rowKey,
      },
    };
  }
  const { firstName, lastName } = splitInsuredName(dto.insured);
  const policyRefSafe = dto.policyRef || dto.sourceId;
  const placeholderEmail = importPlaceholderEmail(policyRefSafe, dto.sourceRowNumber);
  // Migration mode keeps rating deterministic while avoiding issuance-time start-date windows.
  const renewalDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const policyTermMonths = deriveMbePolicyTermMonths(dto);
  const defaults = jurisdictionConfig?.bdxConfig.importDefaults;
  const defaultCountry = defaults?.defaultCountry || '';
  const defaultCity = defaults?.defaultCity || '';
  const defaultProvince = defaults?.defaultProvince || '';
  const defaultPostcode = defaults?.defaultPostcode || '0000';
  const defaultPhone = defaults?.defaultPhone || '';
  const defaultVehicleLocation = defaults?.defaultVehicleLocation || defaultCountry;
  const defaultCountryOfRegistration = defaults?.defaultCountryOfRegistration || defaultCountry;
  const defaultLicenseIssuedIn = defaults?.defaultLicenseIssuedIn || defaultCountry;
  const defaultNationality = defaults?.defaultNationality || '';
  const isMotorbike = mapVehicleType(dto.details).toLowerCase().includes('motorbike');
  const hasAdditionalDrivers = dto.drivers !== 'Policy Holder';
  const additionalDrivers = hasAdditionalDrivers
    ? [{
      firstName: 'Additional',
      lastName: 'Driver',
      dateOfBirth: dto.dateOfBirth || '1985-01-01',
      licenseYears: Math.max(1, deriveLicenseYears(dto.dateOfBirth) - 2),
      email: '',
      telephone: '',
    }]
    : [];
  const quoteData: EnrichedQuoteData = {
    proposer: {
      firstName,
      lastName,
      address: {
        line1: `Imported BDX ${policyRefSafe}`,
        city: defaultCity,
        province: defaultProvince,
        postcode: dto.postcode || defaultPostcode,
        country: defaultCountry,
      },
      phone: defaultPhone,
      dateOfBirth: dto.dateOfBirth,
      email: placeholderEmail,
      nationality: defaultNationality,
      nif: '',
      occupation: dto.occupation || 'Unknown',
      whereDidYouHear: 'BDX Migration',
      marketingConsent: false,
      privacyPolicyAccepted: true,
    },
    firstName,
    lastName,
    addressLine: `Imported BDX ${policyRefSafe}`,
    city: defaultCity,
    province: defaultProvince,
    postCode: dto.postcode || defaultPostcode,
    country: defaultCountry,
    telephone: defaultPhone,
    dateOfBirth: dto.dateOfBirth,
    email: placeholderEmail,
    nationality: defaultNationality,
    nif: '',
    occupation: dto.occupation || 'Unknown',
    whereDidYouHear: 'BDX Migration',
    marketingOptIn: false,
    privacyPolicyAccepted: true,
    licenseYears: deriveLicenseYears(dto.dateOfBirth),
    licenseType: 'Full',
    licenseIssuedIn: defaultLicenseIssuedIn,
    hasClaims: false,
    claimsDetails: '',
    claimsCountLast5Years: 0,
    claimsTotalCostLast5Years: 0,
    maxFaultClaimCostLast5Years: 0,
    hasConvictions: false,
    convictionsDetails: '',
    hasMajorConvictionLast5Years: false,
    convictionClass: 'minor_technical',
    majorConvictionWithinYears: 5,
    hasAdditionalDrivers,
    youngestDriverAge: 30,
    otherDriversClaims: false,
    otherDriversClaimsDetails: '',
    otherDriversConvictions: false,
    otherDriversConvictionsDetails: '',
    additionalDrivers,
    driverPricingBasis: 'NAMED_DRIVERS',
    vehicleLocation: dto.postcode || defaultVehicleLocation,
    coverRequired: mapCover(dto.cover),
    renewalDate,
    startDate: dto.inceptionDate || renewalDate,
    vehicleType: mapVehicleType(dto.details),
    motorcycleRidersNamed: isMotorbike ? true : false,
    classicIsGenuine: dto.details.toLowerCase().includes('classic'),
    classicIsSecondaryVehicle: dto.details.toLowerCase().includes('classic'),
    make: dto.make || 'UNKNOWN',
    model: dto.model || 'UNKNOWN',
    cabrio: 'No',
    fuelType: deriveFuelType(dto),
    kmsPerYear: '10000',
    year: Number(dto.vehicleYear || 2015),
    countryOfRegistration: defaultCountryOfRegistration,
    registrationNumber: dto.registration || `REG${dto.sourceRowNumber}`,
    vin: '',
    numberOfSeats: isMotorbike ? 2 : 5,
    modified: false,
    modificationsDetails: '',
    parking: 'Private',
    parkingOther: '',
    garageTotalValue: 0,
    engineSize: deriveEngineSize(dto),
    vehicleValue: Number(dto.vehicleValue || 5000),
    ncb: mapNcbLabel(dto.ncbYears),
    protectNCB: dto.claimProtection.toLowerCase() === 'yes',
    vehicleUse: mapVehicleUse(dto.use),
    businessUseDetails: '',
    requiredExcess: String(Math.round(Number(dto.excess || 200))),
    ncdProofUpload: '',
    bestTimeToCall: 'Anytime',
    homeInsuranceRenewalDate: renewalDate,
    infoTrueAndAccurate: true,
    fairProcessingAccepted: true,
    __migrationMeta: {
      source: defaults?.migrationSourceCode || 'BDX_UNCONFIGURED_SOURCE',
      sourceSheetName: dto.sourceSheetName,
      sourceRowNumber: dto.sourceRowNumber,
      rowKey: dto.rowKey,
    },
    ...(policyTermMonths ? {
      policyTermMonths,
      __mbePolicyTermMonths: policyTermMonths,
    } : {}),
  };
  const enriched = applyDeterministicBdxEnrichment(quoteData, jurisdictionConfig);
  return enriched.quoteData;
}

export function applyDeterministicBdxEnrichment(quoteDataRaw: unknown, jurisdictionConfig?: JurisdictionProductConfig): {
  quoteData: EnrichedQuoteData;
  profile: string;
  version: string;
  filledFields: string[];
  fieldSources: Record<string, 'bdx' | 'derived' | 'default'>;
} {
  const quoteDataRecord: Record<string, unknown> = { ...asRecord(quoteDataRaw) };
  const profile = jurisdictionConfig
    ? `BDX_CONTRACT_PROFILE_${jurisdictionConfig.productCode}_${jurisdictionConfig.countryCode}`
    : 'BDX_CONTRACT_PROFILE_MOTOR';
  const fieldSources: Record<string, 'bdx' | 'derived' | 'default'> = {};
  for (const key of Object.keys(quoteDataRecord)) fieldSources[key] = 'bdx';
  const filledFields: string[] = [];

  // Phase 6k: BDX import writes policyholder fields under the canonical
  // `proposer.*` (and `proposer.address.*`) shape. Any flat-shape input
  // is migrated up-front before defaulting so the importer never persists
  // both shapes.
  if (!quoteDataRecord.proposer || typeof quoteDataRecord.proposer !== 'object' || Array.isArray(quoteDataRecord.proposer)) {
    quoteDataRecord.proposer = {};
  }
  const proposerRecord = quoteDataRecord.proposer as Record<string, unknown>;
  if (!proposerRecord.address || typeof proposerRecord.address !== 'object' || Array.isArray(proposerRecord.address)) {
    proposerRecord.address = {};
  }
  const addressRecord = proposerRecord.address as Record<string, unknown>;

  const flatToProposer: Array<[string, string]> = [
    ['firstName', 'firstName'],
    ['lastName', 'lastName'],
    ['email', 'email'],
    ['telephone', 'phone'],
    ['phone', 'phone'],
    ['dateOfBirth', 'dateOfBirth'],
    ['nationality', 'nationality'],
    ['occupation', 'occupation'],
    ['nif', 'nif'],
    ['whereDidYouHear', 'whereDidYouHear'],
    ['bestTimeToCall', 'bestTimeToCall'],
    ['privacyPolicyAccepted', 'privacyPolicyAccepted'],
  ];
  for (const [flat, nested] of flatToProposer) {
    if (proposerRecord[nested] === undefined && quoteDataRecord[flat] !== undefined) {
      proposerRecord[nested] = quoteDataRecord[flat];
    }
    delete quoteDataRecord[flat];
  }
  if (proposerRecord.marketingConsent === undefined && quoteDataRecord.marketingOptIn !== undefined) {
    proposerRecord.marketingConsent = quoteDataRecord.marketingOptIn;
  }
  delete quoteDataRecord.marketingOptIn;
  if (proposerRecord.domicileCountry === undefined && quoteDataRecord.country !== undefined) {
    proposerRecord.domicileCountry = quoteDataRecord.country;
  }

  const flatAddressToProposer: Array<[string, string]> = [
    ['addressLine', 'line1'],
    ['city', 'city'],
    ['province', 'province'],
    ['postCode', 'postcode'],
    ['country', 'country'],
  ];
  for (const [flat, nested] of flatAddressToProposer) {
    if (addressRecord[nested] === undefined && quoteDataRecord[flat] !== undefined) {
      addressRecord[nested] = quoteDataRecord[flat];
    }
    delete quoteDataRecord[flat];
  }

  // Normalize the additionalDrivers shape based on the prospect's
  // `hasAdditionalDrivers` flag. This is shape canonicalisation (drop
  // ghost driver entries when the flag is false), NOT defaulting.
  // Pre-`spine/v2` Wave 5 this block also injected a placeholder
  // driver row when `hasAdditionalDrivers === true` but the array was
  // empty — that fabricated data and was removed alongside the rest
  // of the `setIfMissing` chain. If a prospect file says "yes, has
  // additional drivers" but provides none, downstream validation now
  // fails loud instead of silently rating against a synthetic 30-year
  // old driver.
  const hasAdditionalDrivers = Boolean(quoteDataRecord.hasAdditionalDrivers);
  if (!hasAdditionalDrivers) {
    if (!Array.isArray(quoteDataRecord.additionalDrivers) || quoteDataRecord.additionalDrivers.length > 0) {
      quoteDataRecord.additionalDrivers = [];
      fieldSources.additionalDrivers = 'derived';
      if (!filledFields.includes('additionalDrivers')) filledFields.push('additionalDrivers');
    }
  }

  return {
    quoteData: quoteDataRecord as EnrichedQuoteData,
    profile,
    version: 'v2',
    filledFields,
    fieldSources,
  };
}

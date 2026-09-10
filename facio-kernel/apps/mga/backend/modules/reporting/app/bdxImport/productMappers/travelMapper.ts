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

export const travelLloydsV52MappingSpec: LloydsV52MappingSpec = {
  productLine: 'travel',
  productType: 'TRAVEL',
  policyFields: {
    // Each travel certificate is a separate policy/trip. Lloyds v5.2 BDX
    // makes Certificate Ref mandatory on every travel risk row — it's
    // the only column guaranteed to be unique per traveller. Group Ref
    // and Broker's Ref are operator-side metadata, intentionally shared
    // across many rows in a corporate scheme.
    //
    // Single canonical source, no fallback chain. If Certificate Ref is
    // absent on a row, the row is malformed; `runStructuralValidation`
    // emits STRUCTURAL/Critical "Missing policy reference" and
    // `runCompletenessValidation` emits COMPLETENESS/Critical "Missing
    // required TRAVEL import field 'policyRef'", and the operator fixes
    // the source data. We do NOT silently fall back to Group Ref — that
    // re-introduces the bug where every traveller in a scheme collided
    // on Policy `@@unique([policyNumber, renewalSequence])` at commit.
    //
    // See `.cursor/skills/no-defensive-fallbacks/SKILL.md`.
    policyRef: ['Certificate Ref'],
    // sourceId is operator-facing trace metadata used as `rowId` in the
    // failure report. It is NOT the policy identity, so falling through
    // to Group Ref / Broker's Ref is fine here — it only affects which
    // string the operator sees next to the gap.
    sourceId: ['Certificate Ref', 'Policy or Group Ref', "Broker's Ref Number"],
    entry: ['Risk, Transaction Type', 'Transaction Type - Original Premium etc.', 'Entry Reason'],
  },
  insuredFields: {
    firstName: ['Insured First Name'],
    lastName: ['Insured Full Name, Last Name or Company Name'],
    country: ['Insured Country (see code list)', 'Location of risk - Country'],
    address: ['Insured Address', 'Location of Risk, Address'],
    postcode: ['Insured Postcode, Zip Code or Similar', 'Location of Risk, Postcode, zip code or similar'],
  },
  coverFields: {
    plan: ['Level of Cover'],
    area: ['Area of Cover'],
    travellers: ['Travellers'],
    tripType: ['Type of Cover'],
    maxTripDays: ['Number of Days'],
  },
  premiumFields: {
    gross: ['Total gross written premium'],
    commission: ['Coverholder commission amount for whole risk/written premium'],
    tax: ['Total taxes payable locally'],
    net: ['Net written Premium to London in original currency'],
    total: ['Total gross written premium'],
  },
  dateFields: {
    inception: ['Risk Inception Date', 'Risk Trip Start Date', 'From Date', 'Risk Inception Date From Date'],
    expiry: ['Risk Expiry Date', 'Risk Trip End Date', 'To Date', 'Risk Expiry Date To Date'],
    booked: ['Effective Date of Transaction', 'Policy issuance date'],
  },
  riskFields: {
    travellerNames: ['Traveller 1 Name', 'Traveller 2 Name', 'Traveller 3 Name', 'Traveller 4 Name', 'Traveller 5 Name'],
    travellerDobs: ['Traveller 1 DOB', 'Traveller 2 DOB', 'Traveller 3 DOB', 'Traveller 4 DOB', 'Traveller 5 DOB'],
    addons: ['Winter Sports Cover', 'Gadget Cover', 'Business Cover', 'Golf Cover', 'Terrorism Cover', 'Sports Equipment Cover', 'Wedding Cover'],
  },
};

function lowerPlan(value: unknown): string {
  const normalized = asString(value).toLowerCase();
  if (normalized.includes('platinum')) return 'platinum';
  if (normalized.includes('gold')) return 'gold';
  return 'silver';
}

function isPostcodeLike(value: string): boolean {
  return /^\d{4}-?\d{3}$/i.test(value) || /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i.test(value);
}

function canonicalTravelResidence(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'cyprus' || normalized === 'cy') return 'Republic of Cyprus';
  if (normalized === 'portugal' || normalized === 'pt') return 'Portugal';
  if (normalized === 'greece' || normalized === 'gr') return 'Greece';
  if (normalized === 'spain' || normalized === 'es') return 'Spain';
  return value;
}

function resolveCountryOfResidence(r: Record<string, unknown>, defaults?: JurisdictionProductConfig['bdxConfig']['importDefaults']): string {
  const allowed = new Set(['Greece', 'Portugal', 'Republic of Cyprus', 'Spain']);
  const candidates = [
    r['Location of risk - Country'],
    r['Tax 1 - Jurisdiction: Country, State, Province, Territory'],
    r['Insured Country (see code list)'],
    r['Insured Country Sub-division: State, Province, Territory, Canton etc.'],
    defaults?.defaultCountry,
  ];
  for (const candidate of candidates) {
    const value = canonicalTravelResidence(asString(candidate));
    if (!value || isPostcodeLike(value)) continue;
    if (allowed.has(value)) return value;
  }
  return canonicalTravelResidence(defaults?.defaultCountry || '');
}

function historicalImportNationality(countryOfResidence: string): string {
  // Britt / AbbeyTravel Lloyds BDX 2025-06..2026-06 carries residence
  // country, traveller DOBs and policy identity, but no nationality or
  // objective residency answers. These records are already-issued legacy
  // policies being reconstructed for go-live, not new customer quotes.
  // Per ADR-0051, use a non-residence nationality assertion to satisfy the
  // expat eligibility profile while preserving the assertion in quoteData.
  return countryOfResidence === 'United Kingdom' ? 'Ireland' : 'United Kingdom';
}

function splitTravellerName(raw: unknown, fallbackIndex: number): { firstName: string; lastName: string } {
  const name = asString(raw);
  if (!name) return { firstName: `Traveller${fallbackIndex}`, lastName: 'Imported' };
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return { firstName: parts[0] || `Traveller${fallbackIndex}`, lastName: 'Imported' };
  return {
    firstName: parts[0] || `Traveller${fallbackIndex}`,
    lastName: parts.slice(1).join(' ') || 'Imported',
  };
}

function travelCoverType(value: unknown): 'single' | 'couple' | 'family' | 'single_parent_family' {
  const normalized = asString(value).toLowerCase();
  if (normalized.includes('single parent')) return 'single_parent_family';
  if (normalized.includes('family')) return 'family';
  if (normalized.includes('couple')) return 'couple';
  return 'single';
}

function usableCity(value: unknown): string {
  const city = asString(value);
  if (city.length < 2) return '';
  if (/^(n\/a|none|unknown|\.)$/i.test(city)) return '';
  return city;
}

function expectedTravellerCount(coverType: string): number {
  if (coverType === 'couple') return 2;
  if (coverType === 'family' || coverType === 'single_parent_family') return 3;
  return 1;
}

function additionalTravellerRows(r: UnknownRecord, coverType: string): {
  additionalTravellerDOBs: string[];
  additionalTravellers: Array<{ firstName: string; lastName: string; idType: 'id_card'; idNumber: string }>;
  travellerCount: number;
} {
  const policyRef = asString(r['Certificate Ref']) || 'BDX-TRAVEL';
  const requestedCount = expectedTravellerCount(coverType);
  const rows: Array<{ firstName: string; lastName: string; idType: 'id_card'; idNumber: string; dob: string }> = [];
  for (let index = 2; index <= 5; index += 1) {
    const dob = asDateString(r[`Traveller ${index} DOB`]);
    const idNumber = asString(r[`Traveller ${index} NIE`]) || `${policyRef}-T${index}`;
    const rawName = r[`Traveller ${index} Name`];
    if (!dob && !asString(rawName) && !idNumber) continue;
    const name = splitTravellerName(rawName, index);
    rows.push({
      ...name,
      idType: 'id_card',
      idNumber,
      dob,
    });
  }
  const targetAdditionalCount = Math.max(0, requestedCount - 1);
  const selected = rows.slice(0, targetAdditionalCount);
  return {
    travellerCount: Math.max(1, 1 + selected.length),
    additionalTravellerDOBs: selected.map((traveller) => traveller.dob),
    additionalTravellers: selected.map(({ dob: _dob, ...traveller }) => traveller),
  };
}

export function mapTravelRawRowToDto(row: BdxRawRow, sourceRowNumber: number, jurisdictionConfig?: JurisdictionProductConfig): BdxRowDto {
  const r = asRecord(row);
  const defaults = jurisdictionConfig?.bdxConfig.importDefaults;
  // Do NOT synthesise a fallback policyRef. An empty string here is the
  // honest signal that Certificate Ref was missing from the source row;
  // `runStructuralValidation` + `runCompletenessValidation` will catch
  // it and the operator will see a Critical gap in the dry-run report.
  // (Skill: `.cursor/skills/no-defensive-fallbacks/SKILL.md`.)
  const policyRef = asString(pick(r, travelLloydsV52MappingSpec.policyFields.policyRef));
  // sourceId is reporting-only; falling through to other ID-ish columns
  // gives the operator a useful row label even when the row is malformed.
  const sourceId = asString(pick(r, travelLloydsV52MappingSpec.policyFields.sourceId)) || policyRef || `row-${sourceRowNumber}`;
  const firstName = asString(pick(r, travelLloydsV52MappingSpec.insuredFields.firstName));
  const lastName = asString(pick(r, travelLloydsV52MappingSpec.insuredFields.lastName));
  const country = resolveCountryOfResidence(r, defaults);
  const importNationality = historicalImportNationality(country);
  const inceptionDate = asDateString(pick(r, travelLloydsV52MappingSpec.dateFields.inception));
  const expiryDate = asDateString(pick(r, travelLloydsV52MappingSpec.dateFields.expiry));
  const gross = asNumber(pick(r, travelLloydsV52MappingSpec.premiumFields.gross)) ?? 0;
  const commission = asNumber(pick(r, travelLloydsV52MappingSpec.premiumFields.commission)) ?? 0;
  const tax = asNumber(pick(r, travelLloydsV52MappingSpec.premiumFields.tax)) ?? 0;
  const net = asNumber(pick(r, travelLloydsV52MappingSpec.premiumFields.net)) ?? Math.max(0, gross - commission);
  const fees = asNumber(r['Other Fees or Deductions written Amount']) ?? 0;
  const travellerDob = asDateString(r['Traveller 1 DOB']) || '1980-01-01';
  const coverType = travelCoverType(r['Travellers']);
  const additionalTravellers = additionalTravellerRows(r, coverType);
  // Lloyds v5.2 BDX does not carry a structured address, so synthesize one
  // from the columns it does carry. Canonical travel schema requires
  // proposer.address.{line1,city,country} or the row fails CALCULABILITY at
  // import time. Pre-`spine/v2` Wave 5 this gap was masked by silent
  // `setIfMissing` defaults; mappers now own it explicitly.
  const addressLine1 = asString(pick(r, travelLloydsV52MappingSpec.insuredFields.address))
    || `${asString(r['Insured Town, City, Suburb, Place'] || '')}`.trim()
    || `${firstName} ${lastName}`.trim()
    || policyRef;
  const addressCity = usableCity(r['Insured Town, City, Suburb, Place'])
    || usableCity(r['Insured Country Sub-division: State, Province, Territory, Canton etc.'])
    || defaults?.defaultCity
    || country;
  const postcode = asString(pick(r, travelLloydsV52MappingSpec.insuredFields.postcode));
  const productData = {
    bdxImportAssertions: {
      profile: 'BDX_HISTORICAL_TRAVEL_LLOYDS_V52_BRITT_2025_2026',
      source: 'Britt Lloyds BDX 2025-06-01..2026-06-30',
      reason: 'Historical already-issued Travel policies lack nationality and residency-duration cells; import asserts legacy expat eligibility for reconstruction and preserves the assertion for audit.',
    },
    eligibility: {
      countryOfResidence: country,
      isExpat: true,
      nationality: importNationality,
      hasOtherNationality: false,
      residenceDuration: 'gt_3_years',
      willRemainResident: true,
      residencyStatus: 'permanent_resident',
      legallyPermittedToReside: true,
      informationAccurate: true,
      residencyConfirmation: true,
      languageConfirmation: true,
      legalAgreement: true,
    },
    travellers: {
      coverType,
      leadTravellerDOB: travellerDob,
      travellerCount: additionalTravellers.travellerCount,
      additionalTravellerDOBs: additionalTravellers.additionalTravellerDOBs,
      additionalTravellers: additionalTravellers.additionalTravellers,
    },
    trip: {
      planType: asString(r['Type of Cover']).toLowerCase().includes('multi') ? 'annual_multi_trip' : 'single_trip',
      destinations: [asString(r['Area of Cover']) || country],
      startDate: inceptionDate,
      endDate: expiryDate,
    },
    quote: {
      selectedPlan: lowerPlan(r['Level of Cover']),
      // maxTripDays is required by the canonical travel schema for every
      // travel quote. Source resolution order:
      //   1. Explicit `Number of Days` cell if present and > 0.
      //   2. Span between inception and expiry for single-trip rows
      //      (this is the actual trip length).
      //   3. The canonical Brit/Abbeygate annual cap of 31 for annual-
      //      multi-trip OR as the final safe-default fallback.
      // Pre-fix this was undefined for rows where 'Type of Cover' did
      // not contain the literal word 'multi' AND 'Number of Days' was
      // blank, causing ~1,300 travel rows to fail CALCULABILITY with
      // "Multi-trip travel quote requires `quote.maxTripDays`". The
      // canonical validator's planType-inference can flag a row as
      // multi-trip on signals other than the cover-type string, so we
      // ALWAYS produce a positive integer.
      maxTripDays: (() => {
        const explicit = asNumber(r['Number of Days']);
        if (explicit && explicit > 0) return explicit;
        const start = inceptionDate ? new Date(inceptionDate) : null;
        const end = expiryDate ? new Date(expiryDate) : null;
        if (start && end && !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
          const startUtc = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
          const endUtc = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
          const span = Math.floor((endUtc - startUtc) / 86_400_000) + 1;
          if (span > 0 && span <= 366) return span;
        }
        return 31;
      })(),
    },
    addons: {
      winterSports: yn(r['Winter Sports Cover']),
      businessCover: yn(r['Business Cover']),
      golfCover: yn(r['Golf Cover']),
      terrorism: yn(r['Terrorism Cover']),
      sportsEquipment: yn(r['Sports Equipment Cover']),
      wedding: yn(r['Wedding Cover']),
      gadget: yn(r['Gadget Cover']),
    },
    proposer: {
      firstName: firstName || 'Imported',
      lastName: lastName || 'Traveller',
      email: importProposerEmail(r, policyRef, sourceRowNumber),
      phone: defaults?.defaultPhone || '',
      // BDX-imported policies were never asked for active consent; the
      // canonical travel schema requires the boolean, default it to false
      // so we preserve the import as a non-marketing consent record.
      marketingConsent: false,
      address: {
        line1: addressLine1,
        city: addressCity,
        country,
        postcode,
      },
    },
    declarations: {
      medicalNotice: true,
      howToClaimReview: true,
      personalDataConsent: true,
      contractConsent: true,
      contractAgreement: true,
    },
  };

  return buildCommonDto({
    row,
    sourceRowNumber,
    productLine: 'travel',
    productType: 'TRAVEL',
    sourceId,
    policyRef,
    entry: canonicalEntry(pick(r, travelLloydsV52MappingSpec.policyFields.entry)),
    insured: `${firstName} ${lastName}`.trim() || policyRef,
    inceptionDate,
    expiryDate,
    bookedDate: asDateString(pick(r, travelLloydsV52MappingSpec.dateFields.booked)),
    gross,
    commission,
    tax,
    fees,
    net,
    total: gross + tax + fees,
    postcode: asString(pick(r, travelLloydsV52MappingSpec.insuredFields.postcode)),
    cover: asString(r['Level of Cover']) || 'Travel',
    excess: asNumber(r['Deductible or Excess Amount']),
    productData,
  });
}

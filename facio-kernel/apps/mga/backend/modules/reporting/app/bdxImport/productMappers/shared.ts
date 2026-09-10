import type { BdxProductLine, BdxRawRow, BdxRowDto, BdxSystemProductType } from '../types.js';

export type LloydsV52MappingSpec = {
  productLine: BdxProductLine;
  productType: BdxSystemProductType;
  policyFields: Record<string, string[]>;
  insuredFields: Record<string, string[]>;
  coverFields: Record<string, string[]>;
  premiumFields: Record<string, string[]>;
  dateFields: Record<string, string[]>;
  riskFields: Record<string, string[]>;
};

export type UnknownRecord = Record<string, unknown>;

export function asRecord(v: unknown): UnknownRecord {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as UnknownRecord) : {};
}

export function asString(v: unknown): string {
  return v === null || v === undefined ? '' : String(v).trim();
}

export function asNumber(v: unknown): number | null {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const parsed = Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDateParts(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function asDateString(v: unknown): string {
  if (!v) return '';
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().split('T')[0] || '';
  const raw = String(v).trim();
  const dayFirst = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dayFirst) {
    const day = Number(dayFirst[1]);
    const month = Number(dayFirst[2]);
    const year = Number(dayFirst[3]);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (
      parsed.getUTCFullYear() === year
      && parsed.getUTCMonth() === month - 1
      && parsed.getUTCDate() === day
    ) {
      return formatDateParts(year, month, day);
    }
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().split('T')[0] || '';
}

export function pick(row: UnknownRecord, aliases: string[]): unknown {
  for (const alias of aliases) {
    if (row[alias] !== undefined && row[alias] !== null && String(row[alias]).trim() !== '') return row[alias];
  }
  return null;
}

export function yn(value: unknown): boolean {
  const normalized = asString(value).toLowerCase();
  return normalized === 'y' || normalized === 'yes' || normalized === 'true' || normalized === '1';
}

/**
 * Per-row synthetic proposer email for BDX-imported policies.
 *
 * MUST be unique per certificate ref. A shared placeholder
 * (`bdx-import@import.local`) is what collapsed ~8,900 imported policies onto
 * two policy holders via email-based account dedupe in the 2026-07-30
 * incident (ADR-0056). Account materialization additionally refuses to match
 * holders on any `@import.local` address — this helper is the belt, that is
 * the braces.
 */
export function importPlaceholderEmail(policyRef: string, sourceRowNumber: number): string {
  const local = String(policyRef || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || `bdx${sourceRowNumber}`;
  return `${local}@import.local`;
}

/** Preserve explicitly supplied contact data for canonical product validation. */
export function importProposerEmail(row: UnknownRecord, policyRef: string, sourceRowNumber: number): unknown {
  const productData = asRecord(row.productData);
  const candidates = [
    asRecord(productData.proposer).email,
    asRecord(row.proposer).email,
    row['proposer.email'],
    productData.email,
    row.email,
    row.Email,
    row.eMail,
  ].filter((value) => value !== undefined && value !== null && !(typeof value === 'string' && value.trim() === ''));
  if (candidates.length === 0) return importPlaceholderEmail(policyRef, sourceRowNumber);

  // Match customer account materialization's trim/lowercase normalization;
  // preserve plus tags, punctuation and non-string values. Coercing an array
  // or object to a string could turn malformed input into a customer identity.
  const distinct = [...new Set(candidates.map((value) => typeof value === 'string' ? value.trim().toLowerCase() : value))];
  // Conflicting supplied identities stay invalid for the existing canonical
  // proposer.email rule, which produces a Critical import gap. Never choose a
  // recipient by alias precedence. The evaluator retains the original rawRow.
  return distinct.length === 1 ? distinct[0] : distinct;
}

export function canonicalEntry(value: unknown): string {
  const raw = asString(value).toUpperCase();
  if (raw === 'CANCELLED') return 'CAN';
  if (raw === 'CANC') return 'CAN';
  if (raw === 'CANCEL') return 'CAN';
  if (raw === 'NEW BUSINESS') return 'NB';
  if (raw === 'RENEWAL') return 'RNL';
  return raw || 'NB';
}

export function buildCommonDto(args: {
  row: BdxRawRow;
  sourceRowNumber: number;
  productLine: BdxProductLine;
  productType: BdxSystemProductType;
  sourceId: string;
  policyRef: string;
  entry: string;
  insured: string;
  inceptionDate: string;
  expiryDate: string;
  bookedDate: string;
  gross: number;
  commission: number;
  tax: number;
  fees: number;
  net: number;
  total: number;
  postcode?: string;
  cover?: string;
  excess?: number | null;
  productData?: Record<string, unknown>;
}): BdxRowDto {
  const r = asRecord(args.row);
  const sourceSheetName = asString(r.__sheetName) || 'Sheet1';
  const sourceFile = asString(r.__sourceFile);
  const sourceMonth = asString(r.__sourceMonth);
  const tenantSite = asString(r.__tenantSite);
  const rowKey = `${sourceSheetName}::${args.policyRef}::${args.sourceId}::${args.sourceRowNumber}`;
  return {
    ...(sourceFile ? { sourceFile } : {}),
    sourceSheetName,
    ...(sourceMonth ? { sourceMonth } : {}),
    sourceRowNumber: args.sourceRowNumber,
    productLine: args.productLine,
    productType: args.productType,
    ...(tenantSite ? { tenantSite } : {}),
    sourceId: args.sourceId,
    policyRef: args.policyRef,
    rowKey,
    termKey: '',
    policyChainKey: '',
    entry: args.entry,
    insured: args.insured,
    nif: '',
    endorsementRaw: '',
    bookedDate: args.bookedDate,
    inceptionDate: args.inceptionDate,
    expiryDate: args.expiryDate,
    dateOfBirth: '',
    occupation: '',
    postcode: args.postcode || '',
    make: '',
    model: '',
    engineSize: null,
    ncbYears: null,
    claimProtection: '',
    vehicleValue: null,
    vehicleYear: null,
    registration: '',
    cover: args.cover || '',
    excess: args.excess ?? null,
    drivers: '',
    use: '',
    premiumPayable: args.total,
    grossPremium: args.gross,
    mifPayable: args.tax,
    stampPayable: 0,
    commission: args.commission,
    payableToArb: args.net,
    note: '',
    details: '',
    ...(args.productData ? { productData: args.productData } : {}),
    declared: {
      gross: args.gross,
      commission: args.commission,
      tax: args.tax,
      fees: args.fees,
      net: args.net,
      total: args.total,
    },
    parsedEndorsements: [],
  };
}

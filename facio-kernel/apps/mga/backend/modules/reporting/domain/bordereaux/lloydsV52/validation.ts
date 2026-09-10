// Lloyd's CRS v5.2 row validators. Three layers, applied in order:
//
//   1. Structure   — mandatory CR fields are present.
//   2. Applicability — conditional CR fields driven by the per-binder
//                      applicability profile (see `crsApplicabilityPolicy.ts`).
//   3. Semantic    — cross-field arithmetic and lifecycle invariants
//                    (e.g. CR0031 Risk Expiry >= CR0030 Risk Inception).
//
// The `validateLloydsV52Rows` entry point composes all three for a
// stream + product. `validateLloydsV52RowsOrThrow` is the export gate
// used by the BDX worker and the bordereaux router.

import {
  evaluateApplicability,
  getDefaultApplicabilityProfile,
  type ApplicabilityProfile,
} from '../../crsApplicabilityPolicy.js';
import type { CsrColumnSpec, CsrStream } from '../../crsV52Motor.js';
import { getColumnsForStream } from './columns.js';
import { asDateEpoch, asNumber, isEmptyValue } from './internal/helpers.js';
import type {
  BordereauxStream,
  LloydsValidationIssue,
  LloydsV52ValidationResult,
} from './types.js';

type UnknownRecord = Record<string, unknown>;

function severityBucket(result: LloydsV52ValidationResult, issue: LloydsValidationIssue) {
  if (issue.severity === 'error') result.errors.push(issue);
  else if (issue.severity === 'warning') result.warnings.push(issue);
  else result.infos.push(issue);
}

function validateStructure<RowCtx>(
  cols: Array<CsrColumnSpec<RowCtx>>,
  row: UnknownRecord,
  rowIndex: number,
  result: LloydsV52ValidationResult,
) {
  for (const col of cols) {
    const mandatory = (typeof col.required === 'boolean')
      ? col.required
      : col.requiredness === 'mandatory';
    if (!mandatory) continue;
    if (!isEmptyValue(row[col.title])) continue;
    severityBucket(result, {
      row: rowIndex,
      category: 'STRUCTURE',
      code: 'STRUCTURE_MISSING_REQUIRED_CR',
      severity: col.validationSeverity || 'error',
      field: col.title,
      crCode: col.crCode,
      message: `Missing required field ${col.title}`,
      sourcePath: col.sourcePath,
    });
  }
}

function validateApplicability<RowCtx>(
  stream: BordereauxStream,
  cols: Array<CsrColumnSpec<RowCtx>>,
  row: UnknownRecord,
  rowIndex: number,
  profile: ApplicabilityProfile,
  result: LloydsV52ValidationResult,
) {
  for (const col of cols) {
    if (!col.applicabilityKey) continue;
    const applicability = evaluateApplicability({
      stream: stream as CsrStream,
      applicabilityKey: col.applicabilityKey,
      profile,
    });
    const value = row[col.title];
    if (applicability.applicable && isEmptyValue(value)) {
      severityBucket(result, {
        row: rowIndex,
        category: 'APPLICABILITY',
        code: 'APPLICABILITY_CONDITIONAL_CR_MISSING',
        severity: applicability.severity,
        field: col.title,
        crCode: col.crCode,
        message: applicability.reason || `Conditional field ${col.title} is required by applicability profile.`,
        sourcePath: col.sourcePath,
      });
    }
    if (!applicability.applicable && !isEmptyValue(value)) {
      severityBucket(result, {
        row: rowIndex,
        category: 'APPLICABILITY',
        code: 'APPLICABILITY_FIELD_PRESENT_WHEN_NA',
        severity: 'info',
        field: col.title,
        crCode: col.crCode,
        message: `Field ${col.title} was supplied while policy marks it not applicable.`,
        sourcePath: col.sourcePath,
      });
    }
  }
}

function validateSemantics(
  stream: BordereauxStream,
  row: UnknownRecord,
  rowIndex: number,
  result: LloydsV52ValidationResult,
) {
  if (stream === 'risk') {
    const inceptionTs = asDateEpoch(row['CR0030 Risk Inception Date']);
    const expiryTs = asDateEpoch(row['CR0031 Risk Expiry Date']);
    if (inceptionTs !== null && expiryTs !== null && expiryTs < inceptionTs) {
      severityBucket(result, {
        row: rowIndex,
        category: 'SEMANTIC',
        code: 'SEMANTIC_RISK_EXPIRY_BEFORE_INCEPTION',
        severity: 'error',
        field: 'CR0031 Risk Expiry Date',
        crCode: 'CR0031',
        message: 'CR0031 Risk Expiry Date cannot be earlier than CR0030 Risk Inception Date.',
      });
    }
  }

  if (stream === 'premium') {
    const gross = asNumber(row['CR0059 Gross Premium Paid This Time']);
    const grossWritten = asNumber(row['CR0021 Total Gross Written Premium']);
    const riskTxType = String(row['CR0022 Risk Transaction Type'] || '').trim();
    const premiumTxType = String(row['CR0056 Premium Transaction Type'] || '').trim();
    const commissionPct = asNumber(row['CR0061 Commission Percentage']);
    const comm = asNumber(row['CR0062 Commission Amount']) ?? 0;
    const taxes = asNumber(row['CR0064 Total Taxes and Levies']) ?? 0;
    const fees = asNumber(row['CR0925 Total Fee Amount']) ?? 0;
    const net = asNumber(row['CR0065 Net Premium to London (Original Currency)']);
    const fx = asNumber(row['CR0067 Rate of Exchange']) ?? 1;
    const netSettlement = asNumber(row['CR0068 Net Premium to London (Settlement Currency)']);
    const platform = String(row['CR1297 Lloyds Platform'] || '').trim();
    const effectiveTs = asDateEpoch(row['CR0057 Effective Date of Transaction']);
    const inceptionTs = asDateEpoch(row['CR0030 Risk Inception Date']);
    const tax1Territory = String(row['CR0077 Tax 1 Territory'] || '').trim();
    const tax1Type = String(row['CR0078 Tax 1 Type'] || '').trim();
    const tax1Taxable = asNumber(row['CR0079 Tax 1 Taxable Amount']);
    const tax1RateRaw = String(row['CR0080 Tax 1 Rate'] || '').trim();
    const tax1FixedRate = asNumber(row['CR0081 Tax 1 Fixed Rate']);
    const tax1Amount = asNumber(row['CR0083 Tax 1 Amount']);

    if (grossWritten === null) {
      severityBucket(result, {
        row: rowIndex,
        category: 'SEMANTIC',
        code: 'SEMANTIC_TOTAL_GROSS_WRITTEN_MISSING',
        severity: 'error',
        field: 'CR0021 Total Gross Written Premium',
        crCode: 'CR0021',
        message: 'CR0021 Total Gross Written Premium is required for premium stream context.',
      });
    }

    const allowedRiskCategories = ['New Business', 'Renewal', 'Adjustment', 'Cancellation'];
    if (!allowedRiskCategories.includes(riskTxType)) {
      severityBucket(result, {
        row: rowIndex,
        category: 'SEMANTIC',
        code: 'SEMANTIC_RISK_TRANSACTION_TYPE_UNMAPPED',
        severity: 'error',
        field: 'CR0022 Risk Transaction Type',
        crCode: 'CR0022',
        message: `CR0022 must be one of ${allowedRiskCategories.join(', ')} (received '${riskTxType || 'EMPTY'}').`,
      });
    }

    const allowedPremiumTypes = ['Original Premium', 'Additional Premium', 'Return Premium'];
    if (!allowedPremiumTypes.includes(premiumTxType)) {
      severityBucket(result, {
        row: rowIndex,
        category: 'SEMANTIC',
        code: 'SEMANTIC_PREMIUM_TRANSACTION_TYPE_UNMAPPED',
        severity: 'error',
        field: 'CR0056 Premium Transaction Type',
        crCode: 'CR0056',
        message: `CR0056 must be one of ${allowedPremiumTypes.join(', ')} (received '${premiumTxType || 'EMPTY'}').`,
      });
    }

    if (!platform) {
      severityBucket(result, {
        row: rowIndex,
        category: 'SEMANTIC',
        code: 'SEMANTIC_PLATFORM_MISSING',
        severity: 'error',
        field: 'CR1297 Lloyds Platform',
        crCode: 'CR1297',
        message: 'CR1297 Lloyds Platform must be populated for premium exports.',
      });
    }

    if (
      riskTxType === 'New Business'
      && premiumTxType === 'Original Premium'
      && effectiveTs !== null
      && inceptionTs !== null
      && effectiveTs < inceptionTs
    ) {
      severityBucket(result, {
        row: rowIndex,
        category: 'SEMANTIC',
        code: 'NB_EFFECTIVE_BEFORE_INCEPTION',
        severity: 'error',
        field: 'CR0057 Effective Date of Transaction',
        crCode: 'CR0057',
        message: 'New Business / Original Premium row cannot have CR0057 earlier than CR0030 unless explicitly approved.',
      });
    }

    if (gross !== null && gross !== 0 && commissionPct === null) {
      severityBucket(result, {
        row: rowIndex,
        category: 'SEMANTIC',
        code: 'SEMANTIC_COMMISSION_PERCENT_REQUIRED',
        severity: 'error',
        field: 'CR0061 Commission Percentage',
        crCode: 'CR0061',
        message: 'CR0061 is required when CR0059 is non-zero.',
      });
    }

    if (gross !== null && commissionPct !== null) {
      const expectedComm = Math.round((gross * (commissionPct / 100)) * 100) / 100;
      const actualComm = Math.round(comm * 100) / 100;
      if (expectedComm !== actualComm) {
        severityBucket(result, {
          row: rowIndex,
          category: 'SEMANTIC',
          code: 'SEMANTIC_COMMISSION_AMOUNT_MISMATCH',
          severity: 'error',
          field: 'CR0062 Commission Amount',
          crCode: 'CR0062',
          message: `Expected commission amount ${expectedComm} from CR0059 x CR0061 but received ${actualComm}.`,
        });
      }
    }

    if (gross !== null && net !== null) {
      const expected = Math.round((gross - comm) * 100) / 100;
      const actual = Math.round(net * 100) / 100;
      if (expected !== actual) {
        severityBucket(result, {
          row: rowIndex,
          category: 'SEMANTIC',
          code: 'SEMANTIC_NET_PREMIUM_MISMATCH',
          severity: 'warning',
          field: 'CR0065 Net Premium to London (Original Currency)',
          crCode: 'CR0065',
          message: `Expected net ${expected} from CR0059 - CR0062 but received ${actual}.`,
        });
      }
    }

    if (net !== null && netSettlement !== null) {
      const expected = Math.round((net * fx) * 100) / 100;
      const actual = Math.round(netSettlement * 100) / 100;
      if (expected !== actual) {
        severityBucket(result, {
          row: rowIndex,
          category: 'SEMANTIC',
          code: 'SEMANTIC_SETTLEMENT_NET_MISMATCH',
          severity: 'error',
          field: 'CR0068 Net Premium to London (Settlement Currency)',
          crCode: 'CR0068',
          message: `Expected settlement net ${expected} from CR0065 x CR0067 but received ${actual}.`,
        });
      }
    }

    const issuanceCategory = riskTxType === 'New Business' || riskTxType === 'Renewal';
    if (issuanceCategory && (gross ?? 0) !== 0 && taxes === 0 && fees === 0) {
      severityBucket(result, {
        row: rowIndex,
        category: 'SEMANTIC',
        code: 'SEMANTIC_ISSUANCE_CHARGES_MISSING',
        severity: 'warning',
        field: 'CR0064 Total Taxes and Levies / CR0925 Total Fee Amount',
        message: 'Issuance-like row has no fee/tax charges. Verify billing movement for CR0064/CR0925.',
      });
    }

    const adjustmentOrCancellation = riskTxType === 'Adjustment' || riskTxType === 'Cancellation';
    if (adjustmentOrCancellation && (gross ?? 0) === 0 && (taxes !== 0 || fees !== 0)) {
      severityBucket(result, {
        row: rowIndex,
        category: 'SEMANTIC',
        code: 'SEMANTIC_ZERO_MOVEMENT_CHARGES_PRESENT',
        severity: 'warning',
        field: 'CR0064 Total Taxes and Levies / CR0925 Total Fee Amount',
        message: 'Zero-premium adjustment/cancellation row carries fee/tax amounts; verify billed transaction truth.',
      });
    }

    if (taxes > 0) {
      if (!tax1Territory || !tax1Type || tax1Taxable === null || tax1Amount === null) {
        severityBucket(result, {
          row: rowIndex,
          category: 'SEMANTIC',
          code: 'SEMANTIC_TAX_DETAIL_MISSING',
          severity: 'warning',
          field: 'CR0077/CR0078/CR0079/CR0083',
          message: 'Tax detail fields must be populated when CR0064 is greater than zero.',
        });
      } else {
        const taxSummary = Math.round(taxes * 100) / 100;
        const taxDetailAmount = Math.round(tax1Amount * 100) / 100;
        if (taxSummary !== taxDetailAmount) {
          severityBucket(result, {
            row: rowIndex,
            category: 'SEMANTIC',
            code: 'SEMANTIC_TAX_DETAIL_SUMMARY_MISMATCH',
            severity: 'warning',
            field: 'CR0083 Tax 1 Amount',
            crCode: 'CR0083',
            message: `CR0083 (${taxDetailAmount}) must reconcile to CR0064 (${taxSummary}).`,
          });
        }
      }
      if (!tax1RateRaw && tax1FixedRate !== null) {
        severityBucket(result, {
          row: rowIndex,
          category: 'SEMANTIC',
          code: 'FIXED_TAX_NO_RATE',
          severity: 'info',
          field: 'CR0081 Tax 1 Fixed Rate',
          crCode: 'CR0081',
          message: 'CR0080 is blank because this tax is fixed-amount; CR0081 carries the fixed rate.',
        });
      }
    }
  }

  if (stream === 'claims') {
    const total = asNumber(row['CR0155 Total Incurred']);
    const ind = asNumber(row['CR0134 Total Incurred Indemnity']);
    const fees = asNumber(row['CR0135 Total Incurred Fees']);
    if (total !== null && ind !== null && fees !== null) {
      const expected = Math.round((ind + fees) * 100) / 100;
      const actual = Math.round(total * 100) / 100;
      if (expected !== actual) {
        severityBucket(result, {
          row: rowIndex,
          category: 'SEMANTIC',
          code: 'SEMANTIC_CLAIMS_TOTAL_INCURRED_MISMATCH',
          severity: 'warning',
          field: 'CR0155 Total Incurred',
          crCode: 'CR0155',
          message: `Expected total incurred ${expected} but received ${actual}.`,
        });
      }
    }
  }
}

export function validateLloydsV52Rows(
  stream: BordereauxStream,
  rows: UnknownRecord[],
  profile: ApplicabilityProfile = getDefaultApplicabilityProfile(),
  productType = 'MOTOR',
): LloydsV52ValidationResult {
  const result: LloydsV52ValidationResult = { errors: [], warnings: [], infos: [] };
  if (!rows.length) return result;
  const cols = getColumnsForStream(stream, productType);

  rows.forEach((row, idx) => {
    const rowIndex = idx + 1;
    validateStructure(cols as Array<CsrColumnSpec<unknown>>, row, rowIndex, result);
    validateApplicability(stream, cols as Array<CsrColumnSpec<unknown>>, row, rowIndex, profile, result);
    validateSemantics(stream, row, rowIndex, result);
  });
  return result;
}

/**
 * Lloyd's monthly reporting lane (user-operated):
 * validates CRS v5.2 export rows before delivery.
 */
export function validateLloydsV52RowsOrThrow(
  stream: BordereauxStream,
  rows: UnknownRecord[],
  profile: ApplicabilityProfile = getDefaultApplicabilityProfile(),
  productType = 'MOTOR',
) {
  const validation = validateLloydsV52Rows(stream, rows, profile, productType);
  if (validation.errors.length === 0) return;
  const err = new Error('Lloyd’s CRS v5.2 validation failed') as Error & { code?: string; details?: unknown };
  err.code = 'CRS_VALIDATION_FAILED';
  err.details = validation;
  throw err;
}

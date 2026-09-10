// Pre-canonical-CRS row builders. The CRS V5.2 column tables in
// `../crsV52{Motor,Home,Travel}.ts` superseded these; they remain
// here unreferenced outside this folder and are flagged as a Phase 4
// (dead-code drain) removal candidate by the errors-and-warnings cleanup.
//
// They stay re-exported from `../lloydsV52.ts` only to preserve the
// public surface shape during the split — once Phase 4 confirms zero
// downstream consumers, this entire file can be deleted.

import { parseRecord } from '../../../../../platform/json/parseRecord.js';
import { asRecord, toISODate } from './internal/helpers.js';

type UnknownRecord = Record<string, unknown>;

export function buildRiskRowV52(input: {
  policy: UnknownRecord;
  policyHolder: UnknownRecord;
  binder?: UnknownRecord;
  riskTransaction?: UnknownRecord;
}) {
  const { policy, policyHolder, binder, riskTransaction } = input;
  const quoteData = parseRecord(policy.quoteData);
  const quoteResponse = parseRecord(policy.quoteResponse);
  // Pre-`spine/v2` Wave 5 the row builder fell back to
  // `policy.vehicleInfo.X` when `quoteData.X` was missing. That column
  // is a legacy projection of the vehicle subset of `quoteData` and
  // `quoteData` is now the canonical source (see ADR-0007 +
  // canonical-ownership.md). Reading both is drift surface — if
  // `quoteData` is empty on a legacy policy, the BDX cell is empty and
  // the operator fixes the source data.

  return {
    'UMR': policy.umr || policy.policyNumber || '',
    'Policy Number': policy.policyNumber || '',
    'Binder UMR': binder?.umr || '',
    'Agreement Number': binder?.agreementNumber || '',
    'Insured Name': policyHolder?.name || '',
    'Inception Date': toISODate(String(policy.inceptionDate || '')),
    'Expiry Date': toISODate(String(policy.expiryDate || '')),
    'Transaction Type': riskTransaction?.transactionType || 'INCEPTION',
    'Country of Registration': quoteData.countryOfRegistration || '',
    'Vehicle Type': quoteData.vehicleType || '',
    'Cover Type': quoteData.coverRequired || '',
    'Vehicle Make': quoteData.make || '',
    'Vehicle Model': quoteData.model || '',
    'Vehicle Year': quoteData.year || '',
    'Engine Size': quoteData.engineSize || '',
    'Vehicle Value': quoteData.vehicleValue || '',
    'NCD': quoteData.ncb || '',
    'Excess Required': quoteData.requiredExcess || asRecord(quoteResponse?.primaryOption).totalExcess || '',
    'Gross Written Premium': asRecord(quoteResponse?.primaryOption).annualPremium ?? '',
    'Currency': quoteResponse?.currency || binder?.defaultCurrency || 'EUR',
  };
}

export function buildPremiumRowV52(input: {
  policy: UnknownRecord;
  policyHolder: UnknownRecord;
  binder?: UnknownRecord;
  premiumTransaction?: UnknownRecord;
  riskTransaction?: UnknownRecord;
}) {
  const { policy, policyHolder, binder, premiumTransaction, riskTransaction } = input;
  const quoteResponse = parseRecord(policy.quoteResponse);
  const currency = premiumTransaction?.currency || quoteResponse?.currency || binder?.defaultCurrency || 'EUR';

  const taxLines = Array.isArray(premiumTransaction?.taxLines) ? (premiumTransaction.taxLines as UnknownRecord[]) : [];
  const taxCols: Record<string, unknown> = {};
  for (let i = 0; i < Math.min(taxLines.length, 5); i++) {
    taxCols[`Tax ${i + 1} Type`] = taxLines[i]?.taxType || '';
    taxCols[`Tax ${i + 1} Amount`] = taxLines[i]?.taxAmount ?? '';
    taxCols[`Tax ${i + 1} Rate`] = taxLines[i]?.rate ?? '';
  }

  return {
    'UMR': policy.umr || policy.policyNumber || '',
    'Policy Number': policy.policyNumber || '',
    'Agreement Number': binder?.agreementNumber || '',
    'Insured Name': policyHolder?.name || '',
    'Inception Date': toISODate(String(policy.inceptionDate || '')),
    'Expiry Date': toISODate(String(policy.expiryDate || '')),
    'Risk Transaction Type': riskTransaction?.transactionType || 'INCEPTION',
    'Premium Transaction Type': premiumTransaction?.transactionType || 'ORIGINAL',
    'Gross Premium': premiumTransaction?.grossPremium ?? asRecord(quoteResponse?.primaryOption).annualPremium ?? '',
    'Commission %': premiumTransaction?.commissionPercent ?? '',
    'Commission Amount': premiumTransaction?.commissionAmount ?? '',
    'Taxes Total': premiumTransaction?.taxesTotal ?? '',
    'Fees Total': premiumTransaction?.feesTotal ?? '',
    'Net to London': premiumTransaction?.netToLondon ?? '',
    'Currency': currency,
    ...taxCols,
  };
}

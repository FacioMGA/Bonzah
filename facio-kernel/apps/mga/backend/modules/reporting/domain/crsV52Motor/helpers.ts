// Lloyd's CRS v5.2 — Motor row-context helpers.
//
// `toISODate` is exported because the column-spec `get` lambdas use
// it; everything else is internal to the column tables and the
// `resolvePremiumDerivedValues` calculator.

import { parseRecord } from '../../../../platform/json/parseRecord.js';
import type { CsrColumnSpec, PremiumRowCtx } from './types.js';

export function toISODate(d: unknown) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(String(d));
  if (Number.isNaN(dt.getTime())) return '';
  const day = String(dt.getUTCDate()).padStart(2, '0');
  const month = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const year = String(dt.getUTCFullYear());
  return `${day}/${month}/${year}`;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function asNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

export function firstFinite(values: Array<unknown>, fallback = 0): number {
  for (const value of values) {
    const n = asNumber(value);
    if (n !== null) return n;
  }
  return fallback;
}

export function normalizeCommissionPercent(raw: unknown, fallbackPercent = 30): number {
  const parsed = asNumber(raw);
  if (parsed === null) return fallbackPercent;
  if (parsed > 0 && parsed <= 1) return round2(parsed * 100);
  if (parsed < 0) return fallbackPercent;
  return round2(parsed);
}

export function resolveBinderCommissionPercent(ctx: PremiumRowCtx): number {
  const binder = asRecord(ctx.binder);
  const financials = asRecord(binder.financials);
  const cfg = asRecord(binder.config);
  const reporting = asRecord(cfg.reporting);
  return normalizeCommissionPercent(
    financials.commissionRate ?? reporting.commissionPercent ?? reporting.commissionRate,
    30,
  );
}

export function mapRiskTransactionTypeCode(value: unknown): string {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return '';
  if (['NB', 'NB/COC', 'RNL', 'PAM', 'ADJ', 'FIVA-PAM', 'CAN', 'NTU'].includes(raw)) return raw;
  if (raw.includes('RENEW')) return 'RNL';
  if (raw.includes('CANCEL') || raw === 'VOID') return 'CAN';
  if (raw.includes('ENDORSE') || raw === 'MTA' || raw === 'ADDITIONAL') return 'PAM';
  if (raw.includes('REINSTAT')) return 'ADJ';
  if (raw.includes('INCEPTION') || raw.includes('NEW')) return 'NB';
  return raw;
}

export function mapRiskTransactionTypeForCr0022(value: unknown): string {
  const code = mapRiskTransactionTypeCode(value);
  if (code === 'NB' || code === 'NB/COC') return 'New Business';
  if (code === 'RNL') return 'Renewal';
  if (code === 'PAM' || code === 'ADJ' || code === 'FIVA-PAM') return 'Adjustment';
  if (code === 'CAN' || code === 'NTU') return 'Cancellation';
  return code;
}

export function mapPremiumTransactionTypeForCr0056(args: {
  riskTypeCode: string;
  grossMovement: number;
  rawPremiumTransactionType: unknown;
}): 'Original Premium' | 'Additional Premium' | 'Return Premium' {
  const raw = String(args.rawPremiumTransactionType || '').trim().toUpperCase();
  if (raw === 'ORIGINAL' || raw === 'ORIGINAL PREMIUM') return 'Original Premium';
  if (raw === 'ADDITIONAL' || raw === 'ADDITIONAL PREMIUM') return 'Additional Premium';
  if (raw === 'RETURN' || raw === 'RETURN PREMIUM') return 'Return Premium';

  if (['NB', 'NB/COC', 'RNL'].includes(args.riskTypeCode)) return 'Original Premium';
  if (args.grossMovement < 0) return 'Return Premium';
  if (args.grossMovement > 0) return 'Additional Premium';
  return 'Additional Premium';
}

export function hasExplicitChargeValue(value: unknown): boolean {
  const n = asNumber(value);
  return n !== null && n !== 0;
}

export function resolvePremiumDerivedValues(ctx: PremiumRowCtx) {
  const tx = asRecord(ctx.premiumTransaction);
  const riskTx = asRecord(ctx.riskTransaction);
  const policy = asRecord(ctx.policy);
  const quoteResponse = asRecord(ctx.quoteResponse);
  const primary = asRecord(quoteResponse.primaryOption);
  const cost = asRecord(primary.costDetails);

  const pricingFinal = parseRecord(riskTx.pricingFinal);
  const pricingQr = asRecord(pricingFinal.quoteResponse);
  const pricingPrimary = asRecord(pricingQr.primaryOption);
  const pricingCost = asRecord(pricingPrimary.costDetails);

  const grossMovement = firstFinite([
    tx.grossPremium,
    cost.totalPremium,
    pricingCost.totalPremium,
    primary.annualPremium,
    pricingPrimary.annualPremium,
    cost.subtotalNetPremium,
    pricingCost.subtotalNetPremium,
  ], 0);
  const commissionPercent = firstFinite([tx.commissionPercent], resolveBinderCommissionPercent(ctx));
  const commissionAmount = firstFinite([tx.commissionAmount], round2(grossMovement * (commissionPercent / 100)));
  const riskTypeCode = mapRiskTransactionTypeCode(riskTx.transactionType);
  const premiumTransactionType = mapPremiumTransactionTypeForCr0056({
    riskTypeCode,
    grossMovement,
    rawPremiumTransactionType: tx.transactionType,
  });
  const isIssuanceLike = ['NB', 'NB/COC', 'RNL'].includes(riskTypeCode);
  const isAdjustmentOrCancel = ['PAM', 'ADJ', 'FIVA-PAM', 'CAN', 'NTU'].includes(riskTypeCode);
  const txTaxesRaw = asNumber(tx.taxesTotal);
  const txFeesRaw = asNumber(tx.feesTotal);
  const txHasNonZeroCharges = (txTaxesRaw !== null && txTaxesRaw !== 0) || (txFeesRaw !== null && txFeesRaw !== 0);
  const costHasExplicitCharges =
    hasExplicitChargeValue(cost.stampDuty) ||
    hasExplicitChargeValue(cost.policyFee) ||
    hasExplicitChargeValue(cost.mifSurcharge) ||
    hasExplicitChargeValue(pricingCost.stampDuty) ||
    hasExplicitChargeValue(pricingCost.policyFee) ||
    hasExplicitChargeValue(pricingCost.mifSurcharge);

  let stampDuty: number;
  let mifSurcharge: number;
  if (txHasNonZeroCharges) {
    stampDuty = round2(firstFinite([tx.taxesTotal], 0));
    mifSurcharge = round2(firstFinite([tx.feesTotal], 0));
  } else if (isAdjustmentOrCancel) {
    stampDuty = 0;
    mifSurcharge = 0;
  } else if (costHasExplicitCharges) {
    stampDuty = round2(firstFinite([cost.stampDuty, pricingCost.stampDuty, cost.policyFee, pricingCost.policyFee], 0));
    mifSurcharge = round2(firstFinite([cost.mifSurcharge, pricingCost.mifSurcharge], 0));
  } else if (isIssuanceLike) {
    stampDuty = 2;
    mifSurcharge = 9;
  } else {
    stampDuty = 0;
    mifSurcharge = 0;
  }
  const netToLondon = firstFinite([tx.netToLondon], round2(grossMovement - commissionAmount));

  const totalGrossWritten = firstFinite([
    pricingFinal.premium,
    pricingPrimary.annualPremium,
    pricingCost.subtotalNetPremium,
    primary.annualPremium,
    grossMovement,
  ], grossMovement);

  const quoteData = parseRecord(policy.quoteData);
  const instalmentsRaw = firstFinite([quoteData.numberOfInstalments, quoteData.installments, quoteData.instalments], 1);
  const instalments = Math.max(1, Math.round(instalmentsRaw));
  const instalmentBasis = instalments > 1 ? 'Instalment' : 'Single';

  // Certificate reference rule:
  // premium movements (including adjustments) reuse the policy-level certificate reference
  // unless a future endorsed-schedule identifier is explicitly modeled and mapped.
  const certificateRef = String(
    policy.certificateNumber ||
    policy.certificateReference ||
    asRecord(policy.documents).certificateReference ||
    '',
  ).trim();

  // `spine/v2` Wave 5: deleted the `ABBEYGATE0125 → LBS` hard-coded
  // binder fallback. The reporting platform is read from the binder's
  // own `reportingConfig` / `config.reporting` only; an unconfigured
  // binder produces an empty platform value (and downstream V52
  // validation fails loud) instead of being silently labelled `LBS`
  // because of its agreement number.
  const lloydsPlatform = String(
    asRecord(asRecord(ctx.binder).reportingConfig).destinationPlatform ||
    asRecord(asRecord(asRecord(ctx.binder).config).reporting).lloydsPlatform ||
    asRecord(asRecord(asRecord(ctx.binder).config).reporting).platform ||
    '',
  ).trim();

  const fxRate = firstFinite([tx.fxRate, tx.exchangeRate], 1);
  const netToLondonSettlement = firstFinite([tx.netToLondonSettlement], round2(netToLondon * fxRate));

  const taxLineOne = Array.isArray(tx.taxLines)
    ? asRecord((tx.taxLines as unknown[])[0])
    : {};
  // `spine/v2` Wave 5: deleted the `'CYPRUS'` hard-coded territory
  // fallback. The Lloyd's V52 tax territory comes from the canonical
  // policy/quote source path; if all three sources are blank we now
  // emit an empty string and let `validateLloydsV52RowsOrThrow` catch
  // it instead of silently labelling every untagged row as Cyprus.
  const taxTerritoryFallback = String(
    quoteData.countryOfRegistration ||
    policy.insuredCountry ||
    asRecord(asRecord(asRecord(ctx.binder).config).reporting).territory ||
    '',
  ).trim().toUpperCase();
  const taxDetail = stampDuty > 0
    ? {
      territory: String(taxLineOne.jurisdiction || taxTerritoryFallback).trim().toUpperCase(),
      type: String(taxLineOne.taxType || 'STAMP DUTY').trim().toUpperCase(),
      taxableAmount: asNumber(taxLineOne.taxableAmount) ?? round2(grossMovement),
      rate: '',
      fixedRate: asNumber(taxLineOne.fixedRate) ?? round2(stampDuty),
      amount: asNumber(taxLineOne.taxAmount) ?? round2(stampDuty),
    }
    : {
      territory: '',
      type: '',
      taxableAmount: '',
      rate: '',
      fixedRate: '',
      amount: '',
    };

  return {
    grossMovement: round2(grossMovement),
    commissionPercent: round2(commissionPercent),
    commissionAmount: round2(commissionAmount),
    stampDuty: round2(stampDuty),
    mifSurcharge: round2(mifSurcharge),
    premiumTransactionType,
    netToLondon: round2(netToLondon),
    totalGrossWritten: round2(totalGrossWritten),
    instalments,
    instalmentBasis,
    certificateRef,
    lloydsPlatform,
    fxRate: round2(fxRate),
    netToLondonSettlement: round2(netToLondonSettlement),
    taxLineOne: {
      ...taxLineOne,
      jurisdiction: taxDetail.territory,
      taxType: taxDetail.type,
      taxableAmount: taxDetail.taxableAmount,
      rate: taxDetail.rate,
      fixedRate: taxDetail.fixedRate,
      taxAmount: taxDetail.amount,
    },
  };
}

export function isMandatory(col: Pick<CsrColumnSpec<unknown>, 'required' | 'requiredness'>): boolean {
  if (typeof col.required === 'boolean') return col.required;
  return col.requiredness === 'mandatory';
}

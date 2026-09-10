type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : {};
}

function asNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function firstFinite(values: Array<unknown>, fallback = 0): number {
  for (const value of values) {
    const n = asNumber(value);
    if (n !== null) return n;
  }
  return fallback;
}

function hasExplicitCharge(cost: UnknownRecord): boolean {
  return asNumber(cost.mifSurcharge) !== null
    || asNumber(cost.stampDuty) !== null
    || asNumber(cost.policyFee) !== null;
}

function classifyRiskTransactionCode(value: unknown): string {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return '';
  if (['NB', 'NB/COC', 'RNL', 'PAM', 'ADJ', 'FIVA-PAM', 'CAN', 'NTU'].includes(raw)) return raw;
  if (raw.includes('RENEW')) return 'RNL';
  if (raw.includes('CANCEL') || raw.includes('VOID') || raw === 'CANCELLATION') return 'CAN';
  if (raw.includes('ENDORSE') || raw.includes('MTA') || raw.includes('ADJUST')) return 'PAM';
  if (raw.includes('INCEPTION') || raw.includes('NEW')) return 'NB';
  return raw;
}

function hasIssuanceDefaultCharges(args: { riskTransactionType?: unknown; premiumTransactionType?: unknown }): boolean {
  const riskTxCode = classifyRiskTransactionCode(args.riskTransactionType);
  const premiumTxType = String(args.premiumTransactionType || '').trim().toUpperCase();
  if (['NB', 'NB/COC', 'RNL'].includes(riskTxCode)) return true;
  // Keep ORIGINAL as issuance-like only when risk type is missing.
  if (!riskTxCode && premiumTxType === 'ORIGINAL') return true;
  return false;
}

function normalizeCommissionPercent(raw: unknown, fallback = 30): number {
  const n = asNumber(raw);
  if (n === null) return fallback;
  if (n > 0 && n <= 1) return round2(n * 100);
  if (n < 0) return fallback;
  return round2(n);
}

export function resolveCommissionPercent(args: {
  binder?: unknown;
  binderFinancials?: unknown;
  fallbackPercent?: number;
}): number {
  const fallbackPercent = Number.isFinite(Number(args.fallbackPercent)) ? Number(args.fallbackPercent) : 30;
  const binder = asRecord(args.binder);
  const financials = asRecord(args.binderFinancials);
  const cfg = asRecord(binder.config);
  const reporting = asRecord(cfg.reporting);

  return normalizeCommissionPercent(
    financials.commissionRate ?? reporting.commissionPercent ?? reporting.commissionRate,
    fallbackPercent
  );
}

export function derivePremiumFinancials(args: {
  grossPremium: number;
  quoteResponse?: unknown;
  binder?: unknown;
  binderFinancials?: unknown;
  riskTransactionType?: unknown;
  premiumTransactionType?: unknown;
  fallbackMifSurcharge?: number;
  fallbackStampDuty?: number;
}): {
  grossPremium: number;
  commissionPercent: number;
  commissionAmount: number;
  taxesTotal: number;
  feesTotal: number;
  netToLondon: number;
} {
  const grossPremium = round2(Number(args.grossPremium || 0));
  const quoteResponse = asRecord(args.quoteResponse);
  const primary = asRecord(quoteResponse.primaryOption);
  const cost = asRecord(primary.costDetails);
  const fallbackMifSurcharge = Number.isFinite(Number(args.fallbackMifSurcharge)) ? Number(args.fallbackMifSurcharge) : 9;
  const fallbackStampDuty = Number.isFinite(Number(args.fallbackStampDuty)) ? Number(args.fallbackStampDuty) : 2;

  const commissionPercent = resolveCommissionPercent({
    binder: args.binder,
    binderFinancials: args.binderFinancials,
    fallbackPercent: 30,
  });
  const commissionAmount = round2(grossPremium * (commissionPercent / 100));
  const issuanceDefaultsApply = hasIssuanceDefaultCharges({
    riskTransactionType: args.riskTransactionType,
    premiumTransactionType: args.premiumTransactionType,
  });
  const explicitCharges = hasExplicitCharge(cost);
  const taxesTotal = round2(
    explicitCharges
      ? firstFinite([cost.stampDuty, cost.policyFee], 0)
      : issuanceDefaultsApply ? fallbackStampDuty : 0
  );
  const feesTotal = round2(
    explicitCharges
      ? firstFinite([cost.mifSurcharge], 0)
      : issuanceDefaultsApply ? fallbackMifSurcharge : 0
  );
  const netToLondon = round2(grossPremium - commissionAmount);

  return {
    grossPremium,
    commissionPercent,
    commissionAmount,
    taxesTotal,
    feesTotal,
    netToLondon,
  };
}


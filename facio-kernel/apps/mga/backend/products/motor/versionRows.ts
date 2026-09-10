import type { BuildVersionRowsArgs, VersionRow } from '../../modules/policy/domain/productContracts.js';

export function buildMotorVersionRows(args: BuildVersionRowsArgs): VersionRow[] {
  const num = (x: unknown) => { const v = Number(x); return Number.isFinite(v) ? v : 0; };
  const parseRec = (v: unknown): Record<string, unknown> =>
    v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};

  const extractPremiums = (qr: Record<string, unknown>, p: Record<string, unknown>) => {
    const primaryOption = parseRec(qr.primaryOption);
    const breakdown = parseRec(primaryOption.breakdown || qr.breakdown);
    return {
      tpl: num(breakdown.tplFinal ?? breakdown.tpl ?? 0),
      ownDamage: num(breakdown.compFinal ?? breakdown.comp ?? 0),
      currency: String(p.currency || qr.currency || 'EUR'),
    };
  };

  const currentPremiums = extractPremiums(args.quoteResponse, args.pricing);
  const previousPremiums = args.previousQuoteResponse && args.previousPricing
    ? extractPremiums(args.previousQuoteResponse, args.previousPricing)
    : { tpl: 0, ownDamage: 0, currency: currentPremiums.currency };

  const coverRequired = String(args.quoteData.coverRequired || args.versionMeta?.coverageLabel || '').trim();
  const hasOwnDamageFromQd = coverRequired ? coverRequired !== 'Third Party Liability' : null;
  const hasOwnDamageFromPremiums =
    Math.abs(currentPremiums.ownDamage) > 0.005 || Math.abs(previousPremiums.ownDamage) > 0.005;
  const hasOwnDamage = hasOwnDamageFromQd === null ? hasOwnDamageFromPremiums : hasOwnDamageFromQd;

  const tplRaw = args.isFullPremium ? currentPremiums.tpl : (currentPremiums.tpl - previousPremiums.tpl);
  const compRaw = args.isFullPremium ? currentPremiums.ownDamage : (currentPremiums.ownDamage - previousPremiums.ownDamage);
  const total = args.premiumDeltaTotal;

  const allocated = (() => {
    if (!hasOwnDamage) return { tpl: total, ownDamage: 0 };
    const base = Math.abs(tplRaw) + Math.abs(compRaw);
    if (base <= 0) {
      const tplBasis = Math.abs(currentPremiums.tpl);
      const ownBasis = Math.abs(currentPremiums.ownDamage);
      const basisTotal = tplBasis + ownBasis;
      if (basisTotal <= 0) return { tpl: total, ownDamage: 0 };
      const tplAllocated = Number((total * (tplBasis / basisTotal)).toFixed(2));
      return { tpl: tplAllocated, ownDamage: Number((total - tplAllocated).toFixed(2)) };
    }
    const tplAllocated = Number((total * (Math.abs(tplRaw) / base)).toFixed(2));
    return { tpl: tplAllocated, ownDamage: Number((total - tplAllocated).toFixed(2)) };
  })();

  const excessRaw = parseInt(String(args.quoteData.requiredExcess || '').replace(/[^0-9]/g, '') || '0', 10);
  const excessAmount = Number.isFinite(excessRaw) && excessRaw > 0 ? excessRaw : 250;
  const tplLimitText = 'BI: €38.6m / PD: €1.3m';
  const ownDamageLimitText = args.versionMeta?.insuredValueDisplay || '€250,000';
  const shouldInclude = (premium: number) => args.isFullPremium ? true : Math.abs(premium) > 0.005;

  const rows: VersionRow[] = [];
  if (args.isCancellation) {
    rows.push({ section: 'Cancellation', riskTransType: 'Cancellation', limitText: '—', excessText: '—', premium: total, currency: currentPremiums.currency });
  } else {
    if (shouldInclude(allocated.tpl)) {
      rows.push({ section: 'TPL', riskTransType: args.riskTransTypeLabel, limitText: tplLimitText, excessText: 'Nil', premium: allocated.tpl, currency: currentPremiums.currency });
    }
    if (hasOwnDamage && shouldInclude(allocated.ownDamage)) {
      rows.push({ section: 'Own Damage', riskTransType: args.riskTransTypeLabel, limitText: ownDamageLimitText, excessText: `€${excessAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, premium: allocated.ownDamage, currency: currentPremiums.currency });
    }
    if (rows.length === 0 && args.transactionType !== 'INCEPTION') {
      rows.push({ section: 'Policy Update', riskTransType: args.riskTransTypeLabel, limitText: '—', excessText: '—', premium: 0, currency: currentPremiums.currency });
    }
  }
  return rows;
}

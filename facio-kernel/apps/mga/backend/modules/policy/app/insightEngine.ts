/**
 * Dashboard Insight Engine — Pure computation, zero I/O.
 *
 * Takes pre-computed intelligence signals and applies the priority/suppression
 * scoring logic defined in the Smart Insight Strip spec to return up to 3
 * ordered, business-language insights.
 *
 * CHAMPS: this is app-layer logic — no DB access, no HTTP, no side-effects.
 */

export type InsightType     = 'CRITICAL' | 'WARNING' | 'OPPORTUNITY';
export type InsightCategory = 'UNDERWRITING' | 'SLA' | 'CONVERSION';

export type DashboardInsight = {
  type:           InsightType;
  category:       InsightCategory;
  title:          string;
  description:    string;
  actionLabel:    string;
  actionUrl:      string;
  priorityScore:  number;
  suppressionKey: string;
};

// ─── Input signal shapes ─────────────────────────────────────────────────────

type UWSignals = {
  count:          number;
  exposureEUR:    number;
  slaBreachCount: number;
};

type SLASignals = {
  invoiceOverdue: number;
  claimFnolStale: number;
  uwReferralStale: number;
};

export type ConversionSignals = {
  eurLost:      number;
  dropOffCount: number;
} | null;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (n >= 1_000_000) return `€${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `€${(n / 1_000).toFixed(0)}k`;
  return `€${Math.round(n).toLocaleString()}`;
}

function score(
  category:    InsightCategory,
  type:        InsightType,
  commercialEUR: number,
  urgency:     number,
): number {
  const base      = category === 'UNDERWRITING' ? 100 : category === 'SLA' ? 80 : 70;
  const severity  = type === 'CRITICAL' ? 40 : type === 'WARNING' ? 20 : 10;
  const commercial = commercialEUR >= 15_000 ? 20 : commercialEUR >= 5_000 ? 10 : 0;
  return base + severity + commercial + urgency;
}

// ─── Candidate generators ─────────────────────────────────────────────────────

function uwInsight(uw: UWSignals, sla: SLASignals): DashboardInsight | null {
  const triggered = uw.count >= 5 || uw.exposureEUR >= 5_000 || uw.slaBreachCount >= 1;
  if (!triggered) return null;

  const isCritical = uw.exposureEUR >= 15_000 || uw.slaBreachCount >= 3;
  const type: InsightType = isCritical ? 'CRITICAL' : 'WARNING';
  const urgency =
    (sla.uwReferralStale >= 1 ? 15 : 0) +
    (sla.invoiceOverdue  >= 5 ? 10 : 0);

  return {
    type,
    category:       'UNDERWRITING',
    title:          isCritical
      ? 'Underwriting backlog is blocking premium'
      : 'Underwriting decisions are building up',
    description:    isCritical
      ? `${uw.count} underwriting items are holding up ${fmt(uw.exposureEUR)} in premium. Prioritise referrals first.`
      : `${uw.count} underwriting items need attention, representing ${fmt(uw.exposureEUR)} in potential premium.`,
    actionLabel:    'Review underwriting',
    actionUrl:      '/policies?attention=yes&uw_action=yes',
    priorityScore:  score('UNDERWRITING', type, uw.exposureEUR, urgency),
    suppressionKey: `UW_BACKLOG_${type}`,
  };
}

function slaInsight(sla: SLASignals): DashboardInsight | null {
  const s1 = sla.invoiceOverdue  >= 3;
  const s2 = sla.claimFnolStale  >= 2;
  const s3 = sla.uwReferralStale >= 1;
  if (!s1 && !s2 && !s3) return null;

  // Priority order: stale referrals > overdue invoices > stale FNOL
  if (s3) {
    const isCritical = sla.uwReferralStale >= 2;
    const type: InsightType = isCritical ? 'CRITICAL' : 'WARNING';
    const n = sla.uwReferralStale;
    return {
      type,
      category:       'SLA',
      title:          'Referrals are sitting too long',
      description:    `${n} underwriting ${n === 1 ? 'referral has' : 'referrals have'} exceeded turnaround expectations and may be slowing premium conversion.`,
      actionLabel:    'Review referrals',
      actionUrl:      '/policies?bo_status=REFERRAL',
      priorityScore:  score('SLA', type, 0, 15),
      suppressionKey: `SLA_STALE_REFERRALS_${type}`,
    };
  }
  if (s1) {
    const isCritical = sla.invoiceOverdue >= 5;
    const type: InsightType = isCritical ? 'CRITICAL' : 'WARNING';
    const urgency = isCritical ? 10 : 0;
    return {
      type,
      category:       'SLA',
      title:          'Overdue invoices need attention',
      description:    `${sla.invoiceOverdue} invoices are now beyond expected collection timing and may put receivables at risk.`,
      actionLabel:    'Open billing',
      actionUrl:      '/policies?invoice_overdue=yes',
      priorityScore:  score('SLA', type, 0, urgency),
      suppressionKey: `SLA_OVERDUE_INVOICES_${type}`,
    };
  }
  // s2 — stale FNOL
  const isCritical = sla.claimFnolStale >= 3;
  const type: InsightType = isCritical ? 'CRITICAL' : 'WARNING';
  const urgency = isCritical ? 5 : 0;
  return {
    type,
    category:       'SLA',
    title:          'Claims are not moving out of intake',
    description:    `${sla.claimFnolStale} claims have not been confirmed in time, which may delay handling and settlement.`,
    actionLabel:    'Open claims',
    actionUrl:      '/claims',
    priorityScore:  score('SLA', type, 0, urgency),
    suppressionKey: `SLA_STALE_FNOL_${type}`,
  };
}

function conversionInsight(conversion: ConversionSignals): DashboardInsight | null {
  if (!conversion) return null;
  const { eurLost, dropOffCount } = conversion;
  if (eurLost < 5_000 && dropOffCount < 5) return null;

  const isCritical = eurLost >= 15_000;
  const type: InsightType = isCritical ? 'CRITICAL' : 'WARNING';
  return {
    type,
    category:       'CONVERSION',
    title:          isCritical
      ? 'Conversion leak after pricing is hurting growth'
      : 'Premium is leaking after pricing',
    description:    isCritical
      ? `${fmt(eurLost)} in premium value is dropping out after price is shown. Review pricing, payment friction, or follow-up.`
      : `${fmt(eurLost)} is currently being lost between pricing and payment in the selected period.`,
    actionLabel:    'Investigate funnel',
    actionUrl:      '/reporting',
    priorityScore:  score('CONVERSION', type, eurLost, 0),
    suppressionKey: `CONVERSION_LEAK_${type}`,
  };
}

// ─── Main export ──────────────────────────────────────────────────────────────

const CAT_ORDER: Record<InsightCategory, number> = { UNDERWRITING: 0, SLA: 1, CONVERSION: 2 };

export function computeInsights(
  uw:         UWSignals,
  sla:        SLASignals,
  conversion: ConversionSignals,
): DashboardInsight[] {
  const candidates = [
    uwInsight(uw, sla),
    slaInsight(sla),
    conversionInsight(conversion),
  ].filter((x): x is DashboardInsight => x !== null);

  return candidates
    .sort((a, b) =>
      b.priorityScore !== a.priorityScore
        ? b.priorityScore - a.priorityScore
        : CAT_ORDER[a.category] - CAT_ORDER[b.category],
    )
    .slice(0, 3);
}

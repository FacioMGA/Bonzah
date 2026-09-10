import { asRecord } from '@/src/shared/lib/record';

export type UnderwritingAnalysisTriggerView = {
  code: string;
  message: string;
  lane: 'yellow' | 'red';
  severity: 'medium' | 'high';
  fields: string[];
  explanation: string;
};

export type UnderwritingAnalysisView = {
  lane: 'green' | 'yellow' | 'red';
  outcome: 'accept' | 'referral' | 'decline';
  triggerCount: number;
  triggers: UnderwritingAnalysisTriggerView[];
  pricingAdjustment: {
    type: 'automatic' | 'manual' | 'none';
    valuePct: number;
    explanation: string;
    sources: string[];
  };
};

const COMPACT_REASON_BY_CODE: Record<string, string> = {
  'YELLOW.STP_LICENCE_YEARS_NOT_MET': 'licence history below threshold',
  'YELLOW.STP_AGE_NOT_MET': 'driver age below straight-through threshold',
  'YELLOW.CLAIMS_MULTIPLE': 'claims history requires review',
  'YELLOW.MAJOR_CONVICTION': 'conviction history requires review',
  'YELLOW.FAULT_CLAIM_OVER_50K': 'large fault claim requires review',
  'YELLOW.VEHICLE_VALUE_OVER_80K': 'vehicle value above referral threshold',
  'YELLOW.USE_OUTSIDE_STANDARD': 'vehicle use outside standard appetite',
  'YELLOW.BO_OVERRIDE_EXCESS_BELOW_MIN': 'requested excess override below minimum',
  'YELLOW.DECLARED_VALUE_GT_2X_MARKET_VALUE': 'declared value above market-value threshold',
  'RED.COUNTRY_NOT_ALLOWED': 'vehicle territory is outside scheme limits',
  'RED.CLAIMS_COUNT_OVER_3': 'claims history exceeds scheme limit',
  'RED.FAULT_CLAIM_OVER_100K': 'fault claim exceeds hard-stop threshold',
  'RED.VEHICLE_VALUE_OVER_CAP': 'vehicle value exceeds scheme cap',
  'RED.LICENCE_NOT_FULL': 'licence type is outside scheme rules',
  'RED.LICENCE_YEARS_UNDER_1': 'licence history is below minimum requirement',
};

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function roundPct(value: number): number {
  return Math.round(value * 10) / 10;
}

export function normalizeUnderwritingAnalysis(value: unknown): UnderwritingAnalysisView | null {
  const analysis = asRecord(value);
  const lane = String(analysis.lane || '').trim().toLowerCase();
  const outcome = String(analysis.outcome || '').trim().toLowerCase();
  if (!lane || !outcome) return null;

  const triggers = asArray(analysis.triggers).map((trigger) => {
    const rec = asRecord(trigger);
    const triggerLane = String(rec.lane || '').trim().toLowerCase() === 'red' ? 'red' : 'yellow';
    const severity = String(rec.severity || '').trim().toLowerCase() === 'high' ? 'high' : 'medium';
    return {
      code: String(rec.code || '').trim(),
      message: String(rec.message || '').trim(),
      lane: triggerLane,
      severity,
      fields: asArray(rec.fields).map((field) => String(field || '').trim()).filter(Boolean),
      explanation: String(rec.explanation || '').trim(),
    } satisfies UnderwritingAnalysisTriggerView;
  });

  const pricing = asRecord(analysis.pricingAdjustment);
  const pricingType = String(pricing.type || '').trim().toLowerCase();
  const valuePct = roundPct(Number(pricing.valuePct || 0));

  return {
    lane: lane === 'red' ? 'red' : lane === 'yellow' ? 'yellow' : 'green',
    outcome: outcome === 'decline' ? 'decline' : outcome === 'referral' ? 'referral' : 'accept',
    triggerCount: Number.isFinite(Number(analysis.triggerCount)) ? Number(analysis.triggerCount) : triggers.length,
    triggers,
    pricingAdjustment: {
      type: pricingType === 'automatic' ? 'automatic' : pricingType === 'manual' ? 'manual' : 'none',
      valuePct,
      explanation: String(pricing.explanation || '').trim(),
      sources: asArray(pricing.sources).map((source) => String(source || '').trim()).filter(Boolean),
    },
  };
}

export function formatUnderwritingPricingHeadline(analysis: UnderwritingAnalysisView): string {
  const pricing = analysis.pricingAdjustment;
  if (pricing.type === 'automatic') {
    if (pricing.valuePct > 0) return `Automatic load +${pricing.valuePct}%`;
    if (pricing.valuePct < 0) return `Automatic discount ${pricing.valuePct}%`;
  }
  return pricing.explanation || 'No automatic pricing adjustment applied.';
}

export function formatUnderwritingDecisionHeadline(analysis: UnderwritingAnalysisView): string {
  const prefix =
    analysis.outcome === 'decline'
      ? 'Declined'
      : analysis.outcome === 'referral'
        ? 'Referral required'
        : 'Accepted';
  const primaryTrigger = analysis.triggers[0];
  if (!primaryTrigger) return prefix;
  const reason = COMPACT_REASON_BY_CODE[primaryTrigger.code] || primaryTrigger.message;
  return `${prefix} — ${reason}`;
}

export function formatUnderwritingActionHint(analysis: UnderwritingAnalysisView): string {
  if (analysis.outcome === 'referral') return 'Review details and approve or adjust pricing.';
  if (analysis.outcome === 'decline') return 'Review details and decide whether this risk can proceed outside the standard scheme.';
  return 'Ready to proceed.';
}

export function formatUnderwritingPricingLabel(analysis: UnderwritingAnalysisView): string {
  const pricing = analysis.pricingAdjustment;
  if (pricing.type === 'manual') return 'Pricing: Manual';
  if (pricing.type === 'none') return 'Pricing: Standard';
  if (pricing.valuePct > 0) return `Pricing: +${pricing.valuePct}% automatic load`;
  if (pricing.valuePct < 0) return `Pricing: ${pricing.valuePct}% automatic discount`;
  return 'Pricing: Automatic';
}

export function buildUnderwritingPricingDetails(analysis: UnderwritingAnalysisView): string[] {
  const pricing = analysis.pricingAdjustment;
  const details: string[] = [];
  if (pricing.type === 'manual') {
    details.push('Manual review required.');
    if (pricing.explanation.toLowerCase().includes('no automatic pricing adjustment applied')) {
      details.push('No automatic adjustment applied.');
    } else if (pricing.explanation) {
      details.push(pricing.explanation);
    }
  } else if (pricing.type === 'none') {
    details.push('No automatic adjustment applied.');
  } else if (pricing.explanation) {
    details.push(pricing.explanation);
  }
  pricing.sources.forEach((source) => {
    if (!details.includes(source)) details.push(source);
  });
  return details.filter(Boolean);
}

import type { QuoteOption, QuoteResponse } from '../../../platform/types/autoInsurance.js';
import type { UwAutomationDecision, UwTriggerLane } from '../../../products/motor/underwriting/motorUwAutomation.js';

type UnknownRecord = Record<string, unknown>;

export type UnderwritingAnalysisTriggerSeverity = 'medium' | 'high';
export type UnderwritingAnalysisPricingType = 'automatic' | 'manual' | 'none';

export type UnderwritingAnalysisTrigger = {
  code: string;
  message: string;
  lane: UwTriggerLane;
  severity: UnderwritingAnalysisTriggerSeverity;
  fields: string[];
  explanation: string;
};

export type UnderwritingAnalysisPricingAdjustment = {
  type: UnderwritingAnalysisPricingType;
  valuePct: number;
  explanation: string;
  sources: string[];
};

export type UnderwritingAnalysis = {
  lane: 'green' | 'yellow' | 'red';
  outcome: 'accept' | 'referral' | 'decline';
  triggers: UnderwritingAnalysisTrigger[];
  triggerCount: number;
  pricingAdjustment: UnderwritingAnalysisPricingAdjustment;
};

export type UnderwritingAnalysisOverlayTriggerInput = {
  code: string;
  message: string;
  lane?: UwTriggerLane;
  fields?: string[];
  explanation?: string;
};

const TRIGGER_EXPLANATIONS: Record<string, string> = {
  'RED.COUNTRY_NOT_ALLOWED': 'This risk sits outside the scheme territory and cannot be processed automatically.',
  'RED.VEHICLE_VALUE_OVER_CAP': 'The vehicle value is above the scheme hard-stop threshold.',
  'RED.GARAGE_VALUE_OVER_CAP': 'The declared garage value exceeds the scheme hard-stop threshold.',
  'RED.CLAIMS_COUNT_OVER_3': 'The claims history exceeds the scheme limit and blocks automatic quoting.',
  'RED.FAULT_CLAIM_OVER_100K': 'The fault-claim amount exceeds the scheme hard-stop threshold.',
  'RED.LICENCE_NOT_FULL': 'A full licence is required for this risk to proceed automatically.',
  'RED.LICENCE_YEARS_UNDER_1': 'The proposer has not held a full licence for the minimum scheme period.',
  'RED.AAD_UNDER_21': 'A named driver is below the minimum age for automatic acceptance.',
  'RED.MOTORCYCLE_NOT_COMP': 'Motorcycle risks must be comprehensive to fit this scheme.',
  'RED.VEHICLE_CLASS_OUTSIDE_SCHEME': 'The declared vehicle class is outside the scheme appetite.',
  'YELLOW.MAJOR_CONVICTION': 'A major conviction always requires an underwriter decision.',
  'YELLOW.FAULT_CLAIM_OVER_50K': 'A large fault claim requires manual underwriting review.',
  'YELLOW.CLAIMS_MULTIPLE': 'Multiple prior claims require underwriter review before acceptance.',
  'YELLOW.AAD_22_24': 'A younger added driver sits outside straight-through appetite.',
  'YELLOW.VEHICLE_VALUE_OVER_80K': 'A high-value vehicle requires manual underwriting review.',
  'YELLOW.CLASSIC_VALUE_OVER_60K': 'A high-value classic risk requires underwriter review.',
  'YELLOW.CLASSIC_GENUINE_REQUIRED': 'Classic risks must be confirmed as genuine classics for the scheme.',
  'YELLOW.CLASSIC_SECONDARY_REQUIRED': 'Classic risks must be confirmed as a secondary household vehicle.',
  'YELLOW.MOTORCARAVAN_OVER_30K': 'A high-value motorcaravan requires underwriter review.',
  'YELLOW.USE_OUTSIDE_STANDARD': 'Non-standard vehicle use requires underwriter review.',
  'YELLOW.STP_AGE_NOT_MET': 'This risk falls outside the straight-through age threshold.',
  'YELLOW.STP_LICENCE_YEARS_NOT_MET': 'This risk falls outside the straight-through licence-history threshold.',
  'YELLOW.CLAIMS_COUNT_MISSING': 'Claims history cannot be auto-assessed until the missing data is completed.',
  'YELLOW.MOTORCYCLE_RIDER_UNDER_25': 'A younger motorcycle rider requires manual underwriting review.',
  'YELLOW.MOTORCYCLE_RIDER_UNDER_25_AAD': 'A younger named motorcycle rider requires manual underwriting review.',
  'YELLOW.MOTORCYCLE_OVER_200CC_NO_NCD': 'A higher-capacity motorcycle without NCD evidence requires review.',
  'YELLOW.DECLARED_VALUE_GT_2X_MARKET_VALUE': 'The declared value materially exceeds market value and needs manual review.',
  'YELLOW.BO_OVERRIDE_EXCESS_BELOW_MIN': 'The requested excess override is below the computed minimum and needs manual approval.',
};

const AUTOMATIC_PRICING_FACTORS: Array<{
  match: (id: string) => boolean;
  source: string;
}> = [
  { match: (id) => id === 'comp.claims', source: 'Claims history' },
  { match: (id) => id === 'comp.convictions', source: 'Convictions' },
  { match: (id) => id === 'comp.use', source: 'Vehicle use' },
  { match: (id) => id === 'drivers.addedUnder25', source: 'Added driver age' },
  { match: (id) => id === 'drivers.addedOver80', source: 'Added driver age' },
  { match: (id) => id === 'comp.licence', source: 'Licence history' },
];

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : {};
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function roundPct(value: number): number {
  return Math.round(value * 10) / 10;
}

function titleCaseEnum(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function triggerSeverity(code: string, lane: UwTriggerLane): UnderwritingAnalysisTriggerSeverity {
  if (lane === 'red') return 'high';
  return code.includes('CONVICTION') || code.includes('MAJOR') ? 'high' : 'medium';
}

function triggerExplanation(code: string, lane: UwTriggerLane, message: string): string {
  const mapped = TRIGGER_EXPLANATIONS[code];
  if (mapped) return mapped;
  if (lane === 'red') return 'This rule blocks automatic progression and requires manual handling.';
  return message || 'This rule requires underwriter review before the risk can continue automatically.';
}

type PricingTraceStep = NonNullable<QuoteOption['calculationTrace']>['steps'][number];

function readTraceSteps(quoteResponse: QuoteResponse | UnknownRecord | null | undefined): PricingTraceStep[] {
  const quote = asRecord(quoteResponse);
  const primary = asRecord(quote.primaryOption);
  const trace = asRecord(primary.calculationTrace);
  return asArray<PricingTraceStep>(trace.steps);
}

function buildAutomaticPricingAdjustment(steps: PricingTraceStep[]): UnderwritingAnalysisPricingAdjustment | null {
  const applied = steps
    .map((step) => {
      const rec = asRecord(step);
      const id = String(rec.id || '').trim();
      const kind = String(rec.kind || '').trim().toLowerCase();
      const name = String(rec.name || '').trim();
      const factor = Number(rec.factor);
      const mappedSource = AUTOMATIC_PRICING_FACTORS.find((entry) => entry.match(id))?.source;
      const source = mappedSource || (kind === 'factor' || kind === 'discount' ? name : '');
      if (!source || !Number.isFinite(factor) || Math.abs(factor - 1) < 0.0001) return null;
      return { source, factor };
    })
    .filter((item): item is { source: string; factor: number } => Boolean(item));

  if (!applied.length) return null;

  const combinedFactor = applied.reduce((acc, item) => acc * item.factor, 1);
  const valuePct = roundPct((combinedFactor - 1) * 100);
  const sources = applied.map((item) => {
    const pct = roundPct((item.factor - 1) * 100);
    return `${item.source} (${pct > 0 ? `+${pct}` : `${pct}`}%)`;
  });
  const direction = valuePct > 0 ? 'loading' : valuePct < 0 ? 'discount' : 'automatic adjustment';
  const explanation = valuePct === 0
    ? 'Automatic pricing factors were applied, but the net pricing effect is neutral.'
    : `Automatic pricing ${direction} applied from the rated risk factors.`;

  return {
    type: 'automatic',
    valuePct,
    explanation,
    sources,
  };
}

function buildManualPricingAdjustment(steps: PricingTraceStep[], triggers: UnderwritingAnalysisTrigger[]): UnderwritingAnalysisPricingAdjustment | null {
  const manualSteps = steps
    .map((step) => asRecord(step))
    .filter((step) => String(step.id || '').startsWith('uw.adjustment.'));

  if (manualSteps.length > 0) {
    const pctParts = manualSteps
      .map((step) => {
        const inputs = asRecord(step.inputs);
        const mode = String(inputs.mode || '').toLowerCase();
        const type = String(inputs.type || '').toLowerCase();
        const value = Number(inputs.value);
        if (mode !== 'pct' || !Number.isFinite(value) || value === 0) return 0;
        return type === 'discount' ? -Math.abs(value) : Math.abs(value);
      })
      .filter((value) => value !== 0);
    const valuePct = pctParts.length ? roundPct(pctParts.reduce((sum, value) => sum + value, 0)) : 0;
    const sources = manualSteps.map((step) => String(step.notes || step.name || 'Underwriter pricing adjustment')).filter(Boolean);
    return {
      type: 'manual',
      valuePct,
      explanation: 'Manual pricing adjustment applied by underwriter.',
      sources,
    };
  }

  if (triggers.length > 0) {
    return {
      type: 'manual',
      valuePct: 0,
      explanation: 'Manual review required — no automatic pricing adjustment applied.',
      sources: triggers.map((trigger) => trigger.message),
    };
  }

  return null;
}

export function buildUnderwritingAnalysis(args: {
  uwDecision: Partial<UwAutomationDecision> | UnknownRecord | null | undefined;
  quoteResponse?: QuoteResponse | UnknownRecord | null;
  overlayTriggers?: UnderwritingAnalysisOverlayTriggerInput[];
}): UnderwritingAnalysis {
  const uwDecision = asRecord(args.uwDecision);
  const baseTriggers = asArray(uwDecision.triggers).map((trigger) => {
    const rec = asRecord(trigger);
    const code = String(rec.ruleId || rec.code || '').trim();
    const message = String(rec.message || '').trim();
    const explanation = String(rec.explanation || '').trim();
    const lane = String(rec.lane || 'yellow').trim().toLowerCase() === 'red' ? 'red' : 'yellow';
    const fields = asArray(rec.fields).map((field) => String(field || '').trim()).filter(Boolean);
    return {
      code,
      message,
      lane,
      severity: triggerSeverity(code, lane),
      fields,
      explanation: explanation || triggerExplanation(code, lane, message),
    } satisfies UnderwritingAnalysisTrigger;
  });

  const overlayTriggers = (args.overlayTriggers || []).map((trigger) => {
    const code = String(trigger.code || '').trim();
    const message = String(trigger.message || '').trim();
    const lane = trigger.lane === 'red' ? 'red' : 'yellow';
    return {
      code,
      message,
      lane,
      severity: triggerSeverity(code, lane),
      fields: (trigger.fields || []).map((field) => String(field || '').trim()).filter(Boolean),
      explanation: String(trigger.explanation || triggerExplanation(code, lane, message)).trim(),
    } satisfies UnderwritingAnalysisTrigger;
  });

  const triggers = [...baseTriggers, ...overlayTriggers];
  const lane = triggers.some((trigger) => trigger.lane === 'red')
    ? 'red'
    : triggers.length > 0
      ? 'yellow'
      : (String(uwDecision.lane || '').trim().toLowerCase() === 'red'
        ? 'red'
        : String(uwDecision.lane || '').trim().toLowerCase() === 'yellow'
          ? 'yellow'
          : 'green');
  const explicitOutcome = String(uwDecision.outcome || '').trim().toLowerCase();
  const outcome = explicitOutcome === 'decline' || explicitOutcome === 'referral' || explicitOutcome === 'accept'
    ? explicitOutcome
    : lane === 'red' ? 'decline' : lane === 'yellow' ? 'referral' : 'accept';

  const steps = readTraceSteps(args.quoteResponse);
  const pricingAdjustment = buildAutomaticPricingAdjustment(steps)
    || buildManualPricingAdjustment(steps, triggers)
    || {
      type: 'none',
      valuePct: 0,
      explanation: 'No automatic pricing adjustment applied.',
      sources: [],
    };

  return {
    lane,
    outcome,
    triggers,
    triggerCount: triggers.length,
    pricingAdjustment,
  };
}

export function buildValueMismatchOverlayTrigger(args: {
  declaredValue: number;
  marketValue: number;
}): UnderwritingAnalysisOverlayTriggerInput {
  return {
    code: 'YELLOW.DECLARED_VALUE_GT_2X_MARKET_VALUE',
    message: `Declared value (€${Math.round(args.declaredValue).toLocaleString()}) exceeds 2x market value (€${Math.round(args.marketValue).toLocaleString()}).`,
    lane: 'yellow',
    fields: ['vehicleValue'],
    explanation: TRIGGER_EXPLANATIONS['YELLOW.DECLARED_VALUE_GT_2X_MARKET_VALUE'],
  };
}

export function buildBoOverrideOverlayTrigger(args: {
  requestedOverrideExcess: number;
  computedMinimumExcess: number;
}): UnderwritingAnalysisOverlayTriggerInput {
  return {
    code: 'YELLOW.BO_OVERRIDE_EXCESS_BELOW_MIN',
    message: `BO override excess €${Math.round(args.requestedOverrideExcess)} is below computed minimum €${Math.round(args.computedMinimumExcess)}.`,
    lane: 'yellow',
    fields: ['requiredExcess'],
    explanation: TRIGGER_EXPLANATIONS['YELLOW.BO_OVERRIDE_EXCESS_BELOW_MIN'],
  };
}

export function describeUnderwritingAnalysisOutcome(analysis: UnderwritingAnalysis): string {
  if (analysis.pricingAdjustment.type === 'automatic') {
    const pct = analysis.pricingAdjustment.valuePct;
    if (pct > 0) return `Automatic pricing load +${pct}%`;
    if (pct < 0) return `Automatic pricing discount ${pct}%`;
    return analysis.pricingAdjustment.explanation;
  }
  return analysis.pricingAdjustment.explanation || titleCaseEnum(analysis.outcome);
}

import type { BuildQuoteResponseContext, QuoteResponseResult } from '../../../modules/policy/domain/productContracts.js';
import type { QuoteData } from '../../../platform/types/autoInsurance.js';
import { computeCalculatedPolicyExcess } from '../pricing/canonicalRules.js';
import { evaluateConfiguredMotorUwAutomation } from './motorUwAutomation.js';
import {
  buildBoOverrideOverlayTrigger,
  buildUnderwritingAnalysis,
  buildValueMismatchOverlayTrigger,
} from '../../../modules/underwriting/domain/underwritingAnalysis.js';

type MotorQuoteDataWithMeta = QuoteData & {
  __meta?: unknown;
  marketValue?: number | string;
};

function requireMotorQuoteData(value: unknown): MotorQuoteDataWithMeta {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Motor referral overlays require an object quote payload');
  }
  return value as MotorQuoteDataWithMeta;
}

function readQuoteOrigin(quoteData: MotorQuoteDataWithMeta): string {
  const metadata = quoteData.__meta;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return 'customer';
  const origin = (metadata as { origin?: unknown }).origin;
  return typeof origin === 'string' && origin.trim() ? origin.trim().toLowerCase() : 'customer';
}

function numericOverride(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Product-owned Motor referral overlays. These conditions are part of Motor's
 * underwriting decision, so every surface must receive them through the
 * Motor adapter rather than recreating them in a caller.
 */
export function applyMotorReferralOverlays(args: {
  quoteData: unknown;
  context?: BuildQuoteResponseContext;
  result: QuoteResponseResult;
}): QuoteResponseResult {
  const quoteData = requireMotorQuoteData(args.quoteData);
  const uwConfig = args.context?.programDefinition?.underwriting;
  if (!uwConfig) throw new Error('Motor referral overlays require a published programme definition.');
  const uwDecision = evaluateConfiguredMotorUwAutomation(quoteData, uwConfig);
  const quoteResponse = args.result.quoteResponse;
  const declaredValue = Number(quoteData.vehicleValue || 0);
  const marketValue = Number(quoteData.marketValue || 0);
  const valueMismatchYellowLane = Number.isFinite(marketValue) && marketValue > 0 && declaredValue > marketValue * 2;
  const computedMinimumExcess = computeCalculatedPolicyExcess(
    quoteData,
    args.context?.ratingModel?.tables as never, // TODO(FAC-1069): owner=platform-eng expires=2026-10-05 deletionPR=#1069 expose typed Motor rating model in context
  );
  const requestedOverrideExcess = numericOverride(args.context?.overrideExcess);
  const origin = readQuoteOrigin(quoteData);
  const boOverrideNeedsApproval = requestedOverrideExcess !== null
    && requestedOverrideExcess > 0
    && requestedOverrideExcess < computedMinimumExcess
    && origin === 'bo';
  const overlayTriggers = [
    ...(boOverrideNeedsApproval ? [buildBoOverrideOverlayTrigger({
      requestedOverrideExcess,
      computedMinimumExcess,
    })] : []),
    ...(valueMismatchYellowLane ? [buildValueMismatchOverlayTrigger({ declaredValue, marketValue })] : []),
  ];
  const status = uwDecision.outcome === 'decline'
    ? 'declined'
    : uwDecision.outcome === 'referral' || boOverrideNeedsApproval || valueMismatchYellowLane
      ? 'referral'
      : 'quoted';
  const overlayDecision = overlayTriggers.length > 0 && uwDecision.outcome === 'accept'
    ? { ...uwDecision, lane: 'yellow' as const, outcome: 'referral' as const }
    : uwDecision;
  const normalizedQuoteResponse = {
    ...quoteResponse,
    status,
    referralMessage: uwDecision.outcome === 'referral'
      ? 'Your quotation requires referral to our underwriters.'
      : quoteResponse.referralMessage,
    warnings: [
      ...(Array.isArray(quoteResponse.warnings) ? quoteResponse.warnings : []),
      ...(uwDecision.outcome !== 'accept' ? [`Underwriting ${uwDecision.lane.toUpperCase()} lane: ${uwDecision.reasons.join(' ')}`] : []),
      ...(boOverrideNeedsApproval ? [`Manual approval required: BO override excess €${requestedOverrideExcess} is below computed minimum €${computedMinimumExcess}.`] : []),
      ...(valueMismatchYellowLane ? [`Yellow lane: declared value (€${declaredValue}) exceeds 2x market value (€${marketValue}).`] : []),
    ],
  };
  return {
    quoteResponse: normalizedQuoteResponse,
    underwritingAnalysis: {
      ...buildUnderwritingAnalysis({
      uwDecision: overlayDecision,
      quoteResponse: normalizedQuoteResponse,
      overlayTriggers,
      }),
    },
  };
}

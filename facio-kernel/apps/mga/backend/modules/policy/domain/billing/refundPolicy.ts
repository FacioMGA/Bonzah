type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : {};
}

function toPositiveNumber(value: unknown): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function roadsideNonRefundableFloorFromSnapshot(snapshot: unknown): number {
  const snap = asRecord(snapshot);
  const snapQuoteResponse = asRecord(snap.quoteResponse);
  const snapPrimaryOption = asRecord(snapQuoteResponse.primaryOption);
  const snapCalculationTrace = asRecord(snapPrimaryOption.calculationTrace);
  const snapCalculationDetails = asRecord(snap.calculationDetails);
  const primarySteps = Array.isArray(snapCalculationTrace.steps) ? snapCalculationTrace.steps : [];
  const fallbackSteps = Array.isArray(snapCalculationDetails.steps) ? snapCalculationDetails.steps : [];
  const steps = primarySteps.length > 0 ? primarySteps : fallbackSteps;
  const roadsideStep = steps
    .map((item) => asRecord(item))
    .find((step) => String(step.id || '') === 'endorsement.premium.COV-ROADSIDE');
  return toPositiveNumber(roadsideStep?.amount);
}

export function computeNonRefundableFloor(args: {
  snapshot: unknown;
  registryFallbackPrice: number;
}): number {
  const fromSnapshot = roadsideNonRefundableFloorFromSnapshot(args.snapshot);
  if (fromSnapshot > 0) return fromSnapshot;
  return toPositiveNumber(args.registryFallbackPrice);
}

export function evaluateRefundAllowance(args: {
  referenceAmount: number;
  alreadyRefunded: number;
  requestedAmount: number;
  nonRefundableFloor: number;
}): {
  allowed: boolean;
  maxRefundableTotal: number;
  remaining: number;
} {
  const referenceAmount = Number(args.referenceAmount || 0);
  const alreadyRefunded = Number(args.alreadyRefunded || 0);
  const requestedAmount = Number(args.requestedAmount || 0);
  const nonRefundableFloor = Number(args.nonRefundableFloor || 0);
  const maxRefundableTotal = Math.max(0, referenceAmount - nonRefundableFloor);
  const remaining = Math.max(0, maxRefundableTotal - alreadyRefunded);
  return {
    allowed: requestedAmount - remaining <= 0.0001,
    maxRefundableTotal,
    remaining,
  };
}

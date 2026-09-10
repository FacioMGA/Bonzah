type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

/**
 * Minimal source-of-truth helper for policy workspace quote data.
 *
 * The coverage-options resolver path should read snapshot quoteData first,
 * because that is the operational workspace copy. If the snapshot has no
 * quoteData key at all, fall back to the policy row copy.
 */
export function resolveEffectiveQuoteData(args: {
  snapshot: unknown;
  policyQuoteData: unknown;
}): UnknownRecord {
  const snapshot = asRecord(args.snapshot);
  if (Object.prototype.hasOwnProperty.call(snapshot, 'quoteData')) {
    return asRecord(snapshot.quoteData);
  }
  return asRecord(args.policyQuoteData);
}

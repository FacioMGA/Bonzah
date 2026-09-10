import { sha256Hex, stableStringify } from './hashes.js';

/**
 * Pricing Integrity Stamp — canonical contract for snapshot pricing
 * persistence.
 *
 * Every path that finalizes rated state into
 * `PolicyStateCurrent.snapshot` MUST stamp the snapshot's `pricing`
 * block with this artifact. Issue-readiness blocks bind/issuance with
 * `PRICING_HASH_MISMATCH` whenever either hash field is absent or stale.
 */
export type PricingIntegrityStampInput = {
  quoteData: unknown;
  quoteResponse: unknown;
  overrideExcess?: number | string | null;
  binderVersion?: string;
};

export type PricingIntegrityStamp = {
  calculatedAt: string;
  snapshotHash: string;
  pricingHash: string;
};

function toPersistedJsonComparable(input: unknown): unknown {
  const serialized = JSON.stringify(input);
  if (serialized === undefined) return null;
  return JSON.parse(serialized);
}

export function computePricingIntegrityStamp(
  input: PricingIntegrityStampInput,
): PricingIntegrityStamp {
  const snapshotForHash = {
    quoteData: toPersistedJsonComparable(input.quoteData),
    quoteResponse: toPersistedJsonComparable(input.quoteResponse),
  };
  const snapshotHash = sha256Hex(stableStringify(snapshotForHash));
  const pricingHash = sha256Hex(stableStringify({
    snapshotHash,
    overrideExcess: input.overrideExcess ?? null,
    binderVersion: input.binderVersion ?? 'default',
  }));
  return {
    calculatedAt: new Date().toISOString(),
    snapshotHash,
    pricingHash,
  };
}

// Internal helpers for the worksheet projection.
// Not part of the public surface — do not re-export from `../worksheetProjection.ts`.

import type { BucketState, ClaimBucket, LedgerState } from '../types.js';

export const INDEMNITY_BUCKETS: ClaimBucket[] = ['INDEMNITY', 'DEFENCE_COSTS'];
export const FEE_BUCKETS: ClaimBucket[] = ['ADJUSTER_FEES', 'LEGAL_FEES', 'OTHER'];
export const ALL_BUCKETS: ClaimBucket[] = [...INDEMNITY_BUCKETS, ...FEE_BUCKETS];

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function asNumber(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

export function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function readPath(obj: Record<string, unknown> | undefined, path: string): unknown {
  if (!obj) return undefined;
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function defaultBucketState(): BucketState {
  return {
    paid: 0,
    outstanding: 0,
    recovered: 0,
    recoveryExpected: 0,
    salvageRealized: 0,
    salvageExpected: 0,
  };
}

export function emptyBuckets(): Record<ClaimBucket, BucketState> {
  return {
    INDEMNITY: defaultBucketState(),
    DEFENCE_COSTS: defaultBucketState(),
    ADJUSTER_FEES: defaultBucketState(),
    LEGAL_FEES: defaultBucketState(),
    OTHER: defaultBucketState(),
  };
}

export function normalizeBucket(value: unknown, fallback: ClaimBucket = 'INDEMNITY'): ClaimBucket {
  const upper = String(value || '').trim().toUpperCase();
  if (ALL_BUCKETS.includes(upper as ClaimBucket)) return upper as ClaimBucket;
  if (upper === 'FEES') return 'LEGAL_FEES';
  return fallback;
}

export function recomputeTotals(state: LedgerState) {
  const paidIndemnity = INDEMNITY_BUCKETS.reduce((sum, bucket) => sum + state.buckets[bucket].paid, 0);
  const reserveIndemnity = INDEMNITY_BUCKETS.reduce((sum, bucket) => sum + state.buckets[bucket].outstanding, 0);
  const paidFees = FEE_BUCKETS.reduce((sum, bucket) => sum + state.buckets[bucket].paid, 0);
  const reserveFees = FEE_BUCKETS.reduce((sum, bucket) => sum + state.buckets[bucket].outstanding, 0);
  const recoveriesReceived = ALL_BUCKETS.reduce((sum, bucket) => sum + state.buckets[bucket].recovered, 0);
  const recoveriesExpected = ALL_BUCKETS.reduce((sum, bucket) => sum + state.buckets[bucket].recoveryExpected, 0);
  const salvageRealized = ALL_BUCKETS.reduce((sum, bucket) => sum + state.buckets[bucket].salvageRealized, 0);
  const salvageExpected = ALL_BUCKETS.reduce((sum, bucket) => sum + state.buckets[bucket].salvageExpected, 0);
  const totalPaid = paidIndemnity + paidFees;
  const totalOutstanding = reserveIndemnity + reserveFees;
  const totalIncurred = totalPaid + totalOutstanding;
  const totalRecovered = recoveriesReceived + salvageRealized;
  const netIncurred = totalIncurred - totalRecovered;
  state.paidIndemnity = paidIndemnity;
  state.reserveIndemnity = reserveIndemnity;
  state.paidFees = paidFees;
  state.reserveFees = reserveFees;
  state.recoveriesReceived = recoveriesReceived;
  state.recoveriesExpected = recoveriesExpected;
  state.salvageRealized = salvageRealized;
  state.salvageExpected = salvageExpected;
  state.totalPaid = totalPaid;
  state.totalOutstanding = totalOutstanding;
  state.totalIncurred = totalIncurred;
  state.totalRecovered = totalRecovered;
  state.netIncurred = netIncurred;
}

import { asRecord } from '@/src/shared/lib/record';

type IssueBlockerLike = { code?: unknown };

const AUTO_REFRESH_PRICING_BLOCKER_CODES = new Set(['PRICING_DRIFT', 'PRICING_HASH_MISMATCH']);

export function isAutoRefreshPricingBlocker(blocker: IssueBlockerLike): boolean {
  return AUTO_REFRESH_PRICING_BLOCKER_CODES.has(String(blocker.code || '').trim().toUpperCase());
}

export function filterOperatorVisibleBlockers(blockers: unknown[]): Record<string, unknown>[] {
  return blockers.map((blocker) => asRecord(blocker)).filter((blocker) => !isAutoRefreshPricingBlocker(blocker));
}

export function hasOnlyAutoRefreshPricingBlockers(blockers: unknown[]): boolean {
  const rows = blockers.map((blocker) => asRecord(blocker));
  return rows.length > 0 && rows.every(isAutoRefreshPricingBlocker);
}

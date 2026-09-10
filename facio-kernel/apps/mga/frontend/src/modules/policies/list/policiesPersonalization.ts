import type { ListSort } from '@/src/shared/core/recordList/types';
import { policyListRegistry } from './policyListRegistry';

type SortUsageMap = Record<string, { asc: number; desc: number }>;
type StatusUsageMap = Record<string, number>;

type RecordListPersonalization = {
  sortUsage: SortUsageMap;
  statusUsage: StatusUsageMap;
};

const STORAGE_PREFIX = 'recordList.personalization.';

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readState(configId: string): RecordListPersonalization {
  if (!canUseStorage()) return { sortUsage: {}, statusUsage: {} };
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${configId}`);
    if (!raw) return { sortUsage: {}, statusUsage: {} };
    const parsed = JSON.parse(raw);
    return {
      sortUsage: parsed?.sortUsage && typeof parsed.sortUsage === 'object' ? parsed.sortUsage : {},
      statusUsage: parsed?.statusUsage && typeof parsed.statusUsage === 'object' ? parsed.statusUsage : {},
    };
  } catch {
    return { sortUsage: {}, statusUsage: {} };
  }
}

export function getPersonalizedPolicySmartSorts(): ListSort[] {
  const state = readState('policies');
  const defaultSorts: ListSort[] = (policyListRegistry.defaultSort || []).map((s) => ({
    field: String(s.field),
    direction: s.direction === 'asc' ? 'asc' : 'desc',
  }));

  const entries = Object.entries(state.sortUsage || {});
  const statusUsage = state.statusUsage || {};
  const activeFocus =
    Number(statusUsage.ACTIVE || 0) +
    Number(statusUsage.ISSUED || 0) +
    Number(statusUsage.EXPIRED || 0);
  if (activeFocus >= 4) {
    return [
      { field: 'expiryDate', direction: 'asc' },
      { field: 'updatedAt', direction: 'desc' },
    ];
  }
  if (!entries.length) return defaultSorts;

  const allowed = new Set(Object.keys(policyListRegistry.sortFields || {}));
  const [bestField, bestCounts] = entries
    .filter(([field]) => allowed.has(field))
    .sort((a, b) => {
      const at = Number(a[1]?.asc || 0) + Number(a[1]?.desc || 0);
      const bt = Number(b[1]?.asc || 0) + Number(b[1]?.desc || 0);
      return bt - at;
    })[0] || [];

  if (!bestField) return defaultSorts;
  const bestCountsRecord = (bestCounts && typeof bestCounts === 'object')
    ? (bestCounts as Record<string, unknown>)
    : {};
  const primaryDir: 'asc' | 'desc' =
    Number(bestCountsRecord.asc || 0) > Number(bestCountsRecord.desc || 0) ? 'asc' : 'desc';

  const primary: ListSort = { field: bestField, direction: primaryDir };
  const secondary = bestField === 'updatedAt'
    ? { field: 'policyNumber', direction: 'desc' as const }
    : { field: 'updatedAt', direction: 'desc' as const };
  return [primary, secondary];
}

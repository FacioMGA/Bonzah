import type { ListSort } from './types';

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

function writeState(configId: string, state: RecordListPersonalization) {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${configId}`, JSON.stringify(state));
  } catch {
    // Ignore storage write errors (private mode/quota).
  }
}

export function trackSortUsage(configId: string, sorts: ListSort[]) {
  if (!Array.isArray(sorts) || sorts.length === 0) return;
  const state = readState(configId);
  const primary = sorts[0];
  if (!primary?.field) return;
  const cur = state.sortUsage[primary.field] || { asc: 0, desc: 0 };
  if (primary.direction === 'asc') cur.asc += 1;
  else cur.desc += 1;
  state.sortUsage[primary.field] = cur;
  writeState(configId, state);
}

export function trackFilterUsage(configId: string, filters: Record<string, unknown>) {
  const status = String(filters?.status || '').trim().toUpperCase();
  if (!status) return;
  const state = readState(configId);
  state.statusUsage[status] = Number(state.statusUsage[status] || 0) + 1;
  writeState(configId, state);
}

export function trackRowOpen(configId: string, row: Record<string, unknown> | undefined) {
  const status = String(row?.status || '').trim().toUpperCase();
  if (!status) return;
  const state = readState(configId);
  state.statusUsage[status] = Number(state.statusUsage[status] || 0) + 1;
  writeState(configId, state);
}


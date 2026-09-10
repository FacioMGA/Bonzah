import { boApiClient } from '@/src/shared/api/boApiClient';
import type { RecordListAdapter } from '@/src/shared/core/recordList/types';
import { mapBinderIndexRows } from '../model/binderMappers';
import type { BinderIndexRow } from '../model/readModels';

function filterRows(rows: BinderIndexRow[], query: {
  search: string;
  filters: Record<string, unknown>;
}): BinderIndexRow[] {
  const search = String(query.search || '').trim().toLowerCase();
  const status = String(query.filters?.status || '').trim().toUpperCase();
  const reportingVersion = String(query.filters?.lloydsReportingVer || '').trim().toUpperCase();
  const currency = String(query.filters?.currency || '').trim().toUpperCase();
  const lifecycle = String(query.filters?.lifecycle || '').trim().toLowerCase();
  const now = Date.now();

  return rows.filter((row) => {
    if (search) {
      const hay = `${row.coverholderName} ${row.umr} ${row.agreementNumber}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    if (status && String(row.status || '').toUpperCase() !== status) return false;
    if (reportingVersion && String(row.lloydsReportingVer || '').toUpperCase() !== reportingVersion) return false;
    if (currency) {
      const curPair = `${row.defaultCurrency}/${row.settlementCurrency}`.toUpperCase();
      if (!curPair.includes(currency) && String(row.defaultCurrency || '').toUpperCase() !== currency && String(row.settlementCurrency || '').toUpperCase() !== currency) {
        return false;
      }
    }
    if (lifecycle) {
      const start = row.startDate ? new Date(row.startDate).getTime() : NaN;
      const end = row.endDate ? new Date(row.endDate).getTime() : NaN;
      const statusUpper = String(row.status || '').toUpperCase();
      if (lifecycle === 'active') {
        if (!(statusUpper === 'ACTIVE' && Number.isFinite(start) && Number.isFinite(end) && now >= start && now <= end)) return false;
      } else if (lifecycle === 'expired') {
        if (!(Number.isFinite(end) && now > end)) return false;
      } else if (lifecycle === 'draft') {
        if (!(statusUpper === 'DRAFT' || statusUpper === 'PENDING')) return false;
      }
    }
    return true;
  });
}

function sortRows(rows: BinderIndexRow[], field: string, direction: 'asc' | 'desc'): BinderIndexRow[] {
  const dir = direction === 'asc' ? 1 : -1;
  const getValue = (row: BinderIndexRow) => {
    if (field === 'leadCapacityProviderName') return String(row.leadCapacityProviderName || '').toLowerCase();
    if (field === 'coverholderName') return String(row.coverholderName || '').toLowerCase();
    if (field === 'status') return String(row.status || '').toLowerCase();
    if (field === 'startDate') return String(row.startDate || '');
    if (field === 'endDate') return String(row.endDate || '');
    if (field === 'lloydsReportingVer') return String(row.lloydsReportingVer || '');
    if (field === 'gpiUsagePct') return Number(row.gpiUsagePct || 0);
    if (field === 'version') return Number(row.version || 0);
    return String(row.lastUpdatedAt || row.endDate || row.startDate || '');
  };
  return [...rows].sort((a, b) => {
    const va = getValue(a);
    const vb = getValue(b);
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
    return String(va).localeCompare(String(vb)) * dir;
  });
}

export const bindersAdapter: RecordListAdapter<BinderIndexRow> = {
  capabilities: { totalCount: true, serverSort: false },
  fetchPage: async ({ query, cursor, limit, signal }) => {
    void signal;
    const response = await boApiClient.listBinders();
    if (!response.success) {
      throw new Error(response.error?.message || 'Failed to load binders');
    }

    let rows = mapBinderIndexRows(response);
    rows = filterRows(rows, { search: query.search, filters: query.filters });

    const sorts = Array.isArray(query.sorts) && query.sorts.length ? query.sorts : (query.sort?.field ? [query.sort] : []);
    const primary = sorts[0];
    if (primary?.field) {
      rows = sortRows(rows, String(primary.field), primary.direction === 'asc' ? 'asc' : 'desc');
    } else {
      rows = sortRows(rows, 'lastUpdatedAt', 'desc');
    }

    const offset = Math.max(0, Number(cursor || 0));
    const pageSize = Math.max(1, Number(limit || 12));
    const items = rows.slice(offset, offset + pageSize);
    const total = rows.length;
    const nextOffset = offset + items.length;
    const hasMore = nextOffset < total;

    return {
      items,
      hasMore,
      nextCursor: hasMore ? String(nextOffset) : null,
      total,
    };
  },
};

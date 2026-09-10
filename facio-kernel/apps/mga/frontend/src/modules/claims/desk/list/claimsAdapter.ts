import { claimsApiClient as api } from '@/src/modules/claims/api/claimsApiClient';
import type { RecordListAdapter } from '../../../../shared/core/recordList/types';

export type BoClaimListItem = {
  id: string;
  claimNumber: string;
  status: string;
  statusRank: number;
  policyNumber: string;
  policyHolderName: string;
  incidentDate: string;
  reportedDate: string;
  updatedAt: string;
  lossCountry: string;
  certificateReference: string;
  causeOfLossCode: string;
  description: string;
  originalCurrency: string;
};

type RawClaimRow = {
  id?: string;
  claimNumber?: string;
  status?: string;
  policyNumber?: string;
  policyHolderName?: string;
  incidentDate?: string;
  reportedDate?: string;
  updatedAt?: string;
  summary?: {
    incidentDate?: string;
    lossCountry?: string;
    causeOfLossCode?: string;
    description?: string;
    certificateReference?: string;
    originalCurrency?: string;
  };
};

const STATUS_ORDER: Record<string, number> = {
  OPEN: 10,
  REOPENED: 20,
  CLOSED_THIS_MONTH: 30,
  CLOSED: 40,
  WITHDRAWN: 50,
  PENDING: 60,
};

function toRank(statusRaw: unknown): number {
  const status = String(statusRaw || '').toUpperCase().trim();
  return STATUS_ORDER[status] ?? 999;
}

function norm(v: unknown): string {
  return String(v || '').trim();
}

function toItem(row: RawClaimRow): BoClaimListItem {
  const incidentDate = norm(row.summary?.incidentDate || row.incidentDate);
  return {
    id: norm(row.id),
    claimNumber: norm(row.claimNumber),
    status: norm(row.status || 'PENDING'),
    statusRank: toRank(row.status),
    policyNumber: norm(row.policyNumber),
    policyHolderName: norm(row.policyHolderName),
    incidentDate,
    reportedDate: norm(row.reportedDate),
    updatedAt: norm(row.updatedAt || row.reportedDate),
    lossCountry: norm(row.summary?.lossCountry),
    certificateReference: norm(row.summary?.certificateReference),
    causeOfLossCode: norm(row.summary?.causeOfLossCode),
    description: norm(row.summary?.description),
    originalCurrency: norm(row.summary?.originalCurrency || 'EUR'),
  };
}

export const claimsAdapter: RecordListAdapter<BoClaimListItem> = {
  capabilities: { totalCount: true, serverSort: true },
  fetchPage: async ({ query, cursor, limit, signal }) => {
    void signal; // api.listClaims does not accept AbortSignal yet

    const offset = Math.max(0, Number(cursor || 0));
    const pageSize = Math.max(1, Number(limit || 12));
    const page = Math.floor(offset / pageSize) + 1;
    const statusFilter = String(query.filters?.status || '').trim().toUpperCase();
    const sorts = Array.isArray(query.sorts) && query.sorts.length ? query.sorts : (query.sort ? [query.sort] : []);
    const primarySort = sorts.find((s) => s?.field);
    const sortBy = String(primarySort?.field || 'reportedDate').trim();
    const sortDir = primarySort?.direction === 'asc' ? 'asc' : 'desc';

    const res = await api.listClaims({
      page,
      pageSize,
      status: statusFilter || undefined,
      search: String(query.search || '').trim() || undefined,
      sortBy,
      sortDir,
    });
    if (!res?.success || !Array.isArray(res?.data)) {
      throw new Error(String(res?.error?.message || 'Failed to load claims'));
    }

    const mapped = (res.data as RawClaimRow[]).map(toItem).filter((x) => x.id);
    const totalFromApi = res.pagination?.total;
    const total = Number.isFinite(Number(totalFromApi)) ? Number(totalFromApi) : mapped.length;
    const nextOffset = offset + mapped.length;
    const hasMore = nextOffset < total;

    return {
      items: mapped,
      hasMore,
      nextCursor: hasMore ? String(nextOffset) : null,
      total,
    };
  },
};


import { accountsApiClient as api } from '@/src/modules/accounts/api/accountsApiClient';
import type { RecordListAdapter } from '@/src/shared/core/recordList/types';
import { toAccountIntelligenceListItem } from '@/src/modules/accounts/model/accountIntelligence';
import type { AccountIntelligenceListItem } from '@/src/modules/accounts/model/accountIntelligence';

export type BoAccountListItem = AccountIntelligenceListItem;

export const accountsAdapter: RecordListAdapter<BoAccountListItem> = {
  capabilities: { totalCount: true, serverSort: true },
  fetchPage: async ({ query, cursor, limit, signal }) => {
    void signal; // api.listAccounts does not accept AbortSignal yet

    const queryWithSorts = query as typeof query & {
      sorts?: Array<{ field?: string; direction?: 'asc' | 'desc' }>;
    };
    const primarySort = (Array.isArray(queryWithSorts.sorts) && queryWithSorts.sorts.length
      ? queryWithSorts.sorts[0]
      : query.sort
    ) as { field?: string; direction?: 'asc' | 'desc' } | undefined;
    const sortField = primarySort?.field ? String(primarySort.field) : 'state';
    const sortDir = primarySort?.direction === 'asc' ? 'asc' : 'desc';

    const isAllowedSortField = (field: string): field is 'state' | 'accountName' | 'lastActivityAt' | 'totalPremium' =>
      field === 'state' || field === 'accountName' || field === 'lastActivityAt' || field === 'totalPremium';
    const effectiveSortField = isAllowedSortField(sortField) ? sortField : 'state';

    const res = await api.listAccountIntelligence({
      cursor,
      limit,
      search: String(query.search || '').trim() || undefined,
      sortField: effectiveSortField,
      sortDir,
    });
    if (!res?.success) {
      throw new Error(String(res?.error?.message || 'Failed to load accounts'));
    }

    const data = (res?.data && typeof res.data === 'object')
      ? (res.data as { items?: unknown[]; hasMore?: boolean; nextCursor?: string; total?: number })
      : null;
    const items: BoAccountListItem[] = (Array.isArray(data?.items) ? data.items : [])
      .map((item) => toAccountIntelligenceListItem(item))
      .filter((item): item is BoAccountListItem => Boolean(item));

    return {
      items,
      hasMore: Boolean(data?.hasMore),
      nextCursor: data?.nextCursor ? String(data.nextCursor) : null,
      total: typeof data?.total === 'number' ? data.total : undefined,
    };
  },
};


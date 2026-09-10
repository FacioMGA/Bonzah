import { useCallback, useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';

import type { ListQueryState, RecordListAdapter, RecordListConfig } from './types';
import { parseListQueryStateFromUrl, writeListQueryStateToUrl } from './urlState';
import { useDebouncedValue } from './useDebouncedValue';

type UseRecordListControllerArgs<TItem> = {
  adapter: RecordListAdapter<TItem>;
  config: RecordListConfig<TItem>;
  limit?: number;
};

function areSortsEqual(
  a: Array<{ field?: string; direction?: 'asc' | 'desc' }> | null | undefined,
  b: Array<{ field?: string; direction?: 'asc' | 'desc' }> | null | undefined
): boolean {
  const left = Array.isArray(a) ? a : [];
  const right = Array.isArray(b) ? b : [];
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    const l = left[i];
    const r = right[i];
    if (String(l?.field || '') !== String(r?.field || '')) return false;
    if ((l?.direction || 'desc') !== (r?.direction || 'desc')) return false;
  }
  return true;
}

function areRecordValuesEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const aKeys = Object.keys(a || {});
  const bKeys = Object.keys(b || {});
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (String(a[key] ?? '') !== String(b[key] ?? '')) return false;
  }
  return true;
}

export function useRecordListController<TItem>(args: UseRecordListControllerArgs<TItem>) {
  const { adapter, config } = args;
  const limit = Number(args.limit || 12);
  const queryClient = useQueryClient();

  const [searchParams, setSearchParams] = useSearchParams();
  const urlSig = useMemo(() => searchParams.toString(), [searchParams]);
  const allowedSortFields = useMemo(
    () =>
      new Set(
        (config.columns || [])
          .filter((c) => Boolean(c.sortable && c.sortField))
          .map((c) => String(c.sortField || '').trim())
          .filter(Boolean)
      ),
    [config.columns]
  );
  const normalizeSorts = useCallback(
    (nextSorts: ListQueryState['sorts'] | null | undefined): ListQueryState['sorts'] => {
      const deduped = new Map<string, ListQueryState['sorts'][number]>();
      for (const s of Array.isArray(nextSorts) ? nextSorts : []) {
        const field = String(s?.field || '').trim();
        if (!field || !allowedSortFields.has(field)) continue;
        if (!deduped.has(field)) {
          deduped.set(field, { field, direction: s.direction === 'asc' ? 'asc' : 'desc' });
        }
        if (deduped.size >= 3) break;
      }
      return Array.from(deduped.values());
    },
    [allowedSortFields]
  );

  const urlQuery = useMemo<ListQueryState>(() => {
    return parseListQueryStateFromUrl(config, searchParams);
  }, [config, searchParams]);

  const [searchInput, setSearchInput] = useState(urlQuery.search);
  const [filters, setFilters] = useState<Record<string, unknown>>(urlQuery.filters);
  const [sorts, setSorts] = useState<ListQueryState['sorts']>(
    normalizeSorts(urlQuery.sorts || (urlQuery.sort ? [urlQuery.sort] : []))
  );

  // Keep local state in sync with URL changes (back/forward, external nav).
  useEffect(() => {
    const nextSearch = urlQuery.search;
    const nextFilters = urlQuery.filters;
    const nextSorts = normalizeSorts(urlQuery.sorts || (urlQuery.sort ? [urlQuery.sort] : []));
    setSearchInput((prev) => (prev === nextSearch ? prev : nextSearch));
    setFilters((prev) => (areRecordValuesEqual(prev || {}, nextFilters || {}) ? prev : nextFilters));
    setSorts((prev) => (areSortsEqual(prev, nextSorts) ? prev : nextSorts));
  }, [normalizeSorts, urlQuery.filters, urlQuery.search, urlQuery.sort, urlQuery.sorts, urlSig]);

  const localQuery: ListQueryState = useMemo(
    () => ({ search: searchInput, filters, sorts, sort: sorts[0] || null }),
    [filters, searchInput, sorts]
  );

  const setSort = useCallback((next: ListQueryState['sort']) => {
    setSorts(normalizeSorts(next?.field ? [next] : []));
  }, [normalizeSorts]);

  // URL-first: write local changes back to URL (query only; paging excluded by design).
  useEffect(() => {
    const nextSp = writeListQueryStateToUrl(config, localQuery, searchParams);
    if (nextSp.toString() !== searchParams.toString()) {
      setSearchParams(nextSp, { replace: true });
    }
  }, [config, localQuery, searchParams, setSearchParams]);

  const { debounced: debouncedSearch, isDebouncing } = useDebouncedValue(searchInput, 250);

  const fetchQuery = useMemo<ListQueryState>(
    () => ({ search: debouncedSearch, filters, sorts, sort: sorts[0] || null }),
    [debouncedSearch, filters, sorts]
  );

  const queryKey = useMemo(() => [config.id, 'recordList', fetchQuery] as const, [config.id, fetchQuery]);

  const q = useInfiniteQuery({
    queryKey,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      return await adapter.fetchPage({
        query: fetchQuery,
        cursor: pageParam,
        limit,
        signal,
      });
    },
    getNextPageParam: (lastPage) => (lastPage?.hasMore ? (lastPage.nextCursor || null) : null),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

  const rows = useMemo(() => {
    const pages = q.data?.pages || [];
    return pages.flatMap((p) => p?.items || []);
  }, [q.data?.pages]);

  const total = q.data?.pages?.[0]?.total;
  const hasMore = Boolean(q.hasNextPage);

  const setFilterValue = useCallback((id: string, value: string) => {
    setFilters((prev) => ({ ...(prev || {}), [id]: value }));
  }, []);

  const clearFilters = useCallback(() => {
    const next: Record<string, unknown> = {};
    for (const f of (config.filters || [])) next[f.id] = String(f.defaultValue || '');
    setFilters(next);
  }, [config.filters]);

  const loadMore = useCallback(async () => {
    if (!q.hasNextPage || q.isFetchingNextPage) return;
    await q.fetchNextPage();
  }, [q]);

  const prefetchMore = useCallback(async () => {
    if (!q.hasNextPage || q.isFetchingNextPage) return;
    // Use fetchNextPage as a simple prefetch mechanism (cached by react-query).
    await q.fetchNextPage();
  }, [q]);

  const invalidate = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey });
  }, [queryClient, queryKey]);

  const countFilters = useCallback(async (
    draftFilters: Record<string, unknown>,
    searchStr: string,
    signal?: AbortSignal,
  ): Promise<number | null> => {
    try {
      const result = await adapter.fetchPage({
        query: { search: searchStr, filters: draftFilters, sorts: [], sort: null },
        cursor: null,
        limit: 1,
        signal,
        wantsTotal: true,
      });
      return typeof result.total === 'number' ? result.total : null;
    } catch {
      return null;
    }
  }, [adapter]);

  return {
    config,
    // Query state
    searchInput,
    setSearchInput,
    filters,
    setFilterValue,
    clearFilters,
    sort: sorts[0] || null,
    setSort,
    sorts,
    setSorts,
    setFilters,
    isDebouncing,

    // Data
    rows,
    total,
    hasMore,
    isFetching: q.isFetching,
    isFetchingMore: q.isFetchingNextPage,
    error: q.error,

    // Actions
    loadMore,
    prefetchMore,
    invalidate,
    countFilters,
  };
}

export type RecordListController<TItem> = ReturnType<typeof useRecordListController<TItem>>;


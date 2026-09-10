/**
 * useUserList — RecordListAdapter<UserRecord>
 *
 * Wraps the access control API into the standard RecordList contract.
 * Used directly by RecordListView as the `adapter` prop.
 */
import { useMemo, useRef } from 'react';
import type { RecordListAdapter, RecordListFetchParams, RecordListFetchResult } from '@/src/shared/core/recordList/types';
import { accessControlApiClient } from '../api/accessControlApiClient';
import type { UserRecord } from '../model/types';

export function useUserListAdapter(): RecordListAdapter<UserRecord> {
  const adapterRef = useRef<RecordListAdapter<UserRecord> | null>(null);

  if (!adapterRef.current) {
    adapterRef.current = {
      capabilities: { totalCount: false, serverSort: false },
      async fetchPage(params: RecordListFetchParams): Promise<RecordListFetchResult<UserRecord>> {
        const { query, cursor, limit, signal } = params;
        const { search, filters } = query;

        // AbortSignal passthrough when supported by the http client
        void signal;

        const result = await accessControlApiClient.listUsers({
          search: search || undefined,
          status: (filters.status as string) || undefined,
          role: (filters.role as string) || undefined,
          userType: (filters.userType as string) || undefined,
          mfaEnabled: filters.mfaEnabled !== undefined ? Boolean(filters.mfaEnabled) : undefined,
          cursor: cursor ?? undefined,
          limit,
        });

        return {
          items: result.items ?? [],
          nextCursor: result.nextCursor,
          hasMore: result.hasMore,
        };
      },
    };
  }

  return adapterRef.current;
}

/** Convenience: memoised version for stable referential identity in components. */
export function useStableUserListAdapter(): RecordListAdapter<UserRecord> {
  return useMemo(() => ({
    capabilities: { totalCount: false, serverSort: false },
    async fetchPage(params: RecordListFetchParams): Promise<RecordListFetchResult<UserRecord>> {
      const { query, cursor, limit } = params;
      const { search, filters } = query;
      const result = await accessControlApiClient.listUsers({
        search: search || undefined,
        status: (filters.status as string) || undefined,
        role: (filters.role as string) || undefined,
        userType: (filters.userType as string) || undefined,
        cursor: cursor ?? undefined,
        limit,
      });
      return { items: result.items ?? [], nextCursor: result.nextCursor, hasMore: result.hasMore };
    },
  }), []);
}

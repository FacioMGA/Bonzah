import { describe, expect, it, vi } from 'vitest';

import { accountsApiClient as api } from '@/src/modules/accounts/api/accountsApiClient';
import { accountsAdapter } from './accountsAdapter';

describe('accountsAdapter', () => {
  it('uses primary sort from query.sorts and maps cursor pagination', async () => {
    const spy = vi.spyOn(api, 'listAccountIntelligence').mockResolvedValue({
      success: true,
      data: {
        items: [{ accountId: 'a1', accountName: 'Acme Ltd', state: 'HEALTHY' }],
        hasMore: true,
        nextCursor: 'c2',
        total: 21,
      },
    });

    const res = await accountsAdapter.fetchPage({
      query: {
        search: 'acme',
        filters: {},
        sorts: [{ field: 'name', direction: 'asc' }],
        sort: null,
      },
      cursor: 'c1',
      limit: 12,
      signal: new AbortController().signal,
    });

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: 'c1',
        limit: 12,
        search: 'acme',
        sortField: 'state',
        sortDir: 'asc',
      })
    );
    expect(res.items).toHaveLength(1);
    expect(res.hasMore).toBe(true);
    expect(res.nextCursor).toBe('c2');
    expect(res.total).toBe(21);
    spy.mockRestore();
  });

  it('throws backend error instead of returning silent empty set', async () => {
    const spy = vi.spyOn(api, 'listAccountIntelligence').mockResolvedValue({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'boom' },
    });

    await expect(
      accountsAdapter.fetchPage({
        query: { search: '', filters: {}, sorts: [], sort: null },
        cursor: null,
        limit: 12,
        signal: new AbortController().signal,
      })
    ).rejects.toThrow('boom');

    spy.mockRestore();
  });
});

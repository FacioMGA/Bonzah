import { afterEach, describe, expect, it, vi } from 'vitest';

import { policiesClient as api } from '@/src/modules/policies/api/policiesClient';
import { policiesAdapter } from './policiesAdapter';

describe('policiesAdapter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps items, preserves cursor pagination, and keeps server order', async () => {
    const okResponse: Awaited<ReturnType<typeof api.listPolicies>> = {
      success: true,
      data: [
        {
          id: 'p2',
          policyId: 'p2',
          status: 'DRAFT',
          updatedAt: '2026-01-01T00:00:00.000Z',
          quoteData: { make: 'Toyota', model: 'Yaris', year: 2020 },
          policyHolder: { contact: JSON.stringify({ firstName: 'A', lastName: 'Z', email: 'a@example.com', phone: '+357' }) },
        },
        {
          id: 'p1',
          policyId: 'p1',
          status: 'INFO_REQUIRED',
          updatedAt: '2025-01-01T00:00:00.000Z',
          vehicleDisplay: '2022 BMW X1',
          policyHolder: { name: 'Test Holder', contact: { firstName: 'B', lastName: 'A' } },
        },
      ],
      pagination: { mode: 'cursor', hasMore: true, nextCursor: 'c2', total: 123 },
    };
    vi.spyOn(api, 'listPolicies').mockResolvedValue(okResponse);

    const res = await policiesAdapter.fetchPage({
      query: { search: '', filters: { status: '' }, sort: null, sorts: [] },
      cursor: null,
      limit: 12,
      signal: new AbortController().signal,
    });

    expect(res.items.map((i) => i.id)).toEqual(['p2', 'p1']);
    expect(res.hasMore).toBe(true);
    expect(res.nextCursor).toBe('c2');
    expect(res.total).toBe(123);

    // basic mapping
    expect(res.items[0].vehicleDisplay).toContain('Toyota');
    expect(res.items[0].policyholderEmail).toBe('a@example.com');
    expect(res.items[1].vehicleDisplay).toContain('BMW');
    expect(res.items[1].policyholderEmail).toBe(null); // absent in second item's contact

  });

  it('omits includeTotal on default page-load fetches (cache-friendly)', async () => {
    const okResponse: Awaited<ReturnType<typeof api.listPolicies>> = {
      success: true,
      data: [],
      pagination: { mode: 'cursor', hasMore: false, nextCursor: null },
    };
    const spy = vi.spyOn(api, 'listPolicies').mockResolvedValue(okResponse);

    await policiesAdapter.fetchPage({
      query: { search: '', filters: {}, sort: null, sorts: [] },
      cursor: null,
      limit: 25,
      signal: new AbortController().signal,
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatchObject({ includeTotal: false });
  });

  it('does not reapply personalized smart sorts after the UI clears sorting', async () => {
    const okResponse: Awaited<ReturnType<typeof api.listPolicies>> = {
      success: true,
      data: [],
      pagination: { mode: 'cursor', hasMore: false, nextCursor: null },
    };
    const spy = vi.spyOn(api, 'listPolicies').mockResolvedValue(okResponse);

    await policiesAdapter.fetchPage({
      query: { search: '', filters: {}, sort: null, sorts: [] },
      cursor: null,
      limit: 25,
      signal: new AbortController().signal,
    });

    expect(spy.mock.calls[0][0]).toMatchObject({ sortField: undefined, sortDir: undefined });
  });

  it('passes includeTotal=true when caller signals wantsTotal', async () => {
    const okResponse: Awaited<ReturnType<typeof api.listPolicies>> = {
      success: true,
      data: [],
      pagination: { mode: 'cursor', hasMore: false, nextCursor: null, total: 7 },
    };
    const spy = vi.spyOn(api, 'listPolicies').mockResolvedValue(okResponse);

    const res = await policiesAdapter.fetchPage({
      query: { search: '', filters: {}, sort: null, sorts: [] },
      cursor: null,
      limit: 1,
      signal: new AbortController().signal,
      wantsTotal: true,
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatchObject({ includeTotal: true });
    expect(res.total).toBe(7);
  });

  it('throws friendly error when backend rejects filter query', async () => {
    const invalidResponse: Awaited<ReturnType<typeof api.listPolicies>> = {
      success: false,
      error: {
        code: 'INVALID_FILTER_QUERY',
        message: 'invalid',
      },
    };
    vi.spyOn(api, 'listPolicies').mockResolvedValue(invalidResponse);
    await expect(
      policiesAdapter.fetchPage({
        query: { search: '', filters: { bad_eq: 'x' }, sort: null, sorts: [] },
        cursor: null,
        limit: 12,
        signal: new AbortController().signal,
      })
    ).rejects.toThrow(/outdated or invalid filters/i);
  });

  it('sends deduped program options as an in-filter', async () => {
    const okResponse: Awaited<ReturnType<typeof api.listPolicies>> = {
      success: true,
      data: [],
      pagination: { mode: 'cursor', hasMore: false, nextCursor: null, total: 0 },
    };
    const spy = vi.spyOn(api, 'listPolicies').mockResolvedValue(okResponse);

    await policiesAdapter.fetchPage({
      query: { search: '', filters: { program_in: 'travel-old,travel-new' }, sort: null, sorts: [] },
      cursor: null,
      limit: 12,
      signal: new AbortController().signal,
      wantsTotal: true,
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]?.filterOps).toMatchObject({
      'f.program.in': 'travel-old,travel-new',
    });
  });
});


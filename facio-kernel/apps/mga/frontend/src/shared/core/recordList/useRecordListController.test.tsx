/* @vitest-environment happy-dom */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useRecordListController } from './useRecordListController';
import type { RecordListController } from './useRecordListController';
import type { RecordListAdapter, RecordListConfig } from './types';

type Row = { id: string };

const config: RecordListConfig<Row> = {
  id: 'policies',
  entityLabel: 'Policies',
  getRowId: (r) => r.id,
  columns: [
    {
      id: 'id',
      header: 'ID',
      render: (r) => r.id,
    },
  ],
  filters: [
    {
      id: 'status',
      label: 'Status',
      type: 'select',
      defaultValue: '',
      urlKey: 'status',
      options: [{ label: 'Active', value: 'ACTIVE' }],
    },
  ],
};

describe('useRecordListController', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('hydrates from URL and writes updates back (debounced search)', async () => {
    vi.useFakeTimers();
    const flush = async () => {
      await act(async () => {
        await Promise.resolve();
        vi.runOnlyPendingTimers();
      });
    };
    const adapter: RecordListAdapter<Row> = {
      capabilities: { totalCount: true, serverSort: false },
      fetchPage: vi.fn(async ({ query, cursor, limit }) => {
        const id = `${String(query.search)}|${String(query.filters.status)}|${String(cursor)}|${String(limit)}`;
        return { items: [{ id }], hasMore: false, nextCursor: null, total: 1 };
      }),
    };

    let controller: RecordListController<Row> | undefined;
    const getController = (): RecordListController<Row> => {
      if (!controller) throw new Error('Controller not initialized');
      return controller;
    };
    let currentSearch = '';

    function LocationSpy() {
      const loc = useLocation();
      currentSearch = loc.search;
      return null;
    }

    function Test() {
      controller = useRecordListController({ adapter, config, limit: 5 });
      return null;
    }

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/policies?q=abc&status=ACTIVE']}>
          <LocationSpy />
          <Test />
        </MemoryRouter>
      </QueryClientProvider>
    );

    await flush();
    await flush();
    expect(vi.mocked(adapter.fetchPage).mock.calls.length).toBeGreaterThan(0);
    expect(getController().searchInput).toBe('abc');
    expect((getController().filters as Record<string, unknown> | undefined)?.status).toBe('ACTIVE');
    expect(currentSearch).toContain('q=abc');
    expect(currentSearch).toContain('status=ACTIVE');

    act(() => {
      getController().setSearchInput('zzz');
    });
    // Search should be written immediately to URL, but fetch is debounced.
    expect(currentSearch).toContain('q=zzz');

    const callsBefore = vi.mocked(adapter.fetchPage).mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(vi.mocked(adapter.fetchPage).mock.calls.length).toBe(callsBefore);

    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    await flush();
    expect(vi.mocked(adapter.fetchPage).mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it('real-timer sanity: debounced search eventually triggers fetch', async () => {
    // Companion test using real timers so we do not rely only on mocked clocks.
    vi.useRealTimers();
    const adapter: RecordListAdapter<Row> = {
      capabilities: { totalCount: true, serverSort: false },
      fetchPage: vi.fn(async ({ query, cursor, limit }) => {
        const id = `${String(query.search)}|${String(query.filters.status)}|${String(cursor)}|${String(limit)}`;
        return { items: [{ id }], hasMore: false, nextCursor: null, total: 1 };
      }),
    };

    let controller: RecordListController<Row> | undefined;
    const getController = (): RecordListController<Row> => {
      if (!controller) throw new Error('Controller not initialized');
      return controller;
    };
    function Test() {
      controller = useRecordListController({ adapter, config, limit: 5 });
      return null;
    }

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/policies?q=abc&status=ACTIVE']}>
          <Test />
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => expect(vi.mocked(adapter.fetchPage).mock.calls.length).toBeGreaterThan(0));
    const callsBefore = vi.mocked(adapter.fetchPage).mock.calls.length;
    act(() => {
      getController().setSearchInput('real-timer-check');
    });
    await waitFor(() => expect(vi.mocked(adapter.fetchPage).mock.calls.length).toBeGreaterThan(callsBefore), { timeout: 2000 });
  });
});


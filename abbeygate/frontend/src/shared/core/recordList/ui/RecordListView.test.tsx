/* @vitest-environment happy-dom */

import React from 'react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';

import { RecordListView } from './RecordListView';
import type { RecordListController } from '@/src/shared/core/recordList/useRecordListController';

type Item = { id: string };

function makeController(overrides?: Partial<RecordListController<Item>>) {
  const controller = {
    config: {
      id: 'test',
      entityLabel: 'Test',
      getRowId: (i: Item) => i.id,
      columns: [
        {
          id: 'throws',
          header: 'Throws',
          render: () => {
            throw new Error('boom');
          },
        },
        {
          id: 'nullish',
          header: 'Nullish',
          render: () => null,
        },
      ],
      filters: [],
    },
    searchInput: '',
    setSearchInput: () => {},
    filters: {},
    setFilterValue: () => {},
    clearFilters: () => {},
    sort: { field: 'updatedAt', direction: 'desc' as const },
    setSort: () => {},
    sorts: [{ field: 'updatedAt', direction: 'desc' as const }],
    setSorts: () => {},
    setFilters: () => {},
    isDebouncing: false,
    rows: [{ id: '1' }],
    total: undefined,
    hasMore: false,
    isFetching: false,
    isFetchingMore: false,
    error: null,
    loadMore: async () => {},
    prefetchMore: async () => {},
    invalidate: async () => {},
    countFilters: async () => null,
    ...(overrides || {}),
  };
  return controller;
}

describe('RecordListView', () => {
  it('renders a placeholder when a column render throws', () => {
    render(
      <MemoryRouter>
        <RecordListView controller={makeController()} />
      </MemoryRouter>
    );

    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1);
  });

  it('renders a placeholder when a column render returns null/undefined', () => {
    render(
      <MemoryRouter>
        <RecordListView controller={makeController()} />
      </MemoryRouter>
    );

    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1);
  });

  it('renders skeleton rows on initial load (no rows + isFetching)', () => {
    render(
      <MemoryRouter>
        <RecordListView controller={makeController({ rows: [], isFetching: true })} />
      </MemoryRouter>
    );

    expect(screen.getAllByTestId('record-list-skeleton-row').length).toBeGreaterThan(0);
    expect(screen.queryByText('No results.')).toBeNull();
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  it('renders the "No results." empty-state when not fetching and no rows', () => {
    render(
      <MemoryRouter>
        <RecordListView controller={makeController({ rows: [], isFetching: false })} />
      </MemoryRouter>
    );

    expect(screen.getByText('No results.')).toBeTruthy();
    expect(screen.queryAllByTestId('record-list-skeleton-row').length).toBe(0);
  });

  it('shows the "Updating…" indicator when refetching with rows already visible', () => {
    render(
      <MemoryRouter>
        <RecordListView controller={makeController({ rows: [{ id: '1' }], isFetching: true })} />
      </MemoryRouter>
    );

    const indicator = screen.getByTestId('record-list-updating');
    expect(indicator).toBeTruthy();
    expect(indicator.getAttribute('role')).toBe('status');
    expect(indicator.getAttribute('aria-live')).toBe('polite');
    expect(indicator.textContent).toContain('Updating');
  });

  it('does not show the "Updating…" indicator when not fetching', () => {
    render(
      <MemoryRouter>
        <RecordListView controller={makeController({ rows: [{ id: '1' }], isFetching: false })} />
      </MemoryRouter>
    );

    expect(screen.queryByTestId('record-list-updating')).toBeNull();
  });
});


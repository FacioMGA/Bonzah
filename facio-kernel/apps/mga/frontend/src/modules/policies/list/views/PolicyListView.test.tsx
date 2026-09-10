/* @vitest-environment happy-dom */

import React from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const controller = {
  filters: { status: 'ACTIVE', status_in: 'ISSUED,ACTIVE' },
  searchInput: '',
  sorts: [],
  sort: null,
  setFilters: vi.fn(),
  setSorts: vi.fn(),
};

const useRecordListControllerMock = vi.fn(() => controller);

vi.mock('@/src/shared/core/recordList/useRecordListController', () => ({
  useRecordListController: useRecordListControllerMock,
}));

vi.mock('@/src/shared/core/recordList/ui/RecordListView', () => ({
  RecordListView: () => <div>Policy list</div>,
}));

vi.mock('../hooks/usePolicyFilterOptions', () => ({
  usePolicyFilterOptions: () => ({ programOptions: [], binderOptions: [] }),
}));

import { PolicyListView } from './PolicyListView';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

describe('PolicyListView feed synchronization', () => {
  beforeEach(() => {
    controller.setFilters.mockClear();
    controller.setSorts.mockClear();
    useRecordListControllerMock.mockClear();
  });

  it('preserves a newly selected manual status when clearing a conflicting feed', async () => {
    render(
      <MemoryRouter initialEntries={['/policies?feed=issued']}>
        <Routes>
          <Route path="/policies" element={<><PolicyListView /><LocationProbe /></>} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe('/policies?status=ACTIVE');
    });
  });

  it('loads the canonical renewal queue view from the Renewals navigation route', async () => {
    render(
      <MemoryRouter initialEntries={['/policies?viewId=renewal_queue']}>
        <Routes>
          <Route path="/policies" element={<><PolicyListView /><LocationProbe /></>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Renewal Queue' })).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toContain('viewId=renewal_queue');
      expect(screen.getByTestId('location').textContent).toContain('status=ACTIVE');
      expect(screen.getByTestId('location').textContent).toContain('sort=expiryDate');
      expect(screen.getByTestId('location').textContent).toContain('sort2=attentionScore');
    });
    expect(useRecordListControllerMock).toHaveBeenCalledTimes(1);
  });
});

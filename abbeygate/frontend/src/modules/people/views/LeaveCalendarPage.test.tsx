/* @vitest-environment happy-dom */

import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  listStaffDirectory: vi.fn(),
  listStaffAbsences: vi.fn(),
  createStaffAbsence: vi.fn(),
  cancelStaffAbsence: vi.fn(),
}));

vi.mock('@/src/surfaces/bo/api/boClient', () => ({ boClient: api }));
vi.mock('@/src/modules/auth/useSession', () => ({ useSession: () => ({ user: { id: 'manager-1' } }) }));
vi.mock('@/src/modules/auth/session', () => ({ hasPermission: () => true }));
vi.mock('@/src/shared/ui', () => ({
  Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  PageHeader: ({ title, subtitle }: { title: string; subtitle: string }) => <header><h1>{title}</h1><p>{subtitle}</p></header>,
}));

import LeaveCalendarPage from './LeaveCalendarPage';

describe('LeaveCalendarPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    api.listStaffDirectory.mockResolvedValue({
      success: true,
      data: [{ id: 'staff-1', name: 'Sophie Dengestinos', email: 'sophie@example.com' }],
    });
    api.listStaffAbsences.mockResolvedValue({
      success: true,
      data: [{
        id: 'absence-1', userId: 'staff-1', absenceType: 'HOLIDAY',
        startDate: '2026-08-19T00:00:00.000Z', endDate: '2026-08-20T00:00:00.000Z',
      }],
    });
    api.cancelStaffAbsence.mockResolvedValue({ success: true, data: { id: 'absence-1', status: 'CANCELLED' } });
  });

  it('renders saved absences across day, week, month, and year calendar grids without writing data', async () => {
    render(<LeaveCalendarPage />);

    const grid = await screen.findByTestId('leave-calendar-grid');
    expect(within(grid).getByText('Sophie Dengestinos')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'month' })).toHaveAttribute('aria-selected', 'true');

    for (const view of ['day', 'week', 'year']) {
      fireEvent.click(screen.getByRole('tab', { name: view }));
      expect(screen.getByRole('tab', { name: view })).toHaveAttribute('aria-selected', 'true');
    }

    await waitFor(() => expect(api.listStaffAbsences).toHaveBeenCalled());
    expect(api.listStaffAbsences).toHaveBeenCalledWith(expect.objectContaining({ limit: 100, offset: 0 }));
    expect(api.createStaffAbsence).not.toHaveBeenCalled();
  });

  it('labels OTHER absences without presenting them as holiday', async () => {
    api.listStaffAbsences.mockResolvedValue({
      success: true,
      data: [{
        id: 'absence-other', userId: 'staff-1', absenceType: 'OTHER',
        startDate: '2026-08-19T00:00:00.000Z', endDate: '2026-08-20T00:00:00.000Z',
      }],
    });
    render(<LeaveCalendarPage />);
    expect(await screen.findByText('Other')).toBeInTheDocument();
    expect(screen.getAllByLabelText(/Other:/)[0]).toHaveClass('bg-violet-100');
  });

  it('confirms and cancels the exact saved absence without deleting it locally', async () => {
    const confirm = vi.fn(() => true);
    Object.defineProperty(window, 'confirm', { configurable: true, value: confirm });
    render(<LeaveCalendarPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel leave' }));

    await waitFor(() => expect(api.cancelStaffAbsence).toHaveBeenCalledWith('absence-1'));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Sophie Dengestinos'));
  });
});

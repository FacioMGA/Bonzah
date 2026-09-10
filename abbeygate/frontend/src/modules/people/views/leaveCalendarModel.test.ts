import { describe, expect, it } from 'vitest';
import type { StaffAbsencePayload } from '@/src/shared/api/boApiClient';
import {
  absenceOverlapsColumn,
  buildLeaveCalendarColumns,
  shiftLeaveCalendarAnchor,
  todayIso,
} from './leaveCalendarModel';

describe('leaveCalendarModel', () => {
  it('builds day, Monday-to-Sunday week, month, and year columns', () => {
    expect(buildLeaveCalendarColumns('day', '2026-08-19').map((column) => column.key)).toEqual(['2026-08-19']);
    expect(buildLeaveCalendarColumns('week', '2026-08-19').map((column) => column.key)).toEqual([
      '2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22', '2026-08-23',
    ]);
    expect(buildLeaveCalendarColumns('month', '2024-02-10')).toHaveLength(29);
    expect(buildLeaveCalendarColumns('year', '2026-08-19')).toHaveLength(12);
  });

  it('clamps month navigation instead of skipping short months', () => {
    expect(shiftLeaveCalendarAnchor('month', '2026-03-31', -1)).toBe('2026-02-28');
    expect(shiftLeaveCalendarAnchor('month', '2024-01-31', 1)).toBe('2024-02-29');
  });

  it('clamps leap-day navigation when changing years', () => {
    expect(shiftLeaveCalendarAnchor('year', '2028-02-29', -1)).toBe('2027-02-28');
    expect(shiftLeaveCalendarAnchor('year', '2028-02-29', 1)).toBe('2029-02-28');
  });

  it('matches multi-day absences to both daily and monthly columns', () => {
    const absence: StaffAbsencePayload = {
      id: 'absence-1', userId: 'staff-1', absenceType: 'HOLIDAY',
      startDate: '2026-08-30T00:00:00.000Z', endDate: '2026-09-02T00:00:00.000Z',
    };
    expect(absenceOverlapsColumn(absence, buildLeaveCalendarColumns('month', '2026-08-15')[29]!)).toBe(true);
    expect(absenceOverlapsColumn(absence, buildLeaveCalendarColumns('year', '2026-08-15')[8]!)).toBe(true);
    expect(absenceOverlapsColumn(absence, buildLeaveCalendarColumns('day', '2026-09-03')[0]!)).toBe(false);
  });

  it('uses local calendar date for the Today control', () => {
    expect(todayIso(new Date(2026, 7, 19, 23, 30))).toBe('2026-08-19');
  });
});

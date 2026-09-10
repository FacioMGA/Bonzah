import type { StaffAbsencePayload } from '@/src/shared/api/boApiClient';

export const LEAVE_CALENDAR_VIEWS = ['day', 'week', 'month', 'year'] as const;
export type LeaveCalendarView = (typeof LEAVE_CALENDAR_VIEWS)[number];

export type LeaveCalendarColumn = {
  key: string;
  startDate: string;
  endDate: string;
  label: string;
};

function isoDate(year: number, monthIndex: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseIsoDate(value: string): { year: number; monthIndex: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, monthIndex, day));
  if (
    candidate.getUTCFullYear() !== year
    || candidate.getUTCMonth() !== monthIndex
    || candidate.getUTCDate() !== day
  ) return null;
  return { year, monthIndex, day };
}

function dateFromParts(parts: { year: number; monthIndex: number; day: number }): Date {
  return new Date(Date.UTC(parts.year, parts.monthIndex, parts.day));
}

function isoFromDate(value: Date): string {
  return isoDate(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

export function todayIso(now = new Date()): string {
  return isoDate(now.getFullYear(), now.getMonth(), now.getDate());
}

export function buildLeaveCalendarColumns(view: LeaveCalendarView, anchorIso: string): LeaveCalendarColumn[] {
  const parts = parseIsoDate(anchorIso);
  if (!parts) return [];

  if (view === 'day') {
    return [{ key: anchorIso, startDate: anchorIso, endDate: anchorIso, label: String(parts.day) }];
  }

  if (view === 'week') {
    const anchor = dateFromParts(parts);
    const mondayOffset = anchor.getUTCDay() === 0 ? -6 : 1 - anchor.getUTCDay();
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(Date.UTC(parts.year, parts.monthIndex, parts.day + mondayOffset + index));
      const value = isoFromDate(date);
      return { key: value, startDate: value, endDate: value, label: String(date.getUTCDate()) };
    });
  }

  if (view === 'month') {
    const dayCount = new Date(Date.UTC(parts.year, parts.monthIndex + 1, 0)).getUTCDate();
    return Array.from({ length: dayCount }, (_, index) => {
      const value = isoDate(parts.year, parts.monthIndex, index + 1);
      return { key: value, startDate: value, endDate: value, label: String(index + 1) };
    });
  }

  return Array.from({ length: 12 }, (_, monthIndex) => {
    const startDate = isoDate(parts.year, monthIndex, 1);
    const lastDay = new Date(Date.UTC(parts.year, monthIndex + 1, 0)).getUTCDate();
    return {
      key: startDate,
      startDate,
      endDate: isoDate(parts.year, monthIndex, lastDay),
      label: new Date(Date.UTC(parts.year, monthIndex, 1)).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }),
    };
  });
}

export function shiftLeaveCalendarAnchor(view: LeaveCalendarView, anchorIso: string, direction: -1 | 1): string {
  const parts = parseIsoDate(anchorIso);
  if (!parts) return anchorIso;

  if (view === 'day' || view === 'week') {
    const amount = view === 'day' ? direction : direction * 7;
    return isoFromDate(new Date(Date.UTC(parts.year, parts.monthIndex, parts.day + amount)));
  }

  if (view === 'year') {
    const targetYear = parts.year + direction;
    const lastTargetDay = new Date(Date.UTC(targetYear, parts.monthIndex + 1, 0)).getUTCDate();
    return isoDate(targetYear, parts.monthIndex, Math.min(parts.day, lastTargetDay));
  }

  const targetMonth = new Date(Date.UTC(parts.year, parts.monthIndex + direction, 1));
  const lastTargetDay = new Date(Date.UTC(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth() + 1, 0)).getUTCDate();
  return isoDate(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth(), Math.min(parts.day, lastTargetDay));
}

function absenceBoundary(value: string): string | null {
  const parts = parseIsoDate(value);
  return parts ? isoDate(parts.year, parts.monthIndex, parts.day) : null;
}

export function absenceOverlapsColumn(absence: StaffAbsencePayload, column: LeaveCalendarColumn): boolean {
  const startDate = absenceBoundary(absence.startDate);
  const endDate = absenceBoundary(absence.endDate);
  return Boolean(startDate && endDate && startDate <= column.endDate && endDate >= column.startDate);
}

export function calendarAnchorLabel(view: LeaveCalendarView, anchorIso: string): string {
  const parts = parseIsoDate(anchorIso);
  if (!parts) return anchorIso;
  const date = dateFromParts(parts);
  if (view === 'year') return String(parts.year);
  if (view === 'month') return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  if (view === 'week') {
    const columns = buildLeaveCalendarColumns('week', anchorIso);
    return `${columns[0]?.startDate ?? anchorIso} – ${columns[6]?.endDate ?? anchorIso}`;
  }
  return date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

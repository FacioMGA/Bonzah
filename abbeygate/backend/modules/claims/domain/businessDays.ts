/**
 * Working-day arithmetic for statutory claim deadlines.
 *
 * All arithmetic is done in UTC so results are deterministic regardless of
 * the host timezone. Weekends (Saturday/Sunday) are always non-working. A
 * jurisdiction-specific public-holiday set may be supplied; it is NOT
 * hard-coded here because the official Portugal calendar is still an OPEN
 * input pending confirmation from Abbeygate (see ADR-0065). Until it is
 * supplied the calendar is empty (weekends-only), which is a documented
 * interim, not a silent default.
 */

export interface WorkingDayCalendar {
  /** ISO `yyyy-mm-dd` dates treated as public holidays (non-working). */
  holidays?: ReadonlySet<string>;
}

function startOfUtcDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export function toIsoDay(date: Date): string {
  return startOfUtcDay(date).toISOString().slice(0, 10);
}

export function isWorkingDay(date: Date, calendar?: WorkingDayCalendar): boolean {
  const weekday = date.getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  if (calendar?.holidays?.has(toIsoDay(date))) return false;
  return true;
}

/**
 * Add `count` working days to `from`. The anchor day is day 0 (never
 * counted, even if it is itself a working day); the first working day
 * strictly after the anchor is day 1. The result is normalised to the
 * start of the UTC day. `count` must be a non-negative finite number.
 */
export function addWorkingDays(from: Date, count: number, calendar?: WorkingDayCalendar): Date {
  if (!Number.isFinite(count) || count < 0) {
    throw new Error(`addWorkingDays: count must be a non-negative finite number, received ${count}`);
  }
  const cursor = startOfUtcDay(from);
  let remaining = Math.floor(count);
  while (remaining > 0) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (isWorkingDay(cursor, calendar)) remaining -= 1;
  }
  return cursor;
}

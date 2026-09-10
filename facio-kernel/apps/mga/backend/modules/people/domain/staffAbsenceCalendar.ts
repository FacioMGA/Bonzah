/**
 * Staff-wide leave calendar projection. Notes and creator metadata stay off
 * this shape — sickness detail is not a staff-wide field.
 */
export const STAFF_ABSENCE_CALENDAR_SELECT = {
  id: true,
  userId: true,
  absenceType: true,
  startDate: true,
  endDate: true,
  status: true,
} as const;

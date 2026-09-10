import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { can } from '../../../accessControl/domain/permissions.js';
import { UNDERWRITER_PERMISSIONS } from '../../../accessControl/domain/permissionTaxonomy.js';
import { STAFF_ABSENCE_CALENDAR_SELECT } from '../../app/staffAbsenceCalendar.js';

describe('people access (ABY-434/435)', () => {
  it('forbids leave create without people.leave.edit', () => {
    const staff = [...UNDERWRITER_PERMISSIONS].map((key) => ({ key }));
    expect(can(staff, 'people.leave.edit')).toBe(false);
    expect(can([{ key: 'people.leave.edit' }], 'people.leave.edit')).toBe(true);
  });

  it('keeps leave cancellation separate from leave creation', () => {
    expect(can([{ key: 'people.leave.edit' }], 'people.leave.cancel')).toBe(false);
    expect(can([{ key: 'people.leave.cancel' }], 'people.leave.edit')).toBe(false);
    expect(can([{ key: 'people.leave.cancel' }], 'people.leave.cancel')).toBe(true);
  });

  it('lets every staff member view STAFF diaries and the leave calendar', () => {
    expect(UNDERWRITER_PERMISSIONS.has('people.diary.view')).toBe(true);
    expect(UNDERWRITER_PERMISSIONS.has('people.leave.view')).toBe(true);
  });

  it('does not expose absence notes on the staff-wide calendar', () => {
    expect(STAFF_ABSENCE_CALENDAR_SELECT).toEqual({
      id: true,
      userId: true,
      absenceType: true,
      startDate: true,
      endDate: true,
      status: true,
    });
    expect('notes' in STAFF_ABSENCE_CALENDAR_SELECT).toBe(false);
    expect('createdByUserId' in STAFF_ABSENCE_CALENDAR_SELECT).toBe(false);
  });

  it('records the cancelling operator in the canonical audit log', () => {
    const routerSource = readFileSync(path.resolve(process.cwd(), 'backend/modules/people/http/peopleRouter.ts'), 'utf8');
    expect(routerSource).toContain("'PEOPLE.LEAVE.CANCELLED'");
    expect(routerSource).toContain('userIdOrThrow(req.user)');
    expect(routerSource).toContain("'STAFF_ABSENCE'");
  });
});

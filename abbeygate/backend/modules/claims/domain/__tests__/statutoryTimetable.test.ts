import { describe, expect, it } from 'vitest';
import { addWorkingDays, isWorkingDay } from '../businessDays.js';
import {
  computeStatutoryTimetable,
  type StatutoryDeadlineItem,
} from '../statutoryTimetable.js';
import { resolveJurisdictionProductConfig } from '../../../jurisdiction/domain/productConfiguration.js';

// PT/MOTOR carries the DL 291/2007 timetable; resolve it once and drive the
// engine tests from the real jurisdiction config so config + engine are
// exercised together.
const PT = (() => {
  const cfg = resolveJurisdictionProductConfig({ productCode: 'MOTOR', source: { countryCode: 'PT' } });
  const nonFaultMotor = cfg.claimsHandling?.nonFaultMotor;
  if (!cfg.claimsHandling || !nonFaultMotor) {
    throw new Error('expected PT/MOTOR jurisdiction config to carry claimsHandling.nonFaultMotor');
  }
  return { ref: cfg.claimsHandling.regulatoryReference, deadlines: nonFaultMotor };
})();

// 2026-06-01 is a Monday (weekends-only calendar, no holidays supplied).
const ANCHOR = new Date('2026-06-01T09:00:00.000Z');
const BEFORE = new Date('2026-06-01T00:00:00.000Z');

function dueDate(items: StatutoryDeadlineItem[], key: StatutoryDeadlineItem['key']): string | null {
  const item = items.find((i) => i.key === key);
  if (!item) throw new Error(`missing item ${key}`);
  return item.dueDate;
}

function statusOf(items: StatutoryDeadlineItem[], key: StatutoryDeadlineItem['key']): string {
  const item = items.find((i) => i.key === key);
  if (!item) throw new Error(`missing item ${key}`);
  return item.status;
}

describe('businessDays.addWorkingDays', () => {
  it('skips weekends', () => {
    // Friday 2026-06-05 + 1 working day = Monday 2026-06-08.
    expect(addWorkingDays(new Date('2026-06-05T00:00:00.000Z'), 1).toISOString()).toBe(
      '2026-06-08T00:00:00.000Z',
    );
  });

  it('does not count the anchor day itself', () => {
    expect(addWorkingDays(new Date('2026-06-01T00:00:00.000Z'), 0).toISOString()).toBe(
      '2026-06-01T00:00:00.000Z',
    );
  });

  it('skips supplied public holidays', () => {
    const calendar = { holidays: new Set(['2026-06-08']) };
    // Friday + 1 would be Monday 08, but 08 is a holiday → Tuesday 09.
    expect(addWorkingDays(new Date('2026-06-05T00:00:00.000Z'), 1, calendar).toISOString()).toBe(
      '2026-06-09T00:00:00.000Z',
    );
  });

  it('rejects negative counts', () => {
    expect(() => addWorkingDays(new Date('2026-06-01T00:00:00.000Z'), -1)).toThrow();
  });

  it('treats weekends as non-working', () => {
    expect(isWorkingDay(new Date('2026-06-06T00:00:00.000Z'))).toBe(false); // Saturday
    expect(isWorkingDay(new Date('2026-06-08T00:00:00.000Z'))).toBe(true); // Monday
  });
});

describe('PT/MOTOR DL 291/2007 config', () => {
  it('carries the statutory working-day counts', () => {
    expect(PT.ref).toBe('DL 291/2007');
    expect(PT.deadlines.contactWorkingDays).toBe(2);
    expect(PT.deadlines.inspection).toEqual({ standard: 8, withDismantling: 12, daaa: 4, daaaWithDismantling: 6 });
    expect(PT.deadlines.inspectionReport).toEqual({ standard: 4, daaa: 2 });
    expect(PT.deadlines.liabilityDecision).toEqual({ standard: 30, daaa: 15 });
    expect(PT.deadlines.paymentWorkingDays).toBe(8);
    expect(PT.deadlines.complaintResponseWorkingDays).toBe(20);
  });

  it('is absent for CY/MOTOR (no encoded statutory timetable)', () => {
    const cy = resolveJurisdictionProductConfig({ productCode: 'MOTOR', source: { countryCode: 'CY' } });
    expect(cy.claimsHandling).toBeUndefined();
  });
});

describe('computeStatutoryTimetable — standard (no DAAA, no dismantling)', () => {
  const t = computeStatutoryTimetable({
    deadlines: PT.deadlines,
    regulatoryReference: PT.ref,
    anchorDate: ANCHOR,
    now: BEFORE,
  });

  it('computes the golden due dates from a Monday anchor', () => {
    expect(dueDate(t.items, 'FIRST_CONTACT')).toBe('2026-06-03T00:00:00.000Z');
    expect(dueDate(t.items, 'INSPECTION_COMPLETION')).toBe('2026-06-15T00:00:00.000Z');
    expect(dueDate(t.items, 'LIABILITY_DECISION')).toBe('2026-07-15T00:00:00.000Z');
  });

  it('leaves report, payment and complaint NOT_STARTED until their prerequisites exist', () => {
    // The report clock only runs from an ACTUAL inspection completion.
    expect(dueDate(t.items, 'INSPECTION_REPORT')).toBeNull();
    expect(statusOf(t.items, 'INSPECTION_REPORT')).toBe('NOT_STARTED');
    expect(dueDate(t.items, 'PAYMENT')).toBeNull();
    expect(statusOf(t.items, 'PAYMENT')).toBe('NOT_STARTED');
    expect(dueDate(t.items, 'COMPLAINT_RESPONSE')).toBeNull();
    expect(statusOf(t.items, 'COMPLAINT_RESPONSE')).toBe('NOT_STARTED');
  });
});

describe('computeStatutoryTimetable — inspection report anchors to actual completion', () => {
  it('runs the report clock from the supplied completion timestamp', () => {
    const t = computeStatutoryTimetable({
      deadlines: PT.deadlines,
      regulatoryReference: PT.ref,
      anchorDate: ANCHOR,
      // Actual completion earlier than the projected 2026-06-15 deadline.
      inspectionCompletedAt: new Date('2026-06-10T14:00:00.000Z'),
      now: BEFORE,
    });
    // 4 working days after Wed 2026-06-10 = Tue 2026-06-16 (not 06-19, which
    // the old projected-deadline anchor would have produced).
    expect(dueDate(t.items, 'INSPECTION_REPORT')).toBe('2026-06-16T00:00:00.000Z');
    expect(statusOf(t.items, 'INSPECTION_REPORT')).toBe('ON_TRACK');
  });
});

describe('computeStatutoryTimetable — jointly signed DAAA shortens deadlines', () => {
  const t = computeStatutoryTimetable({
    deadlines: PT.deadlines,
    regulatoryReference: PT.ref,
    anchorDate: ANCHOR,
    daaaSigned: true,
    now: BEFORE,
  });

  it('uses the DAAA inspection/liability windows', () => {
    expect(dueDate(t.items, 'INSPECTION_COMPLETION')).toBe('2026-06-09T00:00:00.000Z');
    expect(dueDate(t.items, 'LIABILITY_DECISION')).toBe('2026-06-24T00:00:00.000Z');
  });
});

describe('computeStatutoryTimetable — dismantling extends inspection', () => {
  it('uses 12 working days without DAAA', () => {
    const t = computeStatutoryTimetable({
      deadlines: PT.deadlines,
      regulatoryReference: PT.ref,
      anchorDate: ANCHOR,
      dismantlingRequired: true,
      now: BEFORE,
    });
    expect(dueDate(t.items, 'INSPECTION_COMPLETION')).toBe('2026-06-19T00:00:00.000Z');
  });

  it('uses 6 working days with DAAA', () => {
    const t = computeStatutoryTimetable({
      deadlines: PT.deadlines,
      regulatoryReference: PT.ref,
      anchorDate: ANCHOR,
      dismantlingRequired: true,
      daaaSigned: true,
      now: BEFORE,
    });
    expect(dueDate(t.items, 'INSPECTION_COMPLETION')).toBe('2026-06-11T00:00:00.000Z');
  });
});

describe('computeStatutoryTimetable — payment clock', () => {
  it('starts from the later of liability acceptance and payment documents', () => {
    const t = computeStatutoryTimetable({
      deadlines: PT.deadlines,
      regulatoryReference: PT.ref,
      anchorDate: ANCHOR,
      liabilityAcceptedAt: new Date('2026-07-15T00:00:00.000Z'),
      paymentDocumentsSuppliedAt: new Date('2026-07-15T00:00:00.000Z'),
      now: BEFORE,
    });
    // 8 working days after Wed 2026-07-15 = Mon 2026-07-27.
    expect(dueDate(t.items, 'PAYMENT')).toBe('2026-07-27T00:00:00.000Z');
    expect(statusOf(t.items, 'PAYMENT')).toBe('ON_TRACK');
  });
});

describe('computeStatutoryTimetable — status transitions', () => {
  it('flags overdue and on-track relative to now', () => {
    const t = computeStatutoryTimetable({
      deadlines: PT.deadlines,
      regulatoryReference: PT.ref,
      anchorDate: ANCHOR,
      now: new Date('2026-06-04T00:00:00.000Z'),
    });
    // First contact was due 2026-06-03 → overdue on the 4th.
    expect(statusOf(t.items, 'FIRST_CONTACT')).toBe('OVERDUE');
    // Liability decision (2026-07-15) is far out → on track.
    expect(statusOf(t.items, 'LIABILITY_DECISION')).toBe('ON_TRACK');
  });

  it('flags due-soon within the configured window', () => {
    const t = computeStatutoryTimetable({
      deadlines: PT.deadlines,
      regulatoryReference: PT.ref,
      anchorDate: ANCHOR,
      now: BEFORE,
    });
    // Contact due 2026-06-03 is within 2 working days of the 1st → due soon.
    expect(statusOf(t.items, 'FIRST_CONTACT')).toBe('DUE_SOON');
  });

  it('keeps an item open for the whole due day (not overdue mid-morning)', () => {
    const t = computeStatutoryTimetable({
      deadlines: PT.deadlines,
      regulatoryReference: PT.ref,
      anchorDate: ANCHOR,
      // 09:00 on the FIRST_CONTACT due date (2026-06-03) — the working day
      // has not ended, so it must not be OVERDUE yet.
      now: new Date('2026-06-03T09:00:00.000Z'),
    });
    expect(statusOf(t.items, 'FIRST_CONTACT')).not.toBe('OVERDUE');
    expect(statusOf(t.items, 'FIRST_CONTACT')).toBe('DUE_SOON');
  });
});

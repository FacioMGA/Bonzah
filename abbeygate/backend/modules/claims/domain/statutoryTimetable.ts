import type { NonFaultMotorClaimsDeadlines } from '../../jurisdiction/domain/productConfiguration.js';
import { addWorkingDays, type WorkingDayCalendar } from './businessDays.js';

/**
 * Pure computation of the DL 291/2007 non-fault motor claims-handling
 * timetable. Deadlines are projected from the timestamp the responsible
 * third-party insurer first received notification (the statutory anchor —
 * NOT the claim creation date, per Peter Sheppard ABB/VL/00118). The
 * function is side-effect free; recalculation, audit history, diary
 * seeding and escalation are layered on top in later phases.
 *
 * Legal values come from `JurisdictionProductConfig.claimsHandling`
 * (LEGAL-VERIFY). This engine only does the arithmetic.
 */

export type StatutoryDeadlineStatus =
  | 'NOT_STARTED'
  | 'ON_TRACK'
  | 'DUE_SOON'
  | 'OVERDUE';

export interface StatutoryDeadlineItem {
  key:
    | 'FIRST_CONTACT'
    | 'INSPECTION_COMPLETION'
    | 'INSPECTION_REPORT'
    | 'LIABILITY_DECISION'
    | 'PAYMENT'
    | 'COMPLAINT_RESPONSE';
  label: string;
  articles?: string[];
  /** ISO timestamp of the due date, or null when the item has not started. */
  dueDate: string | null;
  status: StatutoryDeadlineStatus;
  /** Human-readable explanation of how the due date was derived. */
  basis: string;
}

export interface StatutoryTimetableInput {
  deadlines: NonFaultMotorClaimsDeadlines;
  regulatoryReference: string;
  /** Timestamp the responsible third-party insurer first received notification. */
  anchorDate: Date;
  daaaSigned?: boolean;
  dismantlingRequired?: boolean;
  /** Timestamp the inspection was actually completed (anchors the report clock). */
  inspectionCompletedAt?: Date | null;
  liabilityAcceptedAt?: Date | null;
  paymentDocumentsSuppliedAt?: Date | null;
  formalComplaintSentAt?: Date | null;
  /** Defaults to `new Date()`. */
  now?: Date;
  calendar?: WorkingDayCalendar;
  /** Working days out at which an item flips to DUE_SOON. Default 2. */
  dueSoonWorkingDays?: number;
}

export interface StatutoryTimetable {
  regulatoryReference: string;
  anchorDate: string;
  daaaSigned: boolean;
  dismantlingRequired: boolean;
  items: StatutoryDeadlineItem[];
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function statusFor(
  dueDate: Date,
  now: Date,
  calendar: WorkingDayCalendar | undefined,
  dueSoonWorkingDays: number,
): Exclude<StatutoryDeadlineStatus, 'NOT_STARTED'> {
  // Deadlines are day-granular: an item is only OVERDUE once the whole due
  // day has passed. Due dates are normalised to 00:00Z, so we compare the
  // start of `now`'s UTC day — otherwise 09:00 on the due date would falsely
  // read OVERDUE and raise a premature statutory breach.
  const today = startOfUtcDay(now);
  if (today.getTime() > dueDate.getTime()) return 'OVERDUE';
  const dueSoonEdge = addWorkingDays(today, dueSoonWorkingDays, calendar);
  if (dueSoonEdge.getTime() >= dueDate.getTime()) return 'DUE_SOON';
  return 'ON_TRACK';
}

export function computeStatutoryTimetable(input: StatutoryTimetableInput): StatutoryTimetable {
  const {
    deadlines,
    regulatoryReference,
    anchorDate,
    daaaSigned = false,
    dismantlingRequired = false,
    inspectionCompletedAt = null,
    liabilityAcceptedAt = null,
    paymentDocumentsSuppliedAt = null,
    formalComplaintSentAt = null,
    now = new Date(),
    calendar,
    dueSoonWorkingDays = 2,
  } = input;

  const articles = deadlines.articles;

  // First contact + arrange inspection: N working days from notification.
  const contactDue = addWorkingDays(anchorDate, deadlines.contactWorkingDays, calendar);

  // Inspection completion: counted after the contact period, with DAAA and
  // dismantling variants.
  const inspectionDays = daaaSigned
    ? dismantlingRequired
      ? deadlines.inspection.daaaWithDismantling
      : deadlines.inspection.daaa
    : dismantlingRequired
      ? deadlines.inspection.withDismantling
      : deadlines.inspection.standard;
  const inspectionDue = addWorkingDays(contactDue, inspectionDays, calendar);

  // Inspection report: the clock runs from ACTUAL inspection completion, not
  // the projected inspection deadline. Until a real completion timestamp
  // exists the item is NOT_STARTED (an early inspection must not inherit a
  // late report deadline, nor a late one a deadline already in the past).
  const reportDays = daaaSigned ? deadlines.inspectionReport.daaa : deadlines.inspectionReport.standard;

  // Liability decision: after expiry of the initial contact period.
  const liabilityDays = daaaSigned ? deadlines.liabilityDecision.daaa : deadlines.liabilityDecision.standard;
  const liabilityDue = addWorkingDays(contactDue, liabilityDays, calendar);

  const items: StatutoryDeadlineItem[] = [
    {
      key: 'FIRST_CONTACT',
      label: 'First contact and arrange inspection',
      articles,
      dueDate: contactDue.toISOString(),
      status: statusFor(contactDue, now, calendar, dueSoonWorkingDays),
      basis: `${deadlines.contactWorkingDays} working days from third-party insurer notification`,
    },
    {
      key: 'INSPECTION_COMPLETION',
      label: 'Complete inspection',
      articles,
      dueDate: inspectionDue.toISOString(),
      status: statusFor(inspectionDue, now, calendar, dueSoonWorkingDays),
      basis: `${inspectionDays} working days after the contact period${daaaSigned ? ' (jointly signed DAAA)' : ''}${dismantlingRequired ? ' (dismantling required)' : ''}`,
    },
    inspectionCompletedAt
      ? {
          key: 'INSPECTION_REPORT' as const,
          label: 'Inspection report available',
          articles,
          dueDate: addWorkingDays(inspectionCompletedAt, reportDays, calendar).toISOString(),
          status: statusFor(
            addWorkingDays(inspectionCompletedAt, reportDays, calendar),
            now,
            calendar,
            dueSoonWorkingDays,
          ),
          basis: `${reportDays} working days after actual inspection completion${daaaSigned ? ' (jointly signed DAAA)' : ''}`,
        }
      : {
          key: 'INSPECTION_REPORT' as const,
          label: 'Inspection report available',
          articles,
          dueDate: null,
          status: 'NOT_STARTED' as const,
          basis: 'Starts once the inspection is actually completed',
        },
    {
      key: 'LIABILITY_DECISION',
      label: 'Communicate liability decision',
      articles,
      dueDate: liabilityDue.toISOString(),
      status: statusFor(liabilityDue, now, calendar, dueSoonWorkingDays),
      basis: `${liabilityDays} working days after the contact period${daaaSigned ? ' (jointly signed DAAA)' : ''}`,
    },
  ];

  // Payment: only starts once liability is accepted AND the required payment
  // documents have been supplied. Absent either, the clock has not started.
  if (liabilityAcceptedAt && paymentDocumentsSuppliedAt) {
    const paymentAnchor =
      liabilityAcceptedAt.getTime() >= paymentDocumentsSuppliedAt.getTime()
        ? liabilityAcceptedAt
        : paymentDocumentsSuppliedAt;
    const paymentDue = addWorkingDays(paymentAnchor, deadlines.paymentWorkingDays, calendar);
    items.push({
      key: 'PAYMENT',
      label: 'Pay compensation',
      articles,
      dueDate: paymentDue.toISOString(),
      status: statusFor(paymentDue, now, calendar, dueSoonWorkingDays),
      basis: `${deadlines.paymentWorkingDays} working days after accepted liability and receipt of payment documents`,
    });
  } else {
    items.push({
      key: 'PAYMENT',
      label: 'Pay compensation',
      articles,
      dueDate: null,
      status: 'NOT_STARTED',
      basis: 'Starts once liability is accepted and payment documents are supplied',
    });
  }

  // Complaint response: only relevant once a formal complaint has been sent.
  if (formalComplaintSentAt) {
    const complaintDue = addWorkingDays(
      formalComplaintSentAt,
      deadlines.complaintResponseWorkingDays,
      calendar,
    );
    items.push({
      key: 'COMPLAINT_RESPONSE',
      label: 'Complete and reasoned complaint response',
      articles,
      dueDate: complaintDue.toISOString(),
      status: statusFor(complaintDue, now, calendar, dueSoonWorkingDays),
      basis: `${deadlines.complaintResponseWorkingDays} working days after the formal complaint`,
    });
  } else {
    items.push({
      key: 'COMPLAINT_RESPONSE',
      label: 'Complete and reasoned complaint response',
      articles,
      dueDate: null,
      status: 'NOT_STARTED',
      basis: 'Starts once a formal complaint is sent',
    });
  }

  return {
    regulatoryReference,
    anchorDate: anchorDate.toISOString(),
    daaaSigned,
    dismantlingRequired,
    items,
  };
}

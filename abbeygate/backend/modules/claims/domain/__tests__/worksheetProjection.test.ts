import { describe, expect, it } from 'vitest';
import { buildClaimWorksheetProjection, periodFinancialProjection } from '../worksheetProjection.js';

function event(args: {
  id: string;
  eventType: string;
  occurredAt: string;
  payload?: Record<string, unknown>;
}) {
  return {
    id: args.id,
    eventType: args.eventType,
    occurredAt: new Date(args.occurredAt),
    payload: args.payload || {},
    actorName: 'tester',
  };
}

describe('worksheetProjection', () => {
  it('keeps claims pending until a claim-opened event exists', () => {
    const projection = buildClaimWorksheetProjection({
      claimId: 'c-pending',
      claimReference: 'CLM-PENDING',
      certificateReference: 'CERT-PENDING',
      events: [],
    });
    expect(projection.status).toBe('PENDING');
    expect(projection.phase).toBe('INTAKE');
  });

  it('derives open paid/fees outstanding status for atomic bucket events', () => {
    const events = [
      event({ id: '1', eventType: 'CLAIM_OPENED', occurredAt: '2026-02-01T00:00:00.000Z' }),
      event({ id: '2', eventType: 'RESERVE_SET', occurredAt: '2026-02-02T00:00:00.000Z', payload: { bucket: 'INDEMNITY', newOutstandingAmount: 1000 } }),
      event({ id: '3', eventType: 'RESERVE_SET', occurredAt: '2026-02-02T00:00:00.000Z', payload: { bucket: 'LEGAL_FEES', newOutstandingAmount: 200 } }),
      event({ id: '4', eventType: 'PAYMENT_ADDED', occurredAt: '2026-02-10T00:00:00.000Z', payload: { bucket: 'INDEMNITY', amount: 1000, autoReduceReserve: false } }),
      event({ id: '5', eventType: 'RESERVE_SET', occurredAt: '2026-02-10T01:00:00.000Z', payload: { bucket: 'INDEMNITY', newOutstandingAmount: 0 } }),
    ];
    const p = buildClaimWorksheetProjection({
      claimId: 'c1',
      claimReference: 'CLM-1',
      certificateReference: 'CERT-1',
      events,
    });
    expect(p.status).toBe('OPEN_CLAIM_PAID_FEES_OUTSTANDING');
    expect(p.totalIncurred).toBe(1200);
    expect(p.buckets.LEGAL_FEES.outstanding).toBe(200);
  });

  it('keeps historical payment events read-only while current-period writes use PAYMENT_ADDED', () => {
    const events = [
      event({ id: '1', eventType: 'PAYMENT_INDEMNITY', occurredAt: '2026-01-10T00:00:00.000Z', payload: { amount: 500 } }),
      event({ id: '2', eventType: 'PAYMENT_ADDED', occurredAt: '2026-02-03T00:00:00.000Z', payload: { bucket: 'INDEMNITY', amount: 300, autoReduceReserve: false } }),
      event({ id: '3', eventType: 'PAYMENT_ADDED', occurredAt: '2026-02-11T00:00:00.000Z', payload: { bucket: 'LEGAL_FEES', amount: 100, autoReduceReserve: false } }),
      event({ id: '4', eventType: 'RESERVE_SET', occurredAt: '2026-02-15T00:00:00.000Z', payload: { bucket: 'INDEMNITY', newOutstandingAmount: 700 } }),
      event({ id: '5', eventType: 'RESERVE_SET', occurredAt: '2026-02-15T00:00:00.000Z', payload: { bucket: 'LEGAL_FEES', newOutstandingAmount: 50 } }),
    ];
    const f = periodFinancialProjection({
      events,
      startDate: new Date('2026-02-01T00:00:00.000Z'),
      endDate: new Date('2026-02-28T23:59:59.999Z'),
    });
    expect(f.paidThisPeriodIndemnity).toBe(300);
    expect(f.previouslyPaidIndemnity).toBe(500);
    expect(f.reserveIndemnityAtEnd).toBe(700);
    expect(f.totalIncurredIndemnity).toBe(1500);
    expect(f.totalIncurredFees).toBe(150);
  });

  it('treats defence costs as indemnity in worksheet totals and period rollups', () => {
    const events = [
      event({ id: '1', eventType: 'RESERVE_SET', occurredAt: '2026-02-01T00:00:00.000Z', payload: { bucket: 'DEFENCE_COSTS', newOutstandingAmount: 300 } }),
      event({ id: '2', eventType: 'PAYMENT_ADDED', occurredAt: '2026-02-03T00:00:00.000Z', payload: { bucket: 'DEFENCE_COSTS', amount: 120, autoReduceReserve: false, reportingTreatment: 'indemnity' } }),
      event({ id: '3', eventType: 'RESERVE_SET', occurredAt: '2026-02-15T00:00:00.000Z', payload: { bucket: 'DEFENCE_COSTS', newOutstandingAmount: 180 } }),
    ];
    const projection = buildClaimWorksheetProjection({
      claimId: 'c-def',
      claimReference: 'CLM-DEF',
      certificateReference: 'CERT-DEF',
      events,
    });
    expect(projection.paidIndemnity).toBe(120);
    expect(projection.reserveIndemnity).toBe(180);
    expect(projection.paidFees).toBe(0);
    expect(projection.reserveFees).toBe(0);

    const period = periodFinancialProjection({
      events,
      startDate: new Date('2026-02-01T00:00:00.000Z'),
      endDate: new Date('2026-02-28T23:59:59.999Z'),
    });
    expect(period.paidThisPeriodIndemnity).toBe(120);
    expect(period.paidThisPeriodFees).toBe(0);
    expect(period.reserveIndemnityAtEnd).toBe(180);
    expect(period.reserveFeesAtEnd).toBe(0);
  });

  it('derives intake lifecycle and reconfirm requirement after amendment', () => {
    const events = [
      event({
        id: '1',
        eventType: 'FNOL_SUBMITTED',
        occurredAt: '2026-03-01T10:00:00.000Z',
        payload: { version: 1, fnol: { incident: { type: 'collision', date: '2026-03-01', location: { address: 'Nicosia' }, description: 'Rear-ended by third party' } } },
      }),
      event({ id: '2', eventType: 'FNOL_CONFIRMED', occurredAt: '2026-03-01T10:05:00.000Z', payload: { confirmedVersion: 1 } }),
      event({
        id: '3',
        eventType: 'FNOL_AMENDED',
        occurredAt: '2026-03-02T10:00:00.000Z',
        payload: { fromVersion: 1, toVersion: 2, fnol: { incident: { type: 'collision', date: '2026-03-02', location: { address: 'Nicosia' }, description: 'Updated narrative after review' } } },
      }),
    ];
    const p = buildClaimWorksheetProjection({
      claimId: 'c2',
      claimReference: 'CLM-2',
      certificateReference: 'CERT-2',
      events,
    });
    expect(p.intake.currentVersion).toBe(2);
    expect(p.intake.confirmedVersion).toBeUndefined();
    expect(p.intake.status).toBe('FNOL_SUBMITTED');
    expect(p.intake.requiredActions.some((action) => action.id === 'confirm-fnol')).toBe(true);
  });

  it('keeps salvage separated while reducing net incurred', () => {
    const events = [
      event({ id: '1', eventType: 'RESERVE_SET', occurredAt: '2026-03-01T00:00:00.000Z', payload: { bucket: 'INDEMNITY', newOutstandingAmount: 1000 } }),
      event({ id: '2', eventType: 'RECOVERY_EXPECTED', occurredAt: '2026-03-02T00:00:00.000Z', payload: { bucket: 'INDEMNITY', amount: 200, recoveryType: 'SALVAGE' } }),
      event({ id: '3', eventType: 'RECOVERY_RECEIVED', occurredAt: '2026-03-03T00:00:00.000Z', payload: { bucket: 'INDEMNITY', amount: 50, recoveryType: 'SALVAGE' } }),
    ];
    const p = buildClaimWorksheetProjection({
      claimId: 'c3',
      claimReference: 'CLM-3',
      certificateReference: 'CERT-3',
      events,
    });
    expect(p.salvageExpected).toBe(200);
    expect(p.salvageRealized).toBe(50);
    expect(p.recoveriesExpected).toBe(0);
    expect(p.totalIncurred).toBe(1000);
    expect(p.netIncurred).toBe(950);
  });

  it('returns deterministic blocking required actions for missing intake data', () => {
    const events = [
      event({
        id: '1',
        eventType: 'FNOL_SUBMITTED',
        occurredAt: '2026-03-01T10:00:00.000Z',
        payload: { version: 1, fnol: { incident: { type: '', date: '', location: { address: '' }, description: '' } } },
      }),
      event({
        id: '2',
        eventType: 'REFERRAL_REQUIRED',
        occurredAt: '2026-03-01T11:00:00.000Z',
        payload: { reasonCode: 'AUTH_LIMIT', explanation: 'Authority exceeded' },
      }),
    ];
    const p = buildClaimWorksheetProjection({
      claimId: 'c4',
      claimReference: 'CLM-4',
      certificateReference: 'CERT-4',
      events,
    });
    expect(p.intake.requiredActions.map((action) => action.id)).toEqual([
      'confirm-fnol',
      'complete-intake-gates',
      'approve-referral',
    ]);
    expect(p.intake.gates.filter((gate) => gate.status === 'FAIL').map((gate) => gate.key)).toEqual([
      'lossTypePresent',
      'dateOfLossPresent',
      'locationPresent',
      'narrativePresent',
      'fnolConfirmed',
    ]);
  });

  it('builds clarification history and changed-field attribution from intake events', () => {
    const events = [
      event({
        id: '1',
        eventType: 'FNOL_SUBMITTED',
        occurredAt: '2026-03-01T10:00:00.000Z',
        payload: { version: 1, fnol: { incident: { type: 'collision', date: '2026-03-01', location: { address: 'Nicosia' }, description: 'Initial narrative text' } } },
      }),
      event({
        id: '2',
        eventType: 'FNOL_CLARIFICATION_REQUESTED',
        occurredAt: '2026-03-01T11:00:00.000Z',
        payload: { requestId: 'clar-1', fieldsRequested: ['incident.location'], message: 'Please confirm location' },
      }),
      event({
        id: '3',
        eventType: 'FNOL_CLARIFICATION_RECEIVED',
        occurredAt: '2026-03-01T12:00:00.000Z',
        payload: { requestId: 'clar-1', message: 'Location confirmed' },
      }),
      event({
        id: '4',
        eventType: 'FNOL_AMENDED',
        occurredAt: '2026-03-02T10:00:00.000Z',
        payload: {
          fromVersion: 1,
          toVersion: 2,
          fnol: { incident: { type: 'collision', date: '2026-03-01', location: { address: 'Nicosia center' }, description: 'Updated narrative text' } },
          changes: [{ path: 'incident.location.address', from: 'Nicosia', to: 'Nicosia center' }],
        },
      }),
    ];
    const p = buildClaimWorksheetProjection({
      claimId: 'c5',
      claimReference: 'CLM-5',
      certificateReference: 'CERT-5',
      events,
    });
    expect(p.intake.clarificationHistory).toHaveLength(1);
    expect(p.intake.clarificationHistory[0]?.requestId).toBe('clar-1');
    expect(p.intake.clarificationHistory[0]?.receivedAt).toBeTruthy();
    expect(p.intake.changedFields.map((field) => field.path)).toEqual(['incident.location.address']);
  });
});


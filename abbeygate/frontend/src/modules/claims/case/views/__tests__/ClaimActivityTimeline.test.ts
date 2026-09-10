import { describe, expect, it } from 'vitest';
import { buildTimelineLines } from '../ClaimActivityTimeline';

describe('buildTimelineLines', () => {
  it('formats reserve set timeline card lines', () => {
    const lines = buildTimelineLines({
      id: '1',
      eventType: 'RESERVE_SET',
      occurredAt: '2026-03-16T10:00:00Z',
      payload: {
        bucket: 'INDEMNITY',
        newOutstandingAmount: 5000,
        explanation: 'Initial estimate received from garage.',
      },
    });
    expect(lines).toEqual({
      title: 'Reserve set',
      summary: 'Indemnity reserve set to €5,000',
      note: 'Initial estimate received from garage.',
    });
  });

  it('formats payment timeline card lines', () => {
    const lines = buildTimelineLines({
      id: '2',
      eventType: 'PAYMENT_ADDED',
      occurredAt: '2026-03-16T10:00:00Z',
      payload: {
        bucket: 'LEGAL_FEES',
        costSubType: 'attorney_coverage_fee',
        paymentType: 'INTERIM',
        amount: 1500,
        payeeName: 'LexPro Advocates LLC',
        payeeRoleUsed: 'legal_provider',
        note: 'Repair estimate payment',
      },
    });
    expect(lines.title).toBe('Payment issued');
    expect(lines.summary).toContain('Attorney coverage fee');
    expect(lines.summary).toContain('Interim');
    expect(lines.summary).toContain('€1,500');
    expect(lines.summary).toContain('LexPro Advocates LLC');
    expect(lines.summary).toContain('Legal provider');
    expect(lines.note).toBe('Repair estimate payment');
  });

  it('formats deny claim timeline card lines', () => {
    const lines = buildTimelineLines({
      id: '3',
      eventType: 'CLAIM_DENIED',
      occurredAt: '2026-03-16T10:00:00Z',
      payload: {
        denialReason: 'POLICY_NOT_IN_FORCE',
        summary: 'Claim denied because policy was not in force on date of loss.',
      },
    });
    expect(lines).toEqual({
      title: 'Claim denied',
      summary: 'Reason: Policy not in force',
      note: 'Claim denied because policy was not in force on date of loss.',
    });
  });

  it('formats information request timeline card lines', () => {
    const lines = buildTimelineLines({
      id: '4',
      eventType: 'CLAIM_INFO_REQUESTED',
      occurredAt: '2026-04-07T10:00:00Z',
      payload: {
        recipient: 'contact@example.com',
        deliveryStatus: 'QUEUED',
        message: 'Please confirm the incident address and policyholder details.',
      },
    });
    expect(lines).toEqual({
      title: 'Information requested',
      summary: 'Sent to contact@example.com · Status: queued',
      note: 'Please confirm the incident address and policyholder details.',
    });
  });
});

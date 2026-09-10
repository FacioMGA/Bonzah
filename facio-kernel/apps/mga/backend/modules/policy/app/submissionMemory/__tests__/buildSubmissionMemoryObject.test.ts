import { describe, expect, it } from 'vitest';
import { buildSubmissionMemoryObject, type SubmissionMessageInput } from '../buildSubmissionMemoryObject.js';

function msg(partial: Partial<SubmissionMessageInput> & { messageId: string }): SubmissionMessageInput {
  return {
    threadId: 'thr-1',
    fromActor: 'maria@brokerbros.example',
    subject: null,
    body: '',
    direction: 'INBOUND',
    sentAt: '2026-02-02T09:00:00.000Z',
    ...partial,
  };
}

describe('buildSubmissionMemoryObject', () => {
  const base = {
    submissionId: 'pol-9',
    operatingTenantId: 'tenant-1',
    policyNumber: 'ABFLEET-2210',
    status: 'QUOTING',
  };

  it('builds an ordered timeline and surfaces outstanding information', () => {
    const result = buildSubmissionMemoryObject({
      ...base,
      messages: [
        msg({ messageId: 'm2', sentAt: '2026-02-03T11:40:00.000Z', direction: 'OUTBOUND', subject: 'RE: fleet', body: 'Before we rate we still require the 5-year claims experience and the driver list.' }),
        msg({ messageId: 'm1', sentAt: '2026-02-02T09:05:00.000Z', subject: 'New fleet submission', body: 'Please quote a new commercial fleet.' }),
      ],
    });

    expect(result.timeline.map((t) => t.date)).toEqual(['2026-02-02T09:05:00.000Z', '2026-02-03T11:40:00.000Z']);
    expect(result.missingInformation.length).toBeGreaterThan(0);
    expect(result.draftBrokerRequest).toContain('ABFLEET-2210');
    expect(result.citations.length).toBe(2);
  });

  it('fires an authority referral trigger when exposure exceeds the limit', () => {
    const result = buildSubmissionMemoryObject({
      ...base,
      exposureAmount: 1_200_000,
      authorityLimit: 1_000_000,
      currency: 'EUR',
      messages: [msg({ messageId: 'm1', body: 'New fleet, sum insured 1.2m.' })],
    });
    expect(result.referralTriggers.some((t) => t.code === 'AUTHORITY_EXCEEDED')).toBe(true);
  });

  it('detects risk indicators in correspondence', () => {
    const result = buildSubmissionMemoryObject({
      ...base,
      messages: [msg({ messageId: 'm1', body: 'Note one prior loss in the last 3 years.' })],
    });
    expect(result.underwritingFlags.some((f) => f.code === 'RISK_INDICATOR')).toBe(true);
  });

  it('produces a deterministic confidence and no draft when nothing is outstanding', () => {
    const result = buildSubmissionMemoryObject({
      ...base,
      messages: [msg({ messageId: 'm1', subject: 'Bound', body: 'All documents received, proceeding to bind.' })],
    });
    expect(result.missingInformation).toEqual([]);
    expect(result.draftBrokerRequest).toBeNull();
    expect(['high', 'medium', 'low']).toContain(result.confidence);
  });
});

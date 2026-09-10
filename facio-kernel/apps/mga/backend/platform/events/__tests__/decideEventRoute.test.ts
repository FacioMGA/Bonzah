import { describe, it, expect } from 'vitest';
import { decideEventRoute, rebuildCoalesceJobKey } from '../queue.js';

describe('decideEventRoute', () => {
  describe('audit-only events', () => {
    // Regression guard for ABBEYGATE-7: before 2026-05-17 these fell
    // through to the default `dataSync` queue and exhausted 3 BullMQ
    // retries each with `Unsupported data-sync queue job: ...` because
    // no worker handler is registered for them by design.
    const AUDIT_ONLY = [
      'COMM.MESSAGE_SENT',
      'COMM.MESSAGE_DELIVERED',
      'COMM.MESSAGE_FAILED',
      'COMM.MESSAGE_RECEIVED',
      'COMM.NOTE_CREATED',
      // P1 2026-07-21: domain status events have no data-sync handler and were
      // failing + accruing until Redis OOM'd. They are consumed only via the
      // behavior fan-out (which runs for audit-only events too).
      'POLICY.STATUS_CHANGED',
      'PAYMENT.STATUS_CHANGED',
      'RISK_TRANSACTION.STATUS_CHANGED',
      'DOCUMENT_SET.STATUS_CHANGED',
      // Sanctions decision is persisted at decision time; event has no
      // data-sync handler -> audit-only (behavior fan-out still runs).
      'POLICY.COMPLIANCE.SANCTIONS_DECIDED',
      // ABBEYGATE-7 recurrence (2026-08-14): CardCorp webhook audit rows do all
      // real work inline and have no consumer; before the fix each live payment
      // notification threw `Unsupported data-sync queue job:
      // WEBHOOK.CARDCORP.DECRYPTED` and accrued failed jobs.
      'WEBHOOK.CARDCORP.DECRYPTED',
      'WEBHOOK.CARDCORP.DUPLICATE',
      'WEBHOOK.CARDCORP.ENCRYPTED',
      'WEBHOOK.CARDCORP.ERROR',
    ] as const;

    for (const eventType of AUDIT_ONLY) {
      it(`routes ${eventType} as audit_only (no enqueue)`, () => {
        expect(decideEventRoute(eventType)).toEqual({ kind: 'audit_only' });
      });
    }
  });

  describe('notifications queue', () => {
    const NOTIFICATIONS = [
      'EMAIL.UW_REFERRAL',
      'EMAIL.EXTERNAL_ISSUANCE_DOCUMENTS_READY',
      'EMAIL.INFO_REQUIRED',
      'RENEWAL.EMAIL_SCAN',
      'SLACK.NOTIFY',
      'COMM.OUTBOUND_QUEUED',
    ] as const;

    for (const eventType of NOTIFICATIONS) {
      it(`routes ${eventType} to notifications`, () => {
        expect(decideEventRoute(eventType)).toEqual({ kind: 'enqueue', queue: 'notifications' });
      });
    }
  });

  describe('documents queue', () => {
    const DOCUMENTS = [
      'DOC.GENERATE_ISSUED_POLICY_PACK',
      'DOC.GENERATE_MOTOR_DOC_PACK',
      'PDF.RENDER',
      'XLSX.GENERATE_BORDEREAUX_V52',
    ] as const;

    for (const eventType of DOCUMENTS) {
      it(`routes ${eventType} to documents`, () => {
        expect(decideEventRoute(eventType)).toEqual({ kind: 'enqueue', queue: 'documents' });
      });
    }
  });

  describe('default (dataSync)', () => {
    it('routes unknown event types to dataSync', () => {
      expect(decideEventRoute('POLICY.BOUND')).toEqual({ kind: 'enqueue', queue: 'dataSync' });
      expect(decideEventRoute('ACCOUNTS360.PROJECTION_UPDATE')).toEqual({ kind: 'enqueue', queue: 'dataSync' });
      expect(decideEventRoute('BEHAVIOR.NORMALIZE')).toEqual({ kind: 'enqueue', queue: 'dataSync' });
    });

    it('a hypothetical new COMM.* event that is NOT in the audit-only set falls through to dataSync', () => {
      // Sanity check: the audit-only set is a closed allowlist, not a
      // prefix match. A future `COMM.SOMETHING_NEW` will go to dataSync
      // and ABBEYGATE-7-style exhaustion until either a handler is
      // added or the event is added to the audit-only set.
      expect(decideEventRoute('COMM.SOMETHING_NEW')).toEqual({ kind: 'enqueue', queue: 'dataSync' });
    });
  });
});

describe('rebuildCoalesceJobKey', () => {
  // P1 2026-07-21 projection storm: a backlog of N events for one aggregate
  // became N concurrent same-row rebuilds that contended on locks and blew the
  // tenant transaction timeout (P2028). These idempotent per-aggregate
  // rebuilds must coalesce onto ONE jobId per aggregate so only the newest
  // rebuild runs; drift is healed by the periodic reconcile workers.
  it('coalesces account projection rebuilds by aggregateId', () => {
    const a = rebuildCoalesceJobKey('ACCOUNTS360.PROJECTION_UPDATE', { aggregateId: 'acct-1', eventId: 'evt-a' });
    const b = rebuildCoalesceJobKey('ACCOUNTS360.PROJECTION_UPDATE', { aggregateId: 'acct-1', eventId: 'evt-b' });
    expect(a).toBeDefined();
    expect(a).toBe(b); // different events, same aggregate -> same coalesced key
  });

  it('keeps distinct aggregates on distinct keys', () => {
    const a = rebuildCoalesceJobKey('ACCOUNT_INTELLIGENCE.PROJECTION_UPDATE', { aggregateId: 'acct-1' });
    const b = rebuildCoalesceJobKey('ACCOUNT_INTELLIGENCE.PROJECTION_UPDATE', { aggregateId: 'acct-2' });
    expect(a).not.toBe(b);
  });

  it('falls back to data.accountId / data.policyId when aggregateId is absent', () => {
    expect(rebuildCoalesceJobKey('ACCOUNTS360.PROJECTION_UPDATE', { data: { accountId: 'acct-9' } })).toBeDefined();
    expect(rebuildCoalesceJobKey('POLICY.INDEX_UPDATE', { data: { policyId: 'pol-9' } })).toBeDefined();
  });

  it('returns undefined for non-rebuild events (they keep their per-event jobId)', () => {
    expect(rebuildCoalesceJobKey('POLICY.BOUND', { aggregateId: 'pol-1' })).toBeUndefined();
    expect(rebuildCoalesceJobKey('COMM.OUTBOUND_QUEUED', { aggregateId: 'x' })).toBeUndefined();
  });

  it('returns undefined when no aggregate id can be resolved (never coalesce blindly)', () => {
    expect(rebuildCoalesceJobKey('ACCOUNTS360.PROJECTION_UPDATE', {})).toBeUndefined();
  });
});

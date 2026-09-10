import { describe, expect, it } from 'vitest';
import { buildIssuedPackReconcileEvent } from '../issuedPackReconcileSchedule.js';

describe('buildIssuedPackReconcileEvent', () => {
  it('uses one deterministic event identity for the same tenant and schedule window', () => {
    const args = {
      tenantId: 'tenant-pt',
      actorId: 'queue-reconcile' as const,
      scheduleKey: 'reconcile:12345',
      limit: 100,
    };

    const first = buildIssuedPackReconcileEvent(args);
    const second = buildIssuedPackReconcileEvent(args);

    expect(first.eventId).toBe(second.eventId);
    expect(first.idempotencyKey).toBe(second.idempotencyKey);
    expect(first.data).toMatchObject({ operatingTenantId: 'tenant-pt', limit: 100 });
  });

  it('creates a different identity for a different tenant or schedule window', () => {
    const first = buildIssuedPackReconcileEvent({
      tenantId: 'tenant-pt',
      actorId: 'queue-reconcile',
      scheduleKey: 'reconcile:12345',
      limit: 100,
    });
    const nextWindow = buildIssuedPackReconcileEvent({
      tenantId: 'tenant-pt',
      actorId: 'queue-reconcile',
      scheduleKey: 'reconcile:12346',
      limit: 100,
    });
    const otherTenant = buildIssuedPackReconcileEvent({
      tenantId: 'tenant-cy',
      actorId: 'queue-reconcile',
      scheduleKey: 'reconcile:12345',
      limit: 100,
    });

    expect(first.eventId).not.toBe(nextWindow.eventId);
    expect(first.eventId).not.toBe(otherTenant.eventId);
  });
});

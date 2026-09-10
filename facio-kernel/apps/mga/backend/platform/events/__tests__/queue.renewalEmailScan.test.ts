import { describe, expect, it } from 'vitest';
import { buildRenewalEmailScanEvent } from '../renewalEmailScanSchedule.js';

describe('buildRenewalEmailScanEvent', () => {
  it('uses one deterministic event identity for the same tenant and schedule window', () => {
    const args = {
      tenantId: 'tenant-pt',
      scheduleKey: 'hour:2026-09-04T12',
      scheduledAt: '2026-09-04T12:00:00.000Z',
    };

    const first = buildRenewalEmailScanEvent(args);
    const second = buildRenewalEmailScanEvent(args);

    expect(first.eventId).toBe(second.eventId);
    expect(first.idempotencyKey).toBe(second.idempotencyKey);
    expect(first.data).toMatchObject({
      operatingTenantId: 'tenant-pt',
      scheduledAt: args.scheduledAt,
    });
  });

  it('creates a different identity for a different tenant or schedule window', () => {
    const base = {
      tenantId: 'tenant-pt',
      scheduleKey: 'hour:2026-09-04T12',
      scheduledAt: '2026-09-04T12:00:00.000Z',
    };
    const first = buildRenewalEmailScanEvent(base);
    const nextWindow = buildRenewalEmailScanEvent({
      ...base,
      scheduleKey: 'hour:2026-09-04T13',
      scheduledAt: '2026-09-04T13:00:00.000Z',
    });
    const otherTenant = buildRenewalEmailScanEvent({ ...base, tenantId: 'tenant-cy' });

    expect(first.eventId).not.toBe(nextWindow.eventId);
    expect(first.eventId).not.toBe(otherTenant.eventId);
  });
});

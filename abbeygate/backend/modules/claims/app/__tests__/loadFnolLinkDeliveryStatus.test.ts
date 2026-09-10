import { beforeEach, describe, expect, it, vi } from 'vitest';

// ABY-268 — pin the contract between the worker delivery state on a
// `communication_messages` row and the operator-facing
// `comms.fnolLinkDelivery` shape consumed by `ClaimSummaryTab.tsx`.
//
// We mock `tenantScopedPrisma.communicationMessage.findFirst` because
// the helper itself is just a query + classifier — the value of the
// regression test is showing that:
//   - QUEUED / SENDING       collapse onto a single "QUEUED" operator
//                            label (still in flight),
//   - SENT / DELIVERED       collapse onto "SENT" (provider accepted),
//   - FAILED                 maps 1:1 (worker exhausted retries),
//   - missing row            yields "UNKNOWN" with safe defaults,
//   - the latest delivery attempt's errorCode/errorDetail are
//     surfaced for the failure-state banner.

const { tenantScopedPrisma } = vi.hoisted(() => ({
  tenantScopedPrisma: {
    communicationMessage: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('../../../../platform/db/connection.js', () => ({
  prisma: {},
  tenantScopedPrisma,
}));

const { loadFnolLinkDeliveryStatus } = await import('../loadFnolLinkDeliveryStatus.js');

/**
 * The exact shape `loadFnolLinkDeliveryStatus` reads from the prisma
 * result. Declared locally (instead of casting through a fake
 * `FindFirstReturn`) so the mock row is structurally typed end-to-end
 * and never trips the diff-any-laundering guard.
 */
type FnolLinkMessageMockRow = {
  id: string;
  status: string;
  sentAt: Date | null;
  deliveredAt: Date | null;
  createdAt: Date;
  toRecipients: unknown;
  deliveryAttempts: Array<{ errorCode: string | null; errorDetail: string | null }>;
  _count: { deliveryAttempts: number };
};

function makeRow(overrides: Partial<{
  status: string;
  sentAt: Date | null;
  deliveredAt: Date | null;
  createdAt: Date;
  toRecipients: unknown;
  errorCode: string | null;
  errorDetail: string | null;
  attemptCount: number;
}> = {}): FnolLinkMessageMockRow {
  const {
    status = 'QUEUED',
    sentAt = null,
    deliveredAt = null,
    createdAt = new Date('2026-05-21T12:00:00Z'),
    toRecipients = ['policyholder@example.com'],
    errorCode = null,
    errorDetail = null,
    attemptCount = 0,
  } = overrides;
  return {
    id: 'msg_1',
    status,
    sentAt,
    deliveredAt,
    createdAt,
    toRecipients,
    deliveryAttempts:
      errorCode !== null || errorDetail !== null
        ? [{ errorCode, errorDetail }]
        : [],
    _count: { deliveryAttempts: attemptCount },
  };
}

describe('loadFnolLinkDeliveryStatus (ABY-268)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns UNKNOWN when no FNOL link message has been queued yet', async () => {
    tenantScopedPrisma.communicationMessage.findFirst.mockResolvedValueOnce(null);
    const result = await loadFnolLinkDeliveryStatus('claim_1');
    expect(result.status).toBe('UNKNOWN');
    expect(result.recipient).toBeNull();
    expect(result.messageId).toBeNull();
    expect(result.attemptCount).toBe(0);
  });

  it('returns QUEUED while the worker is in flight (status SENDING collapses onto QUEUED)', async () => {
    tenantScopedPrisma.communicationMessage.findFirst.mockResolvedValueOnce(
      makeRow({ status: 'SENDING' }),
    );
    const result = await loadFnolLinkDeliveryStatus('claim_1');
    expect(result.status).toBe('QUEUED');
    expect(result.queuedAt).toBe('2026-05-21T12:00:00.000Z');
    expect(result.sentAt).toBeNull();
  });

  it('returns SENT once the provider accepts the message (DELIVERED collapses onto SENT)', async () => {
    tenantScopedPrisma.communicationMessage.findFirst.mockResolvedValueOnce(
      makeRow({
        status: 'DELIVERED',
        sentAt: new Date('2026-05-21T12:01:00Z'),
        deliveredAt: new Date('2026-05-21T12:02:00Z'),
      }),
    );
    const result = await loadFnolLinkDeliveryStatus('claim_1');
    expect(result.status).toBe('SENT');
    expect(result.sentAt).toBe('2026-05-21T12:01:00.000Z');
    expect(result.deliveredAt).toBe('2026-05-21T12:02:00.000Z');
  });

  it('returns FAILED with the latest delivery-attempt error code + detail', async () => {
    tenantScopedPrisma.communicationMessage.findFirst.mockResolvedValueOnce(
      makeRow({
        status: 'FAILED',
        attemptCount: 3,
        errorCode: 'SENDGRID_BOUNCE',
        errorDetail: 'mailbox does not exist',
      }),
    );
    const result = await loadFnolLinkDeliveryStatus('claim_1');
    expect(result.status).toBe('FAILED');
    expect(result.errorCode).toBe('SENDGRID_BOUNCE');
    expect(result.errorDetail).toBe('mailbox does not exist');
    expect(result.attemptCount).toBe(3);
  });

  it('narrows the prisma query by the canonical CLAIMS_FNOL_LINK template id', async () => {
    tenantScopedPrisma.communicationMessage.findFirst.mockResolvedValueOnce(null);
    await loadFnolLinkDeliveryStatus('claim_1');
    expect(tenantScopedPrisma.communicationMessage.findFirst).toHaveBeenCalledTimes(1);
    const arg = tenantScopedPrisma.communicationMessage.findFirst.mock.calls[0]?.[0];
    expect(arg?.where).toMatchObject({
      thread: { entityType: 'CLAIM', entityId: 'claim_1' },
      direction: 'OUTBOUND',
      channel: 'EMAIL',
      externalRefs: { path: ['template', 'templateId'], equals: 'CLAIMS_FNOL_LINK' },
    });
  });

  it('returns UNKNOWN immediately when called with an empty claim id (no DB roundtrip)', async () => {
    const result = await loadFnolLinkDeliveryStatus('');
    expect(result.status).toBe('UNKNOWN');
    expect(tenantScopedPrisma.communicationMessage.findFirst).not.toHaveBeenCalled();
  });

  it('extracts the first valid recipient from the toRecipients JSON array', async () => {
    tenantScopedPrisma.communicationMessage.findFirst.mockResolvedValueOnce(
      makeRow({ toRecipients: ['', '   ', 'recipient@example.com', 'other@example.com'] }),
    );
    const result = await loadFnolLinkDeliveryStatus('claim_1');
    expect(result.recipient).toBe('recipient@example.com');
  });
});

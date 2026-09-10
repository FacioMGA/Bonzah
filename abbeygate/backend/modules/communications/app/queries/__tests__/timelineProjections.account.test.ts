import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The account Communications tab reads `getCommunicationTimeline('ACCOUNT', id)`.
 * Before this change that only matched the (empty) account thread, so an issued
 * policy's confirmation email — written to the POLICY thread — never appeared on
 * the account page (Danny, 2026-08-14). These tests pin the aggregation: an
 * account view merges its child policy/claim threads and tags each item with a
 * source label, while every other entity still reads only its own thread.
 */

const policyFindMany = vi.fn();
const claimFindMany = vi.fn();
const documentFindMany = vi.fn();
const threadFindMany = vi.fn();
const userFindMany = vi.fn();

vi.mock('../../../../../platform/db/connection.js', () => ({
  // policy/claim/document reads go through the tenant-scoped client (RLS); threads/users
  // stay on the base client, mirroring timelineProjections.ts.
  tenantScopedPrisma: {
    policy: { findMany: (args: unknown) => policyFindMany(args) },
    claim: { findMany: (args: unknown) => claimFindMany(args) },
    document: { findMany: (args: unknown) => documentFindMany(args) },
  },
  prisma: {
    communicationThread: { findMany: (args: unknown) => threadFindMany(args) },
    user: { findMany: (args: unknown) => userFindMany(args) },
  },
}));

const { getCommunicationTimeline, resolveTimelineScope } = await import('../timelineProjections.js');

beforeEach(() => {
  policyFindMany.mockReset();
  claimFindMany.mockReset();
  documentFindMany.mockReset().mockResolvedValue([]);
  threadFindMany.mockReset();
  userFindMany.mockReset().mockResolvedValue([]);
});

describe('resolveTimelineScope', () => {
  it('reads only the entity itself for a non-account view', async () => {
    const { where, labelByKey } = await resolveTimelineScope('POLICY', 'pol_1');
    expect(where).toEqual({ entityType: 'POLICY', entityId: 'pol_1' });
    expect(labelByKey.size).toBe(0);
    expect(policyFindMany).not.toHaveBeenCalled();
  });

  it('aggregates account + child policy/claim threads with labels', async () => {
    policyFindMany.mockResolvedValue([{ id: 'pol_1', policyNumber: 'BZ/CY5000001' }]);
    claimFindMany.mockResolvedValue([{ id: 'clm_1', claimNumber: 'CLM-2026-0001' }]);

    const { where, labelByKey } = await resolveTimelineScope('ACCOUNT', 'acc_1');

    expect(where).toEqual({
      OR: [
        { entityType: 'ACCOUNT', entityId: 'acc_1' },
        { entityType: 'POLICY', entityId: { in: ['pol_1'] } },
        { entityType: 'CLAIM', entityId: { in: ['clm_1'] } },
      ],
    });
    expect(labelByKey.get('POLICY:pol_1')).toBe('Policy BZ/CY5000001');
    expect(labelByKey.get('CLAIM:clm_1')).toBe('Claim CLM-2026-0001');
  });

  it('caps the policy fan-out so a pathological account cannot fan out unboundedly', async () => {
    policyFindMany.mockResolvedValue([]);
    await resolveTimelineScope('ACCOUNT', 'acc_big');
    expect(policyFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 200 }));
    // No policies -> no claim lookup, and the where collapses to the account thread only.
    expect(claimFindMany).not.toHaveBeenCalled();
  });
});

describe('getCommunicationTimeline account aggregation', () => {
  it("tags a child policy's confirmation email with its policy source label", async () => {
    policyFindMany.mockResolvedValue([{ id: 'pol_1', policyNumber: 'BZ/CY5000001' }]);
    claimFindMany.mockResolvedValue([]);
    threadFindMany.mockResolvedValue([
      {
        id: 'thr_pol_1',
        entityType: 'POLICY',
        entityId: 'pol_1',
        messages: [
          {
            id: 'msg_1',
            direction: 'OUTBOUND',
            communicationType: 'EXTERNAL',
            channel: 'EMAIL',
            subject: 'Your Home Insurance Policy',
            body: 'Welcome — your policy is confirmed.',
            status: 'DELIVERED',
            fromActor: 'system',
            toRecipients: ['danny@example.com'],
            attachments: [],
            externalRefs: {},
            createdAt: new Date('2026-08-14T10:00:00.000Z'),
            deliveryAttempts: [],
          },
        ],
      },
    ]);

    const { items } = await getCommunicationTimeline('ACCOUNT', 'acc_1');
    const message = items.find((item) => item.id === 'msg_1');
    expect(message).toBeDefined();
    expect(message?.sourceLabel).toBe('Policy BZ/CY5000001');
    expect(message?.title).toBe('Your Home Insurance Policy');
  });
});

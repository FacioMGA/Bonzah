import { beforeEach, describe, expect, it, vi } from 'vitest';

const policyFindMany = vi.fn();
const claimFindMany = vi.fn();
const documentFindMany = vi.fn();
const threadFindMany = vi.fn();
const userFindMany = vi.fn();

vi.mock('../../../../../platform/db/connection.js', () => ({
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

const { getCommunicationTimeline } = await import('../timelineProjections.js');

beforeEach(() => {
  policyFindMany.mockReset();
  claimFindMany.mockReset();
  documentFindMany.mockReset().mockResolvedValue([]);
  threadFindMany.mockReset();
  userFindMany.mockReset().mockResolvedValue([]);
});

function officeThread() {
  return {
    id: 'thr_office',
    entityType: 'OFFICE',
    entityId: 'GLOBAL',
    messages: [
      {
        id: 'msg_private',
        direction: 'OUTBOUND',
        communicationType: 'EXTERNAL',
        channel: 'EMAIL',
        subject: 'Staff DM',
        body: 'Peter to Effie only',
        status: 'SENT',
        fromActor: 'user_peter',
        toRecipients: ['effie@abbeygate.cy'],
        attachments: [],
        externalRefs: {},
        createdAt: new Date('2026-08-18T09:00:00.000Z'),
        deliveryAttempts: [],
      },
    ],
  };
}

describe('getCommunicationTimeline OFFICE privacy (ABY-431)', () => {
  it('does not return other people\'s staff DMs', async () => {
    threadFindMany.mockResolvedValue([officeThread()]);

    const dannyView = await getCommunicationTimeline('OFFICE', 'GLOBAL', {
      id: 'user_danny',
      email: 'danny@abbeygate.cy',
    });
    expect(dannyView.items).toEqual([]);

    const peterView = await getCommunicationTimeline('OFFICE', 'GLOBAL', {
      id: 'user_peter',
      email: 'peter@abbeygate.cy',
    });
    expect(peterView.items.some((item) => item.id === 'msg_private')).toBe(true);
  });

  it('fails closed when OFFICE is requested without a viewer', async () => {
    threadFindMany.mockResolvedValue([officeThread()]);
    const result = await getCommunicationTimeline('OFFICE', 'GLOBAL');
    expect(result.items).toEqual([]);
    expect(threadFindMany).not.toHaveBeenCalled();
  });
});

describe('getCommunicationTimeline sent documents (ABY-433)', () => {
  it('does not invent attachments from the current policy document set', async () => {
    documentFindMany.mockResolvedValue([
      {
        policyId: 'pol_1',
        filename: 'Endorsement.pdf',
        storageUri: '/api/documents/endorsement-later.pdf',
      },
    ]);
    threadFindMany.mockResolvedValue([
      {
        id: 'thr_pol_1',
        entityType: 'POLICY',
        entityId: 'pol_1',
        messages: [
          {
            id: 'msg_welcome',
            direction: 'OUTBOUND',
            communicationType: 'EXTERNAL',
            channel: 'EMAIL',
            subject: 'Your policy documents',
            body: 'Your pack is attached.',
            status: 'SENT',
            fromActor: 'system',
            toRecipients: ['customer@example.com'],
            attachments: [],
            externalRefs: { trigger: 'NEW_BUSINESS_PLACED' },
            createdAt: new Date('2026-08-18T10:00:00.000Z'),
            deliveryAttempts: [],
          },
        ],
      },
    ]);

    const { items } = await getCommunicationTimeline('POLICY', 'pol_1');
    const welcome = items.find((item) => item.id === 'msg_welcome');
    expect(welcome?.attachments).toEqual([]);
  });

  it('preserves a canonical generated-pack download URL', async () => {
    documentFindMany.mockResolvedValue([
      {
        policyId: 'pol_1',
        filename: 'PolicySchedule.pdf',
        storageUri: '/api/documents/schedule-abc.pdf',
      },
    ]);
    threadFindMany.mockResolvedValue([
      {
        id: 'thr_pol_1',
        entityType: 'POLICY',
        entityId: 'pol_1',
        messages: [
          {
            id: 'msg_welcome',
            direction: 'OUTBOUND',
            communicationType: 'EXTERNAL',
            channel: 'EMAIL',
            subject: 'Your policy documents',
            body: 'Your pack is attached.',
            status: 'SENT',
            fromActor: 'system',
            toRecipients: ['customer@example.com'],
            attachments: [{ filename: 'PolicySchedule.pdf' }],
            externalRefs: { trigger: 'NEW_BUSINESS_PLACED' },
            createdAt: new Date('2026-08-18T10:00:00.000Z'),
            deliveryAttempts: [],
          },
        ],
      },
    ]);

    const { items } = await getCommunicationTimeline('POLICY', 'pol_1');
    const welcome = items.find((item) => item.id === 'msg_welcome');
    expect(welcome?.attachments).toEqual([
      {
        filename: 'PolicySchedule.pdf',
        storageUri: '/api/documents/schedule-abc.pdf',
        url: '/api/documents/schedule-abc.pdf',
      },
    ]);
  });

  it('resolves a filename-only attachment against the canonical document store', async () => {
    documentFindMany.mockResolvedValue([
      {
        policyId: 'pol_1',
        filename: 'Quote.pdf',
        storageUri: '/api/documents/quote-abc.pdf',
      },
    ]);
    threadFindMany.mockResolvedValue([
      {
        id: 'thr_pol_1',
        entityType: 'POLICY',
        entityId: 'pol_1',
        messages: [
          {
            id: 'msg_quote',
            direction: 'OUTBOUND',
            communicationType: 'EXTERNAL',
            channel: 'EMAIL',
            subject: 'Your quote',
            body: 'Quote attached.',
            status: 'SENT',
            fromActor: 'system',
            toRecipients: ['customer@example.com'],
            attachments: [{ filename: 'Quote.pdf', contentBase64: 'AAA' }],
            externalRefs: { trigger: 'QUOTE_SENT' },
            createdAt: new Date('2026-08-18T10:05:00.000Z'),
            deliveryAttempts: [],
          },
        ],
      },
    ]);

    const { items } = await getCommunicationTimeline('POLICY', 'pol_1');
    const quote = items.find((item) => item.id === 'msg_quote');
    expect(quote?.attachments?.[0]?.url).toBe('/api/documents/quote-abc.pdf');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ attempts: vi.fn(), messages: vi.fn() }));
vi.mock('../../../../platform/db/connection.js', () => ({
  prisma: {
    communicationDeliveryAttempt: { findMany: db.attempts },
    communicationMessage: { findMany: db.messages },
  },
}));

import { resolveSendgridAttempt } from '../sendgridEventSupport.js';

const oldAttempt = {
  id: 'attempt-old', messageId: 'message-1', externalId: 'provider-old',
  attemptedAt: new Date('2026-09-01T10:00:00Z'),
  message: { id: 'message-1', externalRefs: null },
};
const newAttempt = { ...oldAttempt, id: 'attempt-new', externalId: 'provider-new', attemptedAt: new Date('2026-09-02T10:00:00Z') };

beforeEach(() => {
  vi.resetAllMocks();
  db.attempts.mockResolvedValue([]);
  db.messages.mockResolvedValue([]);
});

describe('SendGrid delivery-attempt correlation', () => {
  it('resolves a delayed old event by provider ID before the shared message ID', async () => {
    db.attempts.mockResolvedValueOnce([oldAttempt]);
    expect(await resolveSendgridAttempt({ event: 'bounce', sg_message_id: 'provider-old', custom_args: { communicationMessageId: 'message-1' } })).toEqual(oldAttempt);
    expect(db.attempts).toHaveBeenCalledExactlyOnceWith({
      where: { externalId: { in: ['provider-old'] }, provider: 'SENDGRID', channel: 'EMAIL' },
      include: { message: true }, take: 2,
    });
  });

  it('matches the established SendGrid suffix to the stored x-message-id', async () => {
    db.attempts.mockResolvedValueOnce([oldAttempt]);
    expect(await resolveSendgridAttempt({ event: 'delivered', sg_message_id: ' provider-old.recvd-server-1.0 ' })).toEqual(oldAttempt);
    expect(db.attempts).toHaveBeenCalledWith(expect.objectContaining({
      where: { externalId: { in: ['provider-old.recvd-server-1.0', 'provider-old'] }, provider: 'SENDGRID', channel: 'EMAIL' },
    }));
  });

  it('rejects a provider match that contradicts the supplied message ID', async () => {
    db.attempts.mockResolvedValueOnce([oldAttempt]);
    expect(await resolveSendgridAttempt({ event: 'delivered', sg_message_id: 'provider-old', communicationMessageId: 'message-other' })).toBeNull();
  });

  it('rejects conflicting top-level and nested custom identities', async () => {
    expect(await resolveSendgridAttempt({ event: 'delivered', sg_message_id: 'provider-old', communicationMessageId: 'message-1', custom_args: { messageId: 'message-other' } })).toBeNull();
    expect(db.attempts).not.toHaveBeenCalled();
  });

  it('rejects multiple attempts with the same provider identity', async () => {
    db.attempts.mockResolvedValueOnce([oldAttempt, { ...newAttempt, externalId: 'provider-old' }]);
    expect(await resolveSendgridAttempt({ event: 'delivered', sg_message_id: 'provider-old' })).toBeNull();
  });

  it('rejects an unknown provider ID despite a known message and sole different attempt', async () => {
    db.attempts.mockResolvedValueOnce([]).mockResolvedValueOnce([newAttempt]);
    expect(await resolveSendgridAttempt({ event: 'bounce', sg_message_id: 'provider-old', communicationMessageId: 'message-1' })).toBeNull();
  });

  it('accepts an early first-attempt callback before its provider ID is persisted', async () => {
    const pending = { ...oldAttempt, externalId: null };
    db.attempts.mockResolvedValueOnce([]).mockResolvedValueOnce([pending]);
    expect(await resolveSendgridAttempt({ event: 'delivered', sg_message_id: 'provider-old', communicationMessageId: 'message-1' })).toEqual(pending);
  });

  it('rejects the early callback fallback when a retry makes the message ambiguous', async () => {
    db.attempts.mockResolvedValueOnce([]).mockResolvedValueOnce([oldAttempt, { ...newAttempt, externalId: null }]);
    expect(await resolveSendgridAttempt({ event: 'delivered', sg_message_id: 'provider-unknown', communicationMessageId: 'message-1' })).toBeNull();
  });

  it('rejects a pending attempt with contradictory message-level provider evidence', async () => {
    db.attempts.mockResolvedValueOnce([]).mockResolvedValueOnce([{ ...oldAttempt, externalId: null, message: { id: 'message-1', externalRefs: { providerMessageId: 'provider-other' } } }]);
    expect(await resolveSendgridAttempt({ event: 'delivered', sg_message_id: 'provider-old', communicationMessageId: 'message-1' })).toBeNull();
  });

  it.each([
    { communicationMessageId: 'message-1' },
    { custom_args: { communicationMessageId: 'message-1' } },
    { unique_args: { messageId: 'message-1' } },
  ])('allows a sole legacy message-only attempt: %j', async (args) => {
    db.attempts.mockResolvedValueOnce([oldAttempt]);
    expect(await resolveSendgridAttempt({ event: 'bounce', ...args })).toEqual(oldAttempt);
  });

  it('rejects a message-only event when that message has multiple attempts', async () => {
    db.attempts.mockResolvedValueOnce([oldAttempt, newAttempt]);
    expect(await resolveSendgridAttempt({ event: 'bounce', communicationMessageId: 'message-1' })).toBeNull();
  });

  it('recovers a unique legacy message reference using exact JSON equality', async () => {
    const legacy = { ...oldAttempt, externalId: null };
    db.messages.mockResolvedValueOnce([{ id: 'message-1' }]);
    db.attempts.mockResolvedValueOnce([]).mockResolvedValueOnce([legacy]);
    expect(await resolveSendgridAttempt({ event: 'delivered', sg_message_id: 'provider-old' })).toEqual(legacy);
    expect(db.messages).toHaveBeenCalledWith({
      where: { provider: 'SENDGRID', channel: 'EMAIL', OR: [{ externalRefs: { path: ['providerMessageId'], equals: 'provider-old' } }] },
      take: 2,
    });
  });

  it('rejects ambiguous legacy message references', async () => {
    db.messages.mockResolvedValueOnce([{ id: 'message-1' }, { id: 'message-2' }]);
    expect(await resolveSendgridAttempt({ event: 'delivered', sg_message_id: 'provider-old' })).toBeNull();
  });
});

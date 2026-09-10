import { afterEach, describe, expect, it, vi } from 'vitest';

import { __resetWebhookReplayGuardForTests } from '../../../../platform/security/webhookReplayGuard.js';

const outboxMocks = vi.hoisted(() => ({
  write: vi.fn(),
}));

vi.mock('../cardcorpWebhookOutboxService.js', () => ({
  writeCardcorpWebhookOutboxEvent: outboxMocks.write,
}));

vi.mock('../../../../platform/db/connection.js', () => ({
  prisma: {
    payment: { findFirst: vi.fn() },
    paymentEvent: { create: vi.fn() },
  },
}));

import { processCardcorpWebhookPayload } from '../cardcorpWebhookProcessingService.js';

describe('cardcorp webhook replay protection', () => {
  afterEach(() => {
    vi.clearAllMocks();
    __resetWebhookReplayGuardForTests();
  });

  it('rejects duplicate encrypted payload replay', async () => {
    const payload = { encryptedBody: 'abcdef12' };
    const first = await processCardcorpWebhookPayload({
      body: payload,
      ivHex: '1122',
      tagHex: '3344',
      receivedAt: new Date().toISOString(),
    });
    const second = await processCardcorpWebhookPayload({
      body: payload,
      ivHex: '1122',
      tagHex: '3344',
      receivedAt: new Date().toISOString(),
    });

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(outboxMocks.write).toHaveBeenCalledWith(
      'WEBHOOK.CARDCORP.DUPLICATE',
      expect.objectContaining({ ivPresent: true, tagPresent: true }),
    );
  });
});

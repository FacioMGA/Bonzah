import express from 'express';
import crypto from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetWebhookReplayGuardForTests } from '../../../../platform/security/webhookReplayGuard.js';

const prismaMocks = vi.hoisted(() => ({
  threadFindFirst: vi.fn(),
  messageFindFirst: vi.fn(),
  createThread: vi.fn(),
  runTransaction: vi.fn(),
  messageCreate: vi.fn(),
  threadUpdate: vi.fn(),
  deliveryAttemptFindFirst: vi.fn(),
  deliveryAttemptUpdate: vi.fn(),
  messageUpdate: vi.fn(),
}));

vi.mock('../../../../platform/db/connection.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../platform/db/connection.js')>();
  const mockPrisma = {
    ...actual.prisma,
    communicationThread: {
      findFirst: prismaMocks.threadFindFirst,
      create: prismaMocks.createThread,
    },
    communicationMessage: {
      findFirst: prismaMocks.messageFindFirst,
      update: prismaMocks.messageUpdate,
    },
    communicationDeliveryAttempt: {
      findFirst: prismaMocks.deliveryAttemptFindFirst,
      update: prismaMocks.deliveryAttemptUpdate,
    },
    $transaction: prismaMocks.runTransaction,
  };
  return {
    ...actual,
    prisma: mockPrisma,
    tenantScopedPrisma: {
      ...actual.tenantScopedPrisma,
      $transaction: prismaMocks.runTransaction,
    },
  };
});

import webhooksRouter from '../webhooksRouter.js';

function sign(body: unknown, ts: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(`${ts}.${JSON.stringify(body)}`).digest('hex');
}

function signTwilio(url: string, params: Record<string, unknown>, authToken: string): string {
  const payload = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + String(params[key] ?? ''), url);
  return crypto.createHmac('sha1', authToken).update(payload, 'utf8').digest('base64');
}

function signSendgridEvent(payload: unknown, timestamp: string, privateKey: crypto.KeyObject): string {
  return crypto.sign('sha256', Buffer.from(`${timestamp}${JSON.stringify(payload)}`, 'utf8'), {
    key: privateKey,
    dsaEncoding: 'der',
  }).toString('base64');
}

describe('webhooksRouter inbound auth', () => {
  const secret = 'test-inbound-webhook-secret';
  const twilioAuthToken = 'test-twilio-auth-token';

  beforeEach(() => {
    process.env.INBOUND_WEBHOOK_SECRET = secret;
    process.env.TWILIO_AUTH_TOKEN = twilioAuthToken;
    prismaMocks.threadFindFirst.mockResolvedValue({ id: 'thread_1' });
    prismaMocks.messageFindFirst.mockResolvedValue(null);
    prismaMocks.createThread.mockResolvedValue({ id: 'thread_2' });
    prismaMocks.runTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) =>
      fn({
        communicationMessage: { create: prismaMocks.messageCreate, update: prismaMocks.messageUpdate },
        communicationThread: { update: prismaMocks.threadUpdate },
        communicationDeliveryAttempt: { update: prismaMocks.deliveryAttemptUpdate },
      }),
    );
    prismaMocks.messageCreate.mockResolvedValue({});
    prismaMocks.threadUpdate.mockResolvedValue({});
    prismaMocks.deliveryAttemptFindFirst.mockResolvedValue(null);
    prismaMocks.deliveryAttemptUpdate.mockResolvedValue({});
    prismaMocks.messageUpdate.mockResolvedValue({});
  });

  afterEach(() => {
    vi.clearAllMocks();
    __resetWebhookReplayGuardForTests();
    delete process.env.INBOUND_WEBHOOK_SECRET;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.PUBLIC_API_BASE_URL;
    delete process.env.SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY;
    delete process.env.TWILIO_WEBHOOK_SIGNATURE_MODE;
    delete process.env.SENDGRID_INBOUND_SIGNATURE_MODE;
    delete process.env.SENDGRID_EVENT_WEBHOOK_SIGNATURE_MODE;
  });

  async function withServer(run: (baseUrl: string) => Promise<void>) {
    const app = express();
    app.use(express.urlencoded({ extended: true }));
    app.use(express.json());
    app.use('/webhooks', webhooksRouter);
    const server = app.listen(0);
    try {
      const addr = server.address();
      if (!addr || typeof addr === 'string') throw new Error('address unavailable');
      const baseUrl = `http://127.0.0.1:${addr.port}`;
      process.env.PUBLIC_API_BASE_URL = baseUrl;
      await run(baseUrl);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  }

  it('returns 401 when signature headers are missing', async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/webhooks/email/inbound`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from: 'a@example.com', text: 'hello' }),
      });
      expect(response.status).toBe(401);
    });
  });

  it('returns 401 when inbound webhook secret is missing outside production too', async () => {
    delete process.env.INBOUND_WEBHOOK_SECRET;
    process.env.NODE_ENV = 'test';

    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/webhooks/email/inbound`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from: 'a@example.com', text: 'hello' }),
      });
      expect(response.status).toBe(401);
      expect(await response.text()).toContain('Webhook secret not configured');
    });
  });

  it('rejects SendGrid inbound compat mode without canonical HMAC auth', async () => {
    process.env.SENDGRID_INBOUND_SIGNATURE_MODE = 'compat';

    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/webhooks/email/inbound`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-sendgrid-timestamp': String(Date.now()),
          'x-sendgrid-signature': 'provider-signature-not-facio-hmac',
        },
        body: JSON.stringify({ from: 'a@example.com', text: 'hello' }),
      });
      expect(response.status).toBe(401);
    });
  });

  it('returns 401 when signature is invalid', async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/webhooks/email/inbound`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-webhook-timestamp': String(Date.now()),
          'x-webhook-signature': 'deadbeef',
        },
        body: JSON.stringify({ from: 'a@example.com', text: 'hello' }),
      });
      expect(response.status).toBe(401);
    });
  });

  it('returns 400 when inbound payload uses unsupported primitive shape', async () => {
    await withServer(async (baseUrl) => {
      const body = 42;
      const ts = String(Date.now());
      const signature = sign(body, ts, secret);
      const response = await fetch(`${baseUrl}/webhooks/email/inbound`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-webhook-timestamp': ts,
          'x-webhook-signature': signature,
        },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
    });
  });

  it('returns 200 when signature is valid', async () => {
    await withServer(async (baseUrl) => {
      const body = { from: 'a@example.com', text: 'hello' };
      const ts = String(Date.now());
      const signature = sign(body, ts, secret);
      const response = await fetch(`${baseUrl}/webhooks/email/inbound`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-webhook-timestamp': ts,
          'x-webhook-signature': signature,
        },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(200);
      expect(prismaMocks.threadFindFirst).toHaveBeenCalledTimes(1);
      expect(prismaMocks.runTransaction).toHaveBeenCalledTimes(1);
    });
  });

  it('rejects duplicate signed payload replay', async () => {
    await withServer(async (baseUrl) => {
      const body = { from: 'a@example.com', text: 'hello' };
      const ts = String(Date.now());
      const signature = sign(body, ts, secret);
      const headers = {
        'content-type': 'application/json',
        'x-webhook-timestamp': ts,
        'x-webhook-signature': signature,
      };
      const first = await fetch(`${baseUrl}/webhooks/email/inbound`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      const second = await fetch(`${baseUrl}/webhooks/email/inbound`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      expect(first.status).toBe(200);
      expect(second.status).toBe(409);
    });
  });

  it('returns 401 instead of 500 for malformed Twilio signatures', async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/webhooks/sms/inbound`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-twilio-signature': 'bad',
        },
        body: new URLSearchParams({
          From: '+35799111222',
          To: '+35799000111',
          Body: 'hello',
          MessageSid: 'SM-bad-sig',
        }).toString(),
      });
      expect(response.status).toBe(401);
    });
  });

  it('rejects Twilio compat mode when canonical signature verification cannot run', async () => {
    process.env.TWILIO_WEBHOOK_SIGNATURE_MODE = 'compat';
    delete process.env.TWILIO_AUTH_TOKEN;

    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/webhooks/sms/inbound`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          From: '+35799111222',
          To: '+35799000111',
          Body: 'hello',
          MessageSid: 'SM-compat-rejected',
        }).toString(),
      });
      expect(response.status).toBe(401);
      expect(await response.text()).toContain('Missing Twilio signature or auth token');
    });
  });

  it('correlates inbound WhatsApp messages using the stored prefixed address', async () => {
    await withServer(async (baseUrl) => {
      prismaMocks.threadFindFirst.mockResolvedValueOnce({ id: 'thread_whatsapp' });
      const body = {
        From: 'whatsapp:+35799111222',
        To: 'whatsapp:+35799000111',
        Body: 'hello from whatsapp',
        MessageSid: 'SM-whatsapp-1',
      };
      const signature = signTwilio(`${baseUrl}/webhooks/whatsapp/inbound`, body, twilioAuthToken);
      const response = await fetch(`${baseUrl}/webhooks/whatsapp/inbound`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-twilio-signature': signature,
        },
        body: new URLSearchParams(body).toString(),
      });

      expect(response.status).toBe(200);
      expect(prismaMocks.threadFindFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          messages: expect.objectContaining({
            some: expect.objectContaining({
              toRecipients: {
                array_contains: ['whatsapp:+35799111222'],
              },
            }),
          }),
        }),
      }));
      expect(prismaMocks.createThread).not.toHaveBeenCalled();
    });
  });

  it('updates delivery attempt and message status from Twilio status callbacks', async () => {
    await withServer(async (baseUrl) => {
      prismaMocks.deliveryAttemptFindFirst.mockResolvedValueOnce({
        id: 'attempt_1',
        messageId: 'message_1',
        message: { threadId: 'thread_1' },
      });
      const body = {
        MessageSid: 'SM-status-1',
        MessageStatus: 'delivered',
      };
      const signature = signTwilio(`${baseUrl}/webhooks/twilio/status`, body, twilioAuthToken);
      const response = await fetch(`${baseUrl}/webhooks/twilio/status`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-twilio-signature': signature,
        },
        body: new URLSearchParams(body).toString(),
      });

      expect(response.status).toBe(200);
      expect(prismaMocks.deliveryAttemptFindFirst).toHaveBeenCalledTimes(1);
      expect(prismaMocks.runTransaction).toHaveBeenCalledTimes(1);
      expect(prismaMocks.deliveryAttemptUpdate).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'attempt_1' },
        data: expect.objectContaining({
          status: 'DELIVERED',
          resolvedAt: expect.any(Date),
        }),
      }));
      expect(prismaMocks.messageUpdate).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'message_1' },
        data: expect.objectContaining({
          status: 'DELIVERED',
          deliveredAt: expect.any(Date),
        }),
      }));
      expect(prismaMocks.threadUpdate).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'thread_1' },
        data: { lastActivityAt: expect.any(Date) },
      }));
    });
  });

  it('updates delivery attempt and message status from SendGrid event callbacks', async () => {
    await withServer(async (baseUrl) => {
      const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
        namedCurve: 'prime256v1',
      });
      process.env.SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'pem' }).toString();
      process.env.SENDGRID_EVENT_WEBHOOK_SIGNATURE_MODE = 'strict';

      prismaMocks.deliveryAttemptFindFirst.mockResolvedValueOnce({
        id: 'attempt_sg_1',
        messageId: 'message_sg_1',
        status: 'SENT',
        message: { id: 'message_sg_1', status: 'SENT', sentAt: new Date('2026-04-07T10:58:56.000Z'), threadId: 'thread_sg_1' },
      });

      const body = [{
        event: 'delivered',
        timestamp: 1775574000,
        sg_event_id: 'sg-event-1',
        sg_message_id: 'sg-message-1',
        custom_args: {
          communicationMessageId: 'message_sg_1',
        },
      }];
      const timestamp = String(Date.now());
      const signature = signSendgridEvent(body, timestamp, privateKey);
      const response = await fetch(`${baseUrl}/webhooks/sendgrid/events`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-twilio-email-event-webhook-timestamp': timestamp,
          'x-twilio-email-event-webhook-signature': signature,
        },
        body: JSON.stringify(body),
      });

      expect(response.status).toBe(200);
      expect(prismaMocks.deliveryAttemptFindFirst).toHaveBeenCalledTimes(1);
      expect(prismaMocks.runTransaction).toHaveBeenCalledTimes(1);
      expect(prismaMocks.deliveryAttemptUpdate).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'attempt_sg_1' },
        data: expect.objectContaining({
          status: 'DELIVERED',
          resolvedAt: expect.any(Date),
        }),
      }));
      expect(prismaMocks.messageUpdate).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'message_sg_1' },
        data: expect.objectContaining({
          status: 'DELIVERED',
          deliveredAt: expect.any(Date),
        }),
      }));
      expect(prismaMocks.threadUpdate).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'thread_sg_1' },
        data: { lastActivityAt: expect.any(Date) },
      }));
    });
  });

  it('matches SendGrid dropped callbacks by the root x-message-id when custom args are missing', async () => {
    await withServer(async (baseUrl) => {
      const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
        namedCurve: 'prime256v1',
      });
      process.env.SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'pem' }).toString();
      process.env.SENDGRID_EVENT_WEBHOOK_SIGNATURE_MODE = 'strict';

      prismaMocks.deliveryAttemptFindFirst.mockResolvedValueOnce({
        id: 'attempt_sg_drop',
        messageId: 'message_sg_drop',
        status: 'SENT',
        message: { id: 'message_sg_drop', status: 'SENT', sentAt: new Date('2026-07-15T14:40:20.000Z'), threadId: 'thread_sg_drop' },
      });

      const body = [{
        event: 'dropped',
        timestamp: 1784126420,
        sg_event_id: 'drop-event-1',
        sg_message_id: 'root-sendgrid-id.recvd-656b4879fd-jrcm4-1-6A579BCD-6.0',
        email: 'customer@example.com',
        reason: 'Bounced Address',
      }];
      const timestamp = String(Date.now());
      const signature = signSendgridEvent(body, timestamp, privateKey);
      const response = await fetch(`${baseUrl}/webhooks/sendgrid/events`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-twilio-email-event-webhook-timestamp': timestamp,
          'x-twilio-email-event-webhook-signature': signature,
        },
        body: JSON.stringify(body),
      });

      expect(response.status).toBe(200);
      expect(prismaMocks.deliveryAttemptFindFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          externalId: { in: ['root-sendgrid-id.recvd-656b4879fd-jrcm4-1-6A579BCD-6.0', 'root-sendgrid-id'] },
        }),
      }));
      expect(prismaMocks.deliveryAttemptUpdate).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'attempt_sg_drop' },
        data: expect.objectContaining({
          status: 'FAILED',
          errorCode: 'SENDGRID_DELIVERY_FAILED',
          errorDetail: 'Bounced Address',
        }),
      }));
      expect(prismaMocks.messageUpdate).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'message_sg_drop' },
        data: expect.objectContaining({ status: 'FAILED' }),
      }));
    });
  });

  it('rejects SendGrid event compat mode when canonical public-key verification cannot run', async () => {
    process.env.SENDGRID_EVENT_WEBHOOK_SIGNATURE_MODE = 'compat';
    delete process.env.SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY;

    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/webhooks/sendgrid/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify([{
          event: 'delivered',
          timestamp: 1775574000,
          sg_event_id: 'sg-event-compat-rejected',
          sg_message_id: 'sg-message-compat-rejected',
        }]),
      });
      expect(response.status).toBe(401);
      expect(await response.text()).toContain('Missing SendGrid event webhook signature');
    });
  });
});

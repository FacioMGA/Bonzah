import crypto from 'crypto';

import { prisma, tenantScopedPrisma } from '../../../platform/db/connection.js';
import { writeCardcorpWebhookOutboxEvent } from './cardcorpWebhookOutboxService.js';
import { registerWebhookReplayAttempt } from '../../../platform/security/webhookReplayGuard.js';
import { listCardcorpWebhookSecrets } from './cardcorpConfig.js';

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function extractEncryptedHex(body: unknown): string {
  if (isObject(body) && typeof body.encryptedBody === 'string' && body.encryptedBody.trim()) {
    return body.encryptedBody.trim();
  }
  if (typeof body === 'string') {
    const s = body.trim();
    if (s.startsWith('{') && s.endsWith('}')) {
      try {
        const parsed = JSON.parse(s);
        if (isObject(parsed) && typeof parsed.encryptedBody === 'string' && parsed.encryptedBody.trim()) {
          return parsed.encryptedBody.trim();
        }
      } catch {
        // fall through
      }
    }
    return s;
  }
  return '';
}

export async function processCardcorpWebhookPayload(args: {
  body: unknown;
  ivHex: string;
  tagHex: string;
  receivedAt: string;
}): Promise<{ duplicate: boolean }> {
  const { body, ivHex, tagHex, receivedAt } = args;
  const encryptedHex = extractEncryptedHex(body);
  const isHex = (s: string) => /^[0-9a-f]+$/i.test(s);
  const isEvenLen = (s: string) => s.length % 2 === 0;
  const sha256Hex = (s: string) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

  // ADR-0049 — CardCorp is per-country. Each channel (CY/PT/GR) has its own
  // AES-GCM webhook secret. The webhook receiver has no operating tenant, so
  // we try each configured secret; GCM's auth tag verifies which key is right
  // (a wrong key throws in `final()`), so this never mis-attributes an event.
  const candidateSecrets = listCardcorpWebhookSecrets().filter(
    (entry) => entry.secretHex.length === 64 && isHex(entry.secretHex),
  );
  const payloadWellFormed =
    ivHex.length > 0 &&
    tagHex.length > 0 &&
    isHex(ivHex) &&
    isHex(tagHex) &&
    encryptedHex.length > 0 &&
    isHex(encryptedHex) &&
    isEvenLen(ivHex) &&
    isEvenLen(tagHex) &&
    isEvenLen(encryptedHex);
  const canDecrypt = payloadWellFormed && candidateSecrets.length > 0;

  try {
    const replay = await registerWebhookReplayAttempt({
      namespace: 'payments:cardcorp_webhook_encrypted',
      payload: encryptedHex || JSON.stringify(body || {}),
      signature: `${ivHex}:${tagHex}`,
      ttlSeconds: Math.max(300, Number(process.env.CARDCORP_WEBHOOK_REPLAY_TTL_SECONDS || 3600)),
    });
    if (replay.duplicate) {
      await writeCardcorpWebhookOutboxEvent('WEBHOOK.CARDCORP.DUPLICATE', {
        receivedAt,
        ivPresent: Boolean(ivHex),
        tagPresent: Boolean(tagHex),
      });
      return { duplicate: true };
    }

    const iv = payloadWellFormed ? Buffer.from(ivHex, 'hex') : Buffer.alloc(0);
    const tag = payloadWellFormed ? Buffer.from(tagHex, 'hex') : Buffer.alloc(0);
    const ciphertext = payloadWellFormed ? Buffer.from(encryptedHex, 'hex') : Buffer.alloc(0);
    let plaintext: string | null = null;
    let decryptedCountry: string | null = null;
    if (canDecrypt) {
      for (const candidate of candidateSecrets) {
        try {
          const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(candidate.secretHex, 'hex'), iv);
          decipher.setAuthTag(tag);
          plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
          decryptedCountry = candidate.countryCode;
          break;
        } catch {
          // Wrong key for this channel — try the next configured secret.
        }
      }
    }

    if (plaintext === null) {
      await writeCardcorpWebhookOutboxEvent('WEBHOOK.CARDCORP.ENCRYPTED', {
        receivedAt,
        ivPresent: Boolean(ivHex),
        tagPresent: Boolean(tagHex),
        bodyKind: typeof body,
        encryptedHexLen: encryptedHex.length,
        encryptedHexSha256: encryptedHex ? sha256Hex(encryptedHex) : null,
        secretConfigured: candidateSecrets.length > 0,
      });
      return { duplicate: false };
    }

    const event = JSON.parse(plaintext);

    const eventType = String(event?.type || '');
    const payloadId = String(event?.payload?.id || '');
    const customPolicyId = String(event?.payload?.customParameters?.PolicyId || '');
    const customPolicyNumber = String(event?.payload?.customParameters?.PolicyNumber || '');
    const resultCode = String(event?.payload?.result?.code || '');

    await writeCardcorpWebhookOutboxEvent('WEBHOOK.CARDCORP.DECRYPTED', {
      receivedAt,
      type: eventType,
      payloadId,
      resultCode,
      channelCountry: decryptedCountry,
      customPolicyId: customPolicyId || null,
      customPolicyNumber: customPolicyNumber || null,
    });

    if (customPolicyId) {
      const payment = await tenantScopedPrisma.payment.findFirst({
        where: { policyId: customPolicyId, provider: 'CARDCORP' },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      if (payment) {
        // --- Idempotency Lock: Prevent duplicated payment capture on Relay restart ---
        const existingEvent = await prisma.paymentEvent.findFirst({
          where: {
            paymentId: payment.id,
            eventType: 'WEBHOOK_RECEIVED',
            payload: { path: ['payloadId'], equals: payloadId }
          }
        });

        if (!existingEvent) {
          await prisma.paymentEvent.create({
            data: {
              paymentId: payment.id,
              eventType: 'WEBHOOK_RECEIVED',
              verified: true,
              payload: { type: eventType, payloadId, resultCode },
            },
          });
        }
      }
    }
    return { duplicate: false };
  } catch (e) {
    try {
      await writeCardcorpWebhookOutboxEvent('WEBHOOK.CARDCORP.ERROR', {
        receivedAt,
        message: (e as Error)?.message || String(e),
      });
    } catch {
      // ignore
    }
    return { duplicate: false };
  }
}

// @vitest-environment node
import express from 'express';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFacioBridge } from '../../../website/facioBridge';

const env = {
  FACIO_WORKSPACE_ID: 'fd24a745-736e-4e70-9ffc-3c75438246e0',
  FACIO_PROGRAM_ID: '2cf34559-0bc5-440f-9cf9-a45adc5d9ef6',
  FACIO_BINDER_ID: 'da6f948d-fa48-4758-b218-dfdc586a1df0',
  FACIO_POLICY_API_KEY: 'test-only-policy-key',
  FACIO_QUOTE_API_KEY: 'test-only-quote-key',
  FACIO_RECEIPT_KEY: 'a'.repeat(64),
};
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});
async function start(upstream: typeof fetch, configuration: NodeJS.ProcessEnv = env) {
  const app = express();
  app.use(express.json());
  app.use(
    '/api',
    createFacioBridge({
      fetch: upstream,
      env: configuration,
      now: () => Date.parse('2026-09-10T08:00:00Z'),
    }),
  );
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test address');
  return `http://127.0.0.1:${address.port}/api`;
}
const reply = (data: unknown) => Response.json({ success: true, data });
const send = (url: string, body: unknown, key = 'same-browser-attempt') =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify(body),
  });
describe('Facio website boundary', () => {
  it.each(['DIRECT', 'DISTRIBUTION'] as const)(
    'reads %s intake with only its own configured credential',
    async (channel) => {
      const upstream = vi.fn<typeof fetch>().mockResolvedValue(
        reply({
          title: 'Rental',
          questionnaire: { sections: [] },
          coverageOptions: [],
          definition: { private: true },
        }),
      );
      const ownKey = channel === 'DIRECT' ? env.FACIO_POLICY_API_KEY : env.FACIO_QUOTE_API_KEY;
      const configuration = {
        ...env,
        [channel === 'DIRECT' ? 'FACIO_QUOTE_API_KEY' : 'FACIO_POLICY_API_KEY']: undefined,
      };
      const base = await start(upstream, configuration);
      const response = await fetch(`${base}/quote?channel=${channel}`);
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(JSON.parse(text).data).toEqual({
        intake: { title: 'Rental', questionnaire: { sections: [] }, coverageOptions: [] },
      });
      expect(text).not.toContain('private');
      expect(text).not.toContain(env.FACIO_POLICY_API_KEY);
      expect(upstream.mock.calls[0][0]).toContain(
        `/programmes/${env.FACIO_PROGRAM_ID}/intake?binderId=${env.FACIO_BINDER_ID}`,
      );
      expect(upstream.mock.calls[0][1]?.headers).toMatchObject({
        Authorization: `Bearer ${ownKey}`,
      });
    },
  );
  it('reaches the configuration gate without query metadata and still rejects unknown business queries', async () => {
    const upstream = vi.fn<typeof fetch>();
    const base = await start(upstream, {});
    expect((await fetch(`${base}/quote?channel=DIRECT`)).status).toBe(503);
    expect((await fetch(`${base}/quote?channel=DISTRIBUTION`)).status).toBe(503);
    expect((await fetch(`${base}/quote`)).status).toBe(400);
    for (const query of [
      'channel=DIRECT&path=quote',
      'channel=DIRECT&programId=untrusted',
      'channel=DIRECT&binderId=untrusted',
      'channel=unknown',
      'channel=DIRECT&channel=DISTRIBUTION',
    ]) {
      const response = await fetch(`${base}/quote?${query}`);
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe('INVALID_REQUEST');
    }
    expect(upstream).not.toHaveBeenCalled();
  });
  it.each(['DIRECT', 'DISTRIBUTION'] as const)(
    'does not borrow the other credential when %s intake key is missing',
    async (channel) => {
      const upstream = vi.fn<typeof fetch>();
      const configuration = {
        ...env,
        [channel === 'DIRECT' ? 'FACIO_POLICY_API_KEY' : 'FACIO_QUOTE_API_KEY']: undefined,
      };
      const base = await start(upstream, configuration);
      const response = await fetch(`${base}/quote?channel=${channel}`);
      expect(response.status).toBe(503);
      expect((await response.json()).error.code).toBe('FACIO_NOT_CONFIGURED');
      expect(upstream).not.toHaveBeenCalled();
    },
  );
  it('pins configuration and preserves all submitted answers and retry identity', async () => {
    const data = {
      quoteId: 'fde155dc-ff7d-4675-aa20-6f7d7d227772',
      quoteToken: 'private-upstream-quote-token',
      bindable: true,
      status: 'QUOTED',
      premiumCalculated: 131.84,
      currency: 'USD',
      expiresAt: '2026-09-10T08:20:00Z',
      quoteResponse: {},
    };
    const upstream = vi.fn<typeof fetch>().mockImplementation(async () => reply(data));
    const base = await start(upstream);
    const input = {
      channel: 'DIRECT',
      quoteData: {
        proposer: { firstName: 'Synthetic', lastName: 'Renter', email: 'renter@example.invalid' },
        driver: { licenceNumber: 'DEMO-ONLY' },
        policy: { startAt: '2026-09-18T10:00:00-06:00' },
      },
    };
    const first = await (await send(`${base}/quote`, input)).json();
    await send(`${base}/quote`, input);
    expect(first.data.receipt).toEqual(expect.any(String));
    expect(first.data.quoteToken).toBeUndefined();
    expect(JSON.stringify(first)).not.toContain(data.quoteToken);
    expect(JSON.parse(String(upstream.mock.calls[0][1]?.body))).toEqual({
      programId: env.FACIO_PROGRAM_ID,
      binderId: env.FACIO_BINDER_ID,
      quoteData: input.quoteData,
    });
    expect(upstream.mock.calls[0][1]?.headers).toEqual(upstream.mock.calls[1][1]?.headers);
  });
  it('does not convert referral into a bindable success', async () => {
    const upstream = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        reply({ quoteId: 'real-quote', status: 'REFERRAL', bindable: false, quoteResponse: {} }),
      );
    const base = await start(upstream);
    const result = await (
      await send(`${base}/quote`, { channel: 'DISTRIBUTION', quoteData: {} })
    ).json();
    expect(result.data).toMatchObject({ status: 'REFERRAL', bindable: false, receipt: null });
  });
  it('rejects caller-selected identity and invalid operation keys before any upstream mutation', async () => {
    const upstream = vi.fn<typeof fetch>();
    const base = await start(upstream);
    expect(
      (
        await send(`${base}/quote`, {
          channel: 'DIRECT',
          workspaceId: env.FACIO_WORKSPACE_ID,
          quoteData: {},
        })
      ).status,
    ).toBe(400);
    expect((await send(`${base}/quote`, { channel: 'DIRECT', quoteData: {} }, 'bad')).status).toBe(
      400,
    );
    expect(upstream).not.toHaveBeenCalled();
  });
  it('has no simulated fallback when configuration or upstream is unavailable', async () => {
    const upstream = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error('do not expose internal secrets'));
    const base = await start(upstream, {});
    expect((await fetch(`${base}/quote?channel=DIRECT`)).status).toBe(503);
    expect((await fetch(`${base}/quote?channel=DISTRIBUTION`)).status).toBe(503);
    expect((await fetch(`${base}/quote`)).status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
    const configured = await start(upstream);
    const result = await send(`${configured}/quote`, { channel: 'DIRECT', quoteData: {} });
    expect(result.status).toBe(502);
    expect(await result.text()).not.toContain('internal secrets');
    expect(upstream).toHaveBeenCalledTimes(1);
  });
  it('keeps bind unavailable until the shared completion contract exists', async () => {
    const upstream = vi.fn<typeof fetch>();
    const base = await start(upstream);
    const result = await send(`${base}/bind`, {});
    expect(result.status).toBe(503);
    expect((await result.json()).error.code).toBe('FACIO_BIND_NOT_READY');
    expect(upstream).not.toHaveBeenCalled();
  });
});

const quoteId = 'fde155dc-ff7d-4675-aa20-6f7d7d227772';
const quoteResult = {
  quoteId,
  quoteToken: 'private-upstream-quote-token',
  bindable: true,
  status: 'QUOTED',
  premiumCalculated: 131.84,
  currency: 'USD',
  expiresAt: '2026-09-10T08:20:00Z',
  quoteResponse: {},
};
const offer = {
  policyId: quoteId,
  workspaceId: env.FACIO_WORKSPACE_ID,
  definition: { id: 'd492d370-637f-4ab0-9d8f-bdafe889832b', version: 4, hash: 'definition-hash' },
  currentHash: 'current-hash',
  riskHash: 'risk-hash',
  premium: 131.84,
  currency: 'USD',
  offerId: '840cdd92-08a4-455d-a5ee-15c87308efac',
  quoteVersionId: '03b589fa-7e93-41c5-a2f2-790eaab4b3e2',
  expectedVersionHash: 'version-hash',
  acceptanceKind: 'STAFF_RECORDED',
  acceptanceSource: 'WEBSITE_REPORTED',
  paymentMode: 'SIMULATED',
};
const enabled = { ...env, FACIO_CHECKOUT_ENABLED: 'true' };
async function quoteReceipt(base: string, channel = 'DIRECT') {
  return (await (await send(`${base}/quote`, { channel, quoteData: {} })).json()).data
    .receipt as string;
}
describe('Reviewed machine checkout contract', () => {
  it('requires review and explicit confirmation; preserves exact phase bodies and keys on retry', async () => {
    const upstream = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        reply(
          String(url).endsWith('/quotes')
            ? quoteResult
            : String(url).endsWith('/review')
              ? offer
              : { policyId: quoteId, status: 'ACTIVE', issuedAt: '2026-09-10T08:01:00Z' },
        ),
      );
    const base = await start(upstream, enabled);
    const receipt = await quoteReceipt(base);
    expect(
      (await send(`${base}/bind`, { action: 'complete', receipt, confirmed: true })).status,
    ).toBe(409);
    const review = await (await send(`${base}/bind`, { action: 'review', receipt })).json();
    expect(JSON.stringify(review)).not.toContain('definition-hash');
    expect(
      (
        await send(`${base}/bind`, {
          action: 'complete',
          receipt: review.data.receipt,
          confirmed: false,
        })
      ).status,
    ).toBe(400);
    const body = { action: 'complete', receipt: review.data.receipt, confirmed: true };
    expect((await send(`${base}/bind`, body)).status).toBe(200);
    expect((await send(`${base}/bind`, body)).status).toBe(200);
    const phases = upstream.mock.calls.slice(2).filter(([url]) => !String(url).endsWith('/status'));
    expect(phases.map(([url]) => String(url).split('/').at(-1))).toEqual([
      'accept',
      'test-payment',
      'complete',
      'accept',
      'test-payment',
      'complete',
    ]);
    for (let index = 0; index < 3; index++) {
      expect(phases[index][1]?.body).toBe(phases[index + 3][1]?.body);
      expect(phases[index][1]?.headers).toEqual(phases[index + 3][1]?.headers);
    }
    const accepted = JSON.parse(String(phases[0][1]?.body));
    expect(accepted).toMatchObject({
      confirmed: true,
      offerId: offer.offerId,
      quoteVersionId: offer.quoteVersionId,
      expectedCurrentHash: offer.currentHash,
      expectedDefinitionHash: offer.definition.hash,
      expectedVersionHash: offer.expectedVersionHash,
    });
    expect(accepted).not.toHaveProperty('workspaceId');
    expect(accepted).not.toHaveProperty('premium');
  });
  it('rejects partner receipts, modified receipts, and changed reviewed premium before acceptance', async () => {
    const upstream = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        reply(String(url).endsWith('/quotes') ? quoteResult : { ...offer, premium: 150 }),
      );
    const base = await start(upstream, enabled);
    const partner = await quoteReceipt(base, 'DISTRIBUTION');
    expect((await send(`${base}/bind`, { action: 'review', receipt: partner })).status).toBe(403);
    const receipt = await quoteReceipt(base);
    expect(
      (await send(`${base}/bind`, { action: 'review', receipt: `X${receipt.slice(1)}` })).status,
    ).toBe(409);
    expect((await send(`${base}/bind`, { action: 'review', receipt })).status).toBe(409);
    expect(upstream.mock.calls.some(([url]) => String(url).endsWith('/accept'))).toBe(false);
  });
  it('never advances past a failed payment and does not manufacture an issued success', async () => {
    const upstream = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        String(url).endsWith('/test-payment')
          ? Response.json(
              { success: false, error: { code: 'TEST_PAYMENT_DENIED', message: 'Not allowed' } },
              { status: 409 },
            )
          : reply(
              String(url).endsWith('/quotes')
                ? quoteResult
                : String(url).endsWith('/review')
                  ? offer
                  : { accepted: true },
            ),
      );
    const base = await start(upstream, enabled);
    const receipt = await quoteReceipt(base);
    const review = await (await send(`${base}/bind`, { action: 'review', receipt })).json();
    expect(
      (
        await send(`${base}/bind`, {
          action: 'complete',
          receipt: review.data.receipt,
          confirmed: true,
        })
      ).status,
    ).toBe(409);
    expect(upstream.mock.calls.some(([url]) => String(url).endsWith('/complete'))).toBe(false);
  });
});

const riskTransactionId = '9e06d4d6-4c7c-4a91-b7b5-e1316df724c6';
const documentId = '13f5c3df-4aaf-4c6e-bd64-f21b8f832ddd';
const pdfBytes = Buffer.from('%PDF-1.7\nsynthetic transport test bytes\n%%EOF');
describe('Issued status and bound document transport', () => {
  it('returns actual future-issued state and proxies the exact retained PDF without exposing credentials', async () => {
    const upstream = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      const path = String(url);
      if (path.endsWith('/quotes')) return reply(quoteResult);
      if (path.endsWith('/review')) return reply(offer);
      if (path.endsWith('/status'))
        return reply({
          policyId: quoteId,
          status: 'ISSUED',
          issuedAt: '2026-09-10T08:01:00Z',
          policyNumber: 'SYNTHETIC-123',
          riskTransactionId,
        });
      if (path.endsWith('/documents'))
        return reply({
          policyId: quoteId,
          riskTransactionId,
          status: 'ready',
          requestId: 'retained-request',
          errorCode: null,
          documents: [
            { id: documentId, type: 'SCHEDULE', filename: 'schedule.pdf', status: 'GENERATED' },
          ],
        });
      if (path.endsWith('/content'))
        return new Response(pdfBytes, { headers: { 'Content-Type': 'application/pdf' } });
      return reply({ success: true });
    });
    const base = await start(upstream, enabled);
    const quote = await quoteReceipt(base);
    const review = (await (await send(`${base}/bind`, { action: 'review', receipt: quote })).json())
      .data;
    const complete = (
      await (
        await send(`${base}/bind`, { action: 'complete', receipt: review.receipt, confirmed: true })
      ).json()
    ).data;
    expect(complete).toMatchObject({
      status: 'ISSUED',
      issuedAt: '2026-09-10T08:01:00Z',
      documentsStatus: 'ready',
      documents: [{ id: documentId, filename: 'schedule.pdf' }],
    });
    const response = await send(`${base}/bind`, {
      action: 'document',
      receipt: complete.receipt,
      documentId,
    });
    expect(response.headers.get('content-type')).toContain('application/pdf');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(pdfBytes);
    expect(
      (
        await send(`${base}/bind`, {
          action: 'document',
          receipt: complete.receipt,
          documentId: offer.offerId,
        })
      ).status,
    ).toBe(409);
    expect((await send(`${base}/bind`, { action: 'status', receipt: quote })).status).toBe(409);
    expect(JSON.stringify(complete)).not.toContain(env.FACIO_POLICY_API_KEY);
  });
  it('uses distinct machine credentials for Summit quotes and Direct lifecycle', async () => {
    const upstream = vi.fn<typeof fetch>().mockImplementation(async () => reply(quoteResult));
    const base = await start(upstream, enabled);
    await quoteReceipt(base, 'DISTRIBUTION');
    await quoteReceipt(base, 'DIRECT');
    expect(upstream.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: `Bearer ${env.FACIO_QUOTE_API_KEY}`,
    });
    expect(upstream.mock.calls[1][1]?.headers).toMatchObject({
      Authorization: `Bearer ${env.FACIO_POLICY_API_KEY}`,
    });
  });
});

describe('Incomplete issuance recovery', () => {
  it('keeps a BOUND-only result retryable instead of granting completed-policy access', async () => {
    const upstream = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        reply(
          String(url).endsWith('/quotes')
            ? quoteResult
            : String(url).endsWith('/review')
              ? offer
              : { policyId: quoteId, status: 'BOUND', issuedAt: null },
        ),
      );
    const base = await start(upstream, enabled);
    const receipt = await quoteReceipt(base);
    const review = (await (await send(`${base}/bind`, { action: 'review', receipt })).json()).data;
    const result = await send(`${base}/bind`, {
      action: 'complete',
      receipt: review.receipt,
      confirmed: true,
    });
    expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({
      success: false,
      error: { code: 'ISSUANCE_NOT_CONFIRMED' },
    });
  });
});

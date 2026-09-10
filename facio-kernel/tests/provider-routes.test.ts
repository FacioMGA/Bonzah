import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import type { Kernel } from '../src/application/kernel.js';
import { KernelError } from '../src/domain/canonical.js';
import { providerRoutes } from '../src/server/provider-routes.js';

function ingress() {
  const calls: { adapter: string; request: string; body: Uint8Array; headers: unknown }[] = [];
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    reply
      .code(
        error instanceof KernelError
          ? error.status
          : ((error as { statusCode?: number }).statusCode ?? 500),
      )
      .send({
        code: error instanceof KernelError ? error.code : 'ERROR',
      });
  });
  providerRoutes(app, {
    providers: {
      acceptCallback(adapter: string, request: string, body: Uint8Array, headers: unknown) {
        calls.push({ adapter, request, body, headers });
        return { internalEvidence: 'must never be returned' };
      },
    },
  } as unknown as Kernel);
  return { app, calls };
}

test('provider ingress preserves exact bytes for adapter authentication and exposes only receipt acknowledgment', async () => {
  const { app, calls } = ingress();
  const id = randomUUID();
  const body = '{  "untrusted" : "\u05e9\u05dc\u05d5\u05dd", "scope": "cannot authorize" }\n';
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/provider-callbacks/test-adapter/${id}`,
      headers: { 'content-type': 'application/json', 'x-provider-signature': 'signed-exact-bytes' },
      payload: body,
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { received: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.adapter, 'test-adapter');
    assert.equal(calls[0]!.request, id);
    assert.deepEqual(Buffer.from(calls[0]!.body), Buffer.from(body));
    assert.equal(
      (calls[0]!.headers as Record<string, string>)['x-provider-signature'],
      'signed-exact-bytes',
    );
    const oversized = await app.inject({
      method: 'POST',
      url: `/provider-callbacks/test-adapter/${id}`,
      headers: { 'content-type': 'application/json' },
      payload: 'x'.repeat(1_048_577),
    });
    assert.equal(oversized.statusCode, 413);
    assert.equal(calls.length, 1);
  } finally {
    await app.close();
  }
});

test('callback rate capacity expires after a full 1000-address window and enforces per-address limits', async () => {
  const { app, calls } = ingress();
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  const post = (ip: string) =>
    app.inject({
      method: 'POST',
      url: `/provider-callbacks/test-adapter/${randomUUID()}`,
      headers: { 'content-type': 'application/json' },
      payload: '{}',
      remoteAddress: ip,
    });
  try {
    for (let i = 0; i < 1000; i++)
      assert.equal((await post(`10.0.${Math.floor(i / 256)}.${i % 256}`)).statusCode, 200);
    assert.equal((await post('10.1.0.1')).statusCode, 429);
    now += 60_001;
    assert.equal((await post('10.1.0.1')).statusCode, 200);
    for (let i = 1; i < 120; i++) assert.equal((await post('10.1.0.1')).statusCode, 200);
    assert.equal((await post('10.1.0.1')).statusCode, 429);
    assert.equal(calls.length, 1120);
  } finally {
    Date.now = originalNow;
    await app.close();
  }
});

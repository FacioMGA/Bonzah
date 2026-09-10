/* @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionAdapter } from '../adapters/sessionAdapter';

// Mock at the network boundary per docs/develop/test.md mock policy.
// The adapter is the canonical wire-up for the public session API
// across motor / home / travel; this file pins the URL contract
// (productCode-driven path) + the success/error response shapes.

type FetchSpy = ReturnType<typeof vi.fn>;

function mockFetch(): FetchSpy {
  // `vi.fn().mockResolvedValue(...)` returns a Mock that is structurally
  // assignable to FetchSpy without a double-cast through `unknown`. This
  // keeps the narrow `any-baseline` ratchet honest.
  const spy: FetchSpy = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, data: {} }),
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

describe('sessionAdapter — public session wire contract', () => {
  let fetchSpy: FetchSpy;

  beforeEach(() => {
    fetchSpy = mockFetch();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('create() POSTs to the productCode-lowercased session collection URL', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: { publicSessionToken: 'tok_1' } }),
    });
    const adapter = createSessionAdapter({ productCode: 'HOME' });
    const result = await adapter.create();
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/public/home/session',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result.ok).toBe(true);
    expect(result.publicId).toBe('tok_1');
  });

  it('create() includes an optional quoteData seed in the request body', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: { publicSessionToken: 'tok_seeded' } }),
    });
    const adapter = createSessionAdapter({ productCode: 'health' });
    const result = await adapter.create({ quoteData: { plan: { code: 'immigration' } } });
    const [, init] = fetchSpy.mock.calls[0];
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body ?? '{}')).toEqual({ quoteData: { plan: { code: 'immigration' } } });
    expect(result.publicId).toBe('tok_seeded');
  });

  it('load() GETs the token-keyed session URL with the token URL-encoded', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: { quoteData: { foo: 1 } } }),
    });
    const adapter = createSessionAdapter({ productCode: 'travel' });
    const result = await adapter.load('tok with space');
    expect(fetchSpy).toHaveBeenCalledWith('/api/public/travel/session/tok%20with%20space');
    expect(result.ok).toBe(true);
    expect(result.session).toEqual({ quoteData: { foo: 1 } });
  });

  it('patch() PATCHes the session URL with the patch body', async () => {
    fetchSpy.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, data: {} }) });
    const adapter = createSessionAdapter({ productCode: 'motor' });
    await adapter.patch('tok_2', { policyHolder: { firstName: 'Test' } });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/public/motor/session/tok_2');
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(init?.body ?? '{}')).toEqual({ policyHolder: { firstName: 'Test' } });
  });

  it('rate() POSTs to the /rate suffix', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: { primaryOption: {} } }),
    });
    const adapter = createSessionAdapter({ productCode: 'home' });
    const result = await adapter.rate('tok_3');
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/public/home/session/tok_3/rate',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result.ok).toBe(true);
  });

  it('issue() returns the policyId from data.policyId', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: { policyId: 'pol_9' } }),
    });
    const adapter = createSessionAdapter({ productCode: 'home' });
    const result = await adapter.issue('tok_4');
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/public/home/session/tok_4/issue',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result.policyId).toBe('pol_9');
  });

  it('fork() returns publicId from data.publicSessionToken', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: { publicSessionToken: 'tok_forked' } }),
    });
    const adapter = createSessionAdapter({ productCode: 'travel' });
    const result = await adapter.fork('tok_5');
    expect(result.publicId).toBe('tok_forked');
  });

  it('reports !ok and surfaces the error message on a server-side failure', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ success: false, error: { message: 'binder not active' } }),
    });
    const adapter = createSessionAdapter({ productCode: 'travel' });
    const result = await adapter.create();
    expect(result.ok).toBe(false);
    expect(result.error).toBe('binder not active');
  });

  it('tolerates a non-JSON response without throwing (load returns ok:false)', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      json: async () => {
        throw new Error('not json');
      },
    });
    const adapter = createSessionAdapter({ productCode: 'home' });
    const result = await adapter.load('tok_bad');
    expect(result.ok).toBe(false);
    expect(result.session).toBeNull();
  });
});

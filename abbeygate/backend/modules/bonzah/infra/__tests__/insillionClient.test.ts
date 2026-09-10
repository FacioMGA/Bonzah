import { afterEach, describe, expect, it, vi } from 'vitest';
import { InsillionClient, InsillionProviderError } from '../insillionClient.js';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const config = { baseUrl: 'https://bonzah.sb.insillion.com', username: 'user', password: 'secret', timeoutMs: 1000 };
afterEach(() => vi.unstubAllEnvs());

describe('Insillion client', () => {
  it.each([new Response('<html>gateway</html>', { status: 502 }), json({ status: 1 }, 500), json({ data: {} })])('treats invalid mutation responses as ambiguous', async (response) => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ status: 0, data: { token: 'token-1' } })).mockResolvedValueOnce(response);
    const client = new InsillionClient(config, fetcher);
    await expect(client.finalizeQuote({ finalize: 1 })).rejects.toMatchObject({ code: 'PROVIDER_RECONCILIATION_REQUIRED', ambiguous: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('blocks live provider mutations before authentication', async () => {
    const fetcher = vi.fn();
    const client = new InsillionClient({ ...config, baseUrl: 'https://bonzah.insillion.com' }, fetcher);
    await expect(client.payment({ payment_id: 'PY1', amount: 42 })).rejects.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('blocks mutations in production even when configured for the sandbox', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const fetcher = vi.fn();
    const client = new InsillionClient(config, fetcher);
    await expect(client.finalizeQuote({ finalize: 1 })).rejects.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('deduplicates authentication and reads data.token', async () => {
    const fetcher = vi.fn(async () => json({ status: 0, data: { token: 'token-1' } }));
    const client = new InsillionClient(config, fetcher as typeof fetch);
    expect(await Promise.all([client.authenticate(), client.authenticate()])).toEqual(['token-1', 'token-1']);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('refreshes once after a 401 for a retry-safe request', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ status: 0, data: { token: 'token-1' } }))
      .mockResolvedValueOnce(json({ status: 1, txt: 'expired' }, 401))
      .mockResolvedValueOnce(json({ status: 0, data: { token: 'token-2' } }))
      .mockResolvedValueOnce(json({ status: 0, data: { total_premium: 42 } }));
    const client = new InsillionClient(config, fetcher as typeof fetch);
    await expect(client.premium({ trip_start_date: '01/01/2027' })).resolves.toMatchObject({ status: 0 });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('marks an unconfirmed mutation as requiring reconciliation', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ status: 0, data: { token: 'token-1' } }))
      .mockRejectedValueOnce(new Error('timeout'));
    const client = new InsillionClient(config, fetcher as typeof fetch);
    await expect(client.payment({ payment_id: 'PY1', amount: 42 })).rejects.toMatchObject({ code: 'PROVIDER_RECONCILIATION_REQUIRED', ambiguous: true } satisfies Partial<InsillionProviderError>);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { patchPublicSessionQuoteData } from './quoteWizard.api';

describe('quoteWizard.api network failures (ABY-443 / REACT-F)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('returns status 0 instead of throwing when fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(patchPublicSessionQuoteData({
      policyId: 'pol_1',
      quoteData: { step: 1 },
      step: 'vehicle',
    })).resolves.toEqual({ ok: false, status: 0, json: null });
  });

  it('honours Retry-After before retrying a throttled quote save', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, {
        status: 429,
        headers: { 'Retry-After': '3' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ saved: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchMock);

    const pending = patchPublicSessionQuoteData({
      policyId: 'pol_1',
      quoteData: { step: 1 },
      step: 'vehicle',
    });
    await vi.advanceTimersByTimeAsync(2_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    await expect(pending).resolves.toEqual({
      ok: true,
      status: 200,
      json: { saved: true },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

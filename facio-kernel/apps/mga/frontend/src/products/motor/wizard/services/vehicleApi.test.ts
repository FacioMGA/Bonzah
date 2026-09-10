/* @vitest-environment happy-dom */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

describe('vehicleApi fallback behavior', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    window.localStorage.clear();
  });

  it('returns an empty list when the backend vehicle proxy is unavailable', async () => {
    // ABY-28 / ABY-31 / ABY-35 retrospective: the frontend used to
    // fall back to a curated local list, but that silently masked
    // missing makes when the backend curated/vPIC merge had bugs.
    // The contract is now: if the same-origin backend proxy fails,
    // return [] so the UI renders the empty state and prompts the user
    // to retry — never a stale subset or CSP-blocked browser vPIC call.
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500 }) as typeof fetch;
    const { vehicleApi } = await import('./vehicleApi');
    const out = await vehicleApi.getAllMakeOptions();
    expect(Array.isArray(out)).toBe(true);
    expect(out).toEqual([]);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('handles partial backend responses without crashing', async () => {
    const fetchMock: typeof fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ value: 'BMW' }, { label: 'Audi' }, null] }), { status: 200 }));
    global.fetch = fetchMock;
    const { vehicleApi } = await import('./vehicleApi');
    const out = await vehicleApi.getAllMakeOptions();
    expect(Array.isArray(out)).toBe(true);
    expect(out.find((x) => x.value === 'BMW')).toBeTruthy();
  });

  it('ignores stale v2 make/model option caches after the catalog-shape fix', async () => {
    window.localStorage.setItem('vehicle.makeOptions.v2', JSON.stringify({
      at: Date.now(),
      data: [{ value: 'C-Class', label: 'C-Class' }],
    }));
    window.localStorage.setItem('vehicle.modelOptions.v2.mercedes-benz', JSON.stringify({
      at: Date.now(),
      data: [],
    }));

    const fetchMock: typeof fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ value: 'Mercedes-Benz', label: 'Mercedes-Benz' }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ value: 'C-Class', label: 'C-Class' }] }), { status: 200 }));
    global.fetch = fetchMock;

    const { vehicleApi } = await import('./vehicleApi');

    await expect(vehicleApi.getAllMakeOptions()).resolves.toEqual([
      { value: 'Mercedes-Benz', label: 'Mercedes-Benz' },
    ]);
    await expect(vehicleApi.getModelOptionsForMake('Mercedes-Benz')).resolves.toEqual([
      { value: 'C-Class', label: 'C-Class' },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

/* @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QuoteData } from '../../types';
import { initialQuoteData } from '../../quoteWizard.constants';
import {
  __resetStep4QuoteApiCaches,
  generateStep4QuoteDocuments,
  loadStep4ExtrasPricing,
  loadStep4Recommendations,
} from './step4QuoteApi';

describe('step4QuoteApi', () => {
  afterEach(() => {
    __resetStep4QuoteApiCaches();
    vi.restoreAllMocks();
  });

  it('dedupes concurrent recommendations requests for same key', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ success: true, data: { recommendations: [] } }), { status: 200 }));
    await Promise.all([
      loadStep4Recommendations({ key: 'p:q', policyId: 'p', fetchFn }),
      loadStep4Recommendations({ key: 'p:q', policyId: 'p', fetchFn }),
    ]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('uses short TTL cache for recommendations', async () => {
    let now = 1_000;
    const nowMs = () => now;
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ success: true, data: { recommendations: [] } }), { status: 200 }));
    await loadStep4Recommendations({ key: 'policy:quote', policyId: 'policy', fetchFn, nowMs });
    now += 500;
    await loadStep4Recommendations({ key: 'policy:quote', policyId: 'policy', fetchFn, nowMs });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('caches extras pricing previews by cache key', async () => {
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}')) as { coverageSelection?: { selected?: Record<string, boolean> } };
      const selected = body.coverageSelection?.selected || {};
      const annual = selected['COV-ROADSIDE-VIP'] ? 900 : selected['CV 172'] ? 910 : 870;
      return new Response(JSON.stringify({ success: true, data: { primaryOption: { annualPremium: annual } } }), { status: 200 });
    });

    const data: QuoteData = { ...initialQuoteData };
    const first = await loadStep4ExtrasPricing({
      cacheKey: 'token:q:500:0:0',
      policyId: 'token',
      data,
      baseExcess: 500,
      baseAnnual: 870,
      currentHasNcbFromQuote: false,
      currentHasVipFromQuote: false,
      currentHasRoadsideFromQuote: false,
      isComprehensiveCover: true,
      fetchFn,
    });
    const second = await loadStep4ExtrasPricing({
      cacheKey: 'token:q:500:0:0',
      policyId: 'token',
      data,
      baseExcess: 500,
      baseAnnual: 870,
      currentHasNcbFromQuote: false,
      currentHasVipFromQuote: false,
      currentHasRoadsideFromQuote: false,
      isComprehensiveCover: true,
      fetchFn,
    });

    expect(first.vipAnnual).toBe(900);
    expect(second.ncbAnnual).toBe(910);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('requests quote pack documents from backend endpoint', async () => {
    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({
          success: true,
          data: { documents: [{ type: 'MOTOR_QUOTE_PDF', publicUrl: 'https://example.test/quote.pdf' }] },
        }),
        { status: 200 },
      ),
    );

    const result = await generateStep4QuoteDocuments({ policyId: 'policy-123', fetchFn });

    expect(fetchFn).toHaveBeenCalledWith(
      '/api/public/motor/session/policy-123/documents/generate',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.documents[0]?.publicUrl).toBe('https://example.test/quote.pdf');
    }
  });
});

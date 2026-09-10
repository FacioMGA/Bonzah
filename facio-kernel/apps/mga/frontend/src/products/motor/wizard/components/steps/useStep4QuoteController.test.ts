/* @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { QuoteData, QuoteResponse } from '../../types';
import { initialQuoteData } from '../../quoteWizard.constants';
import { useStep4QuoteController } from './useStep4QuoteController';
import { __resetStep4QuoteApiCaches } from './step4QuoteApi';

function makeQuotedResponse(): QuoteResponse {
  return {
    status: 'quoted',
    reference: 'ABQ-STEP4',
    validUntil: new Date().toISOString(),
    currency: 'EUR',
    alternatives: [],
    warnings: [],
    primaryOption: {
      name: 'Comprehensive',
      annualPremium: 870,
      totalExcess: 500,
      voluntaryExcess: 500,
      breakdown: {
        tplBase: 100,
        tplClaimsFactor: 1,
        tplMileageFactor: 1,
        tplLicenseFactor: 1,
        tplFinal: 100,
        compBase: 700,
        compAgeFactor: 1,
        compClaimsFactor: 1,
        compExcessFactor: 1,
        compLicenseFactor: 1,
        compFinal: 700,
        windscreen: 70,
        finalPremium: 870,
      },
      costDetails: {
        grossPremium: 870,
        ncdAmount: 0,
        onlineDiscount: 0,
        subtotalNetPremium: 870,
        mifSurcharge: 0,
        tax: 0,
        policyFee: 0,
        totalPremium: 870,
      },
      calculationTrace: { steps: [] },
    },
  };
}

describe('useStep4QuoteController', () => {
  afterEach(() => {
    __resetStep4QuoteApiCaches();
    vi.restoreAllMocks();
  });

  it('loads recommendations and extras without double-firing on rerender', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/recommendations/events')) {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      if (url.includes('/recommendations')) {
        return new Response(JSON.stringify({ success: true, data: { recommendations: [] } }), { status: 200 });
      }
      if (url.includes('/rate')) {
        return new Response(JSON.stringify({ success: true, data: { primaryOption: { annualPremium: 900 } } }), { status: 200 });
      }
      return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const quote = makeQuotedResponse();
    const data: QuoteData = { ...initialQuoteData };

    const { result, rerender } = renderHook((props: {
      policyId: string;
      quoteStatus: string | undefined;
      quoteReference: string;
      quote: QuoteResponse | null;
      data: QuoteData;
      isComprehensiveCover: boolean;
      currentHasNcbFromQuote: boolean;
      currentHasVipFromQuote: boolean;
      currentHasRoadsideFromQuote: boolean;
      onProceedToPayment: () => void;
      onRequestCall: () => Promise<void>;
      onRatedQuote: (raw: unknown) => void;
    }) => useStep4QuoteController(props), {
      initialProps: {
        policyId: 'token-123',
        quoteStatus: quote.status,
        quoteReference: quote.reference,
        quote,
        data,
        isComprehensiveCover: true,
        currentHasNcbFromQuote: false,
        currentHasVipFromQuote: false,
        currentHasRoadsideFromQuote: false,
        onProceedToPayment: () => undefined,
        onRequestCall: async () => undefined,
        onRatedQuote: () => undefined,
      },
    });

    await waitFor(() => {
      expect(result.current.recommendations.initialDone).toBe(true);
      expect(result.current.extras.initialDone).toBe(true);
      expect(result.current.recommendations.loading).toBe(false);
      expect(result.current.extras.pricing.loading).toBe(false);
    });

    rerender({
      policyId: 'token-123',
      quoteStatus: quote.status,
      quoteReference: quote.reference,
      quote,
      data,
      isComprehensiveCover: true,
      currentHasNcbFromQuote: false,
      currentHasVipFromQuote: false,
      currentHasRoadsideFromQuote: false,
      onProceedToPayment: () => undefined,
      onRequestCall: async () => undefined,
      onRatedQuote: () => undefined,
    });

    await waitFor(() => {
      const recommendationCalls = fetchMock.mock.calls.filter(([url]) => {
        const u = String(url);
        return u.includes('/recommendations') && !u.includes('/recommendations/events');
      });
      expect(recommendationCalls.length).toBe(1);
    });
  });

  it('treats uppercase quote status as quoted for step4 loading', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/recommendations/events')) {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      if (url.includes('/recommendations')) {
        return new Response(JSON.stringify({ success: true, data: { recommendations: [] } }), { status: 200 });
      }
      if (url.includes('/rate')) {
        return new Response(JSON.stringify({ success: true, data: { primaryOption: { annualPremium: 900 } } }), { status: 200 });
      }
      return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const quote = makeQuotedResponse();
    const data: QuoteData = { ...initialQuoteData };
    const { result } = renderHook(() => useStep4QuoteController({
      policyId: 'token-123',
      quoteStatus: 'QUOTED',
      quoteReference: quote.reference,
      quote,
      data,
      isComprehensiveCover: true,
      currentHasNcbFromQuote: false,
      currentHasVipFromQuote: false,
      currentHasRoadsideFromQuote: false,
      onProceedToPayment: () => undefined,
      onRequestCall: async () => undefined,
      onRatedQuote: () => undefined,
    }));

    await waitFor(() => {
      expect(result.current.recommendations.initialDone).toBe(true);
      expect(result.current.extras.initialDone).toBe(true);
      expect(result.current.recommendations.loading).toBe(false);
      expect(result.current.extras.pricing.loading).toBe(false);
    });
  });

  it('handles callback request success and proceed action', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/recommendations')) return new Response(JSON.stringify({ success: true, data: { recommendations: [] } }), { status: 200 });
      if (url.includes('/rate')) return new Response(JSON.stringify({ success: true, data: { primaryOption: { annualPremium: 900 } } }), { status: 200 });
      return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 });
    }));
    const onProceedToPayment = vi.fn();
    const onRequestCall = vi.fn(async () => undefined);
    const quote = makeQuotedResponse();
    const data: QuoteData = { ...initialQuoteData };
    const { result } = renderHook(() => useStep4QuoteController({
      policyId: 'token-123',
      quoteStatus: quote.status,
      quoteReference: quote.reference,
      quote,
      data,
      isComprehensiveCover: true,
      currentHasNcbFromQuote: false,
      currentHasVipFromQuote: false,
      currentHasRoadsideFromQuote: false,
      onProceedToPayment,
      onRequestCall,
      onRatedQuote: () => undefined,
    }));
    await waitFor(() => expect(result.current.recommendations.initialDone).toBe(true));
    await act(async () => {
      await result.current.actions.requestCallback();
    });
    expect(onRequestCall).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(result.current.communications.callbackRequested).toBe(true);
    });
    act(() => {
      result.current.actions.proceedToPayment();
    });
    expect(onProceedToPayment).toHaveBeenCalledTimes(1);
  });

  it('opens verify modal when email action has no valid auth session', async () => {
    const localStorageMock: Storage = {
      length: 0,
      clear: () => undefined,
      getItem: () => '',
      key: () => null,
      removeItem: () => undefined,
      setItem: () => undefined,
    };
    vi.stubGlobal('localStorage', localStorageMock);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 })));
    const quote = makeQuotedResponse();
    const data: QuoteData = { ...initialQuoteData };
    const { result } = renderHook(() => useStep4QuoteController({
      policyId: 'token-123',
      quoteStatus: quote.status,
      quoteReference: quote.reference,
      quote,
      data,
      isComprehensiveCover: true,
      currentHasNcbFromQuote: false,
      currentHasVipFromQuote: false,
      currentHasRoadsideFromQuote: false,
      onProceedToPayment: () => undefined,
      onRequestCall: async () => undefined,
      onRatedQuote: () => undefined,
    }));
    await waitFor(() => expect(result.current.recommendations.initialDone).toBe(true));
    await act(async () => {
      await result.current.actions.triggerQuoteEmail();
    });
    await waitFor(() => {
      expect(result.current.communications.showVerifyCode).toBe(true);
    });
  });
});

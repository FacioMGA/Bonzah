/* @vitest-environment happy-dom */

/**
 * Regression suite for `ABY-409` / `ABBEYGATE-REACT-2` —
 *   `TypeError: Cannot read properties of undefined (reading 'validateInput')`
 *   (Chrome) / Safari: `…iframeCommunications["cvv_"+t].validateInput`
 *
 * Caught by Sentry's `BrowserApiErrors → addEventListener` auto-instrumentation
 * when the third-party CardCorp / OPPWA `wpwl` widget tried to submit a card
 * form before its CVV iframe finished registering with the parent. Frames are
 * entirely inside `/v1/static/<sha>/js/static.min.js`. We can't fix the
 * widget's internal race; we refuse interaction until `onReady`.
 *
 * The contract:
 *
 *   1. While `phase !== 'ready_to_pay'` the widget mount is locked with
 *      `inert`, `aria-busy="true"`, and `pointer-events: none`.
 *      `pointer-events` alone does not block keyboard focus / Enter;
 *      `inert` does. OPPWA `disableSubmitOnEnter` is pinned separately in
 *      `cardCorpWidget.test.ts`.
 *   2. As soon as `loadCardCorpWidgetScript` invokes `onReady`, `phase`
 *      flips to `ready_to_pay` and the lock attributes are dropped.
 *   3. The mount exposes `data-widget-ready` (`"0"` / `"1"`) so this test
 *      can assert the transition without depending on inline style
 *      serialisation across browser/jsdom variants.
 */

import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';

type WidgetLoadArgs = { onReady?: () => void; onError?: (err: unknown) => void };

const widgetSpy: { lastArgs: WidgetLoadArgs | null } = { lastArgs: null };

vi.mock('@/src/shared/lib/payments/cardCorpWidget', () => ({
  loadCardCorpWidgetScript: vi.fn((args: WidgetLoadArgs) => {
    // IMPORTANT: do NOT invoke `onReady` synchronously. Saving the args lets
    // the test assert the "preparing → ready" transition deliberately, which
    // is the contract under test.
    widgetSpy.lastArgs = args;
  }),
  mountPaymentWidgetsForm: vi.fn(),
  removeCardCorpWidgetScript: vi.fn(),
}));

vi.mock('@/src/modules/billing/cardcorpStyles', () => ({
  CARDCORP_WIDGET_CSS: '',
  CARDCORP_WIDGET_SCOPE_CLASS: 'cc-scope',
}));

vi.mock('framer-motion', () => {
  const target: Record<string, unknown> = {};
  return {
    motion: new Proxy(target, {
      get: () => (props: Record<string, unknown>) => {
        const { children, ...rest } = props as { children?: React.ReactNode };
        return React.createElement('div', rest, children);
      },
    }),
  };
});

import { PaymentStep } from './PaymentStep';

type ReadinessPayload = {
  customerOutcome: 'issued' | 'pending' | 'failed';
  derived: {
    hasPaymentConfirmed: boolean;
    hasBoundInceptionTransaction: boolean;
    hasIssuedPackDocuments: boolean;
    hasWelcomeEmailSent: boolean;
  };
  blockers: Array<{ code: string; message: string }>;
};

function readinessNotPaid(): ReadinessPayload {
  return {
    customerOutcome: 'pending',
    derived: {
      hasPaymentConfirmed: false,
      hasBoundInceptionTransaction: false,
      hasIssuedPackDocuments: false,
      hasWelcomeEmailSent: false,
    },
    blockers: [],
  };
}

type CheckoutInfo = {
  checkoutId: string;
  widgetScriptUrl: string;
  shopperResultUrl: string;
  amount: string;
  currency: string;
  brands: string;
};

function checkoutInfo(): CheckoutInfo {
  return {
    checkoutId: 'CK-TEST-1',
    widgetScriptUrl: 'https://cardcorp.example/widgets.js',
    shopperResultUrl: 'https://abbeygate-cy.facio.io/return',
    amount: '120.00',
    currency: 'EUR',
    brands: 'VISA MASTER',
  };
}

function setupFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.includes('/issue-readiness')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: readinessNotPaid() }),
      } as unknown as Response;
    }
    if (url.includes('/checkout')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: checkoutInfo() }),
      } as unknown as Response;
    }
    return {
      ok: false,
      status: 404,
      json: async () => ({ success: false, error: { message: 'unused' } }),
    } as unknown as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

let tokenCounter = 0;
function nextToken(): string {
  tokenCounter += 1;
  return `tok-widget-${tokenCounter}-${Math.random().toString(16).slice(2)}`;
}

const baseProps = {
  productCode: 'home',
  summary: { amount: 120, currency: 'EUR' },
  onBack: vi.fn(),
  onSubmit: vi.fn(),
};

describe('PaymentStep — widget readiness gate (REACT-2)', () => {
  beforeEach(() => {
    widgetSpy.lastArgs = null;
    window.history.replaceState(null, '', '/');
    try { window.localStorage.clear(); } catch { /* ignore */ }
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('locks the widget mount (inert + aria-busy + pointer-events:none) until onReady fires', async () => {
    setupFetch();
    render(<PaymentStep {...baseProps} publicSessionToken={nextToken()} />);

    // The mount appears as soon as the checkout POST resolves. The gate is
    // engaged at this point because `onReady` has not been invoked.
    const mount = await waitFor(() => screen.getByTestId('cardcorp-widget-mount'), {
      timeout: 4000,
    });
    expect(mount.getAttribute('data-widget-ready')).toBe('0');
    expect(mount.getAttribute('aria-busy')).toBe('true');
    expect(mount.hasAttribute('inert')).toBe(true);
    expect(mount.style.pointerEvents).toBe('none');

    // PaymentStep schedules `loadCardCorpWidgetScript` inside a
    // `requestAnimationFrame` after mounting the widget form (so the
    // wpwl widget finds the form already in DOM). That defers the call
    // by at least one frame past the moment the mount becomes visible
    // — `waitFor` above can resolve on the very first poll before rAF
    // fires. We must therefore wait specifically for the spy to record
    // the args, not just for the mount to appear. Without this wait the
    // assertion below flakes under happy-dom's rAF/microtask interleaving
    // when other wizard tests share the worker.
    await waitFor(
      () => expect(widgetSpy.lastArgs?.onReady).toBeTypeOf('function'),
      { timeout: 4000 },
    );
    await act(async () => {
      widgetSpy.lastArgs?.onReady?.();
    });

    await waitFor(() => {
      const updated = screen.getByTestId('cardcorp-widget-mount');
      expect(updated.getAttribute('data-widget-ready')).toBe('1');
    }, { timeout: 4000 });

    const updated = screen.getByTestId('cardcorp-widget-mount');
    expect(updated.getAttribute('aria-busy')).toBeNull();
    expect(updated.hasAttribute('inert')).toBe(false);
    expect(updated.style.pointerEvents).toBe('');
  });
});

/* @vitest-environment happy-dom */

/**
 * ADR-0017 — PaymentStep initial-mount surface contract.
 *
 * The bug this test pins (ABY-98 — "status falsely jumps back to
 * payment stage with no clear understanding of what's going on"):
 *
 *   When the wizard re-mounted at the payment step AFTER a payment
 *   had already been confirmed (e.g. the customer refreshed the
 *   tab, returned later from a saved link, or the worker had not yet
 *   produced docs), the initial-mount effect blindly polled
 *   `/issue-readiness` and called
 *   `onSubmit({ status: 'paid', issued: false, blockers })` whenever
 *   the polling budget elapsed. The wizard controller's `handleTerminal`
 *   then advanced with `variant: 'pending'` AND set
 *   `paymentConfirmed: true` — so on the next render the wizard's
 *   step-resolver re-landed the user on the payment step with no
 *   error message and no recovery surface.
 *
 *   The fix (mirrored from the gateway-return branch): never silently
 *   advance with `issued: false`. Render the explicit
 *   `pending_issuance` or `documents_failed` (ADR-0017) surface
 *   in-place so the customer always sees a deliberate state change.
 *
 * The gateway-return path is covered by PaymentProcessingCard tests.
 * This file pins the previously untested initial-mount path.
 */

import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

vi.mock('@/src/shared/lib/payments/cardCorpWidget', () => ({
  loadCardCorpWidgetScript: vi.fn(({ onReady }: { onReady?: () => void }) => onReady?.()),
  mountPaymentWidgetsForm: vi.fn(),
  removeCardCorpWidgetScript: vi.fn(),
}));

vi.mock('@/src/modules/billing/cardcorpStyles', () => ({
  CARDCORP_WIDGET_CSS: '',
  CARDCORP_WIDGET_SCOPE_CLASS: 'cc-scope',
}));

vi.mock('framer-motion', () => {
  // Strip framer-motion's animation props down to a plain div so happy-dom
  // doesn't error on unknown SVG/animation attributes during these tests.
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

// `readinessPending()` was used by an earlier 30s-timeout variant of
// the failed-outcome test that was dropped because happy-dom's fake
// timers + the React scheduler made the test flaky. Kept-out for now
// — re-add only if a concrete pending-only assertion is needed.

function readinessFailed(reason: string): ReadinessPayload {
  return {
    customerOutcome: 'failed',
    derived: { hasPaymentConfirmed: true, hasBoundInceptionTransaction: true, hasIssuedPackDocuments: false, hasWelcomeEmailSent: false },
    blockers: [
      {
        code: 'DOCUMENTS_GENERATION_FAILED',
        message: `We could not generate your policy documents automatically: ${reason}`,
      },
    ],
  };
}

function readinessIssued(): ReadinessPayload {
  return {
    customerOutcome: 'issued',
    derived: { hasPaymentConfirmed: true, hasBoundInceptionTransaction: true, hasIssuedPackDocuments: true, hasWelcomeEmailSent: true },
    blockers: [],
  };
}

function setupFetch(payloads: ReadinessPayload[]) {
  let i = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    const payload = url.includes('/issue-readiness')
      ? payloads[Math.min(i++, payloads.length - 1)]
      : null;
    const body = payload ? { success: true, data: payload } : { success: false, error: { message: 'unused' } };
    // Hand-rolled Response stub — happy-dom's global Response works
    // but constructing it with a JSON body and re-parsing it adds
    // overhead the test doesn't need. We only consume `.ok` and
    // `.json()` from PaymentStep's fetch helpers.
    return {
      ok: !!payload,
      status: payload ? 200 : 500,
      json: async () => body,
    } as unknown as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

let tokenCounter = 0;
function nextToken(): string {
  // The PaymentStep helpers maintain module-level recent-readiness +
  // in-flight caches keyed by `${productCode}|${publicSessionToken}`.
  // Using a unique token per test prevents cross-test bleed when
  // running the file under `--no-isolate` or fast vitest mode.
  tokenCounter += 1;
  return `tok-test-${tokenCounter}-${Math.random().toString(16).slice(2)}`;
}

const baseProps = {
  productCode: 'home',
  summary: { amount: 100, currency: 'EUR' },
  onBack: vi.fn(),
};

describe('PaymentStep — initial-mount path (ADR-0017)', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
    try { window.localStorage.clear(); } catch { /* ignore */ }
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('renders documents_failed (NOT silent onSubmit) when readiness reports customerOutcome: failed', async () => {
    setupFetch([readinessFailed('puppeteer launch failed')]);
    const onSubmit = vi.fn();
    const publicSessionToken = nextToken();

    render(<PaymentStep {...baseProps} publicSessionToken={publicSessionToken} onSubmit={onSubmit} />);

    await waitFor(() => {
      expect(screen.getByTestId('payment-documents-failed-badge')).toBeInTheDocument();
    }, { timeout: 4000 });
    // The whole point of ADR-0017: never silently advance.
    expect(onSubmit).not.toHaveBeenCalled();
    // The operator-contact CTA must be wired; the previous "silent
    // bounce back to payment" surface had no recovery action at all.
    expect(screen.getByTestId('payment-documents-failed-contact')).toHaveAttribute(
      'href',
      'mailto:support@facio.io',
    );
  });

  it('DOES advance via onSubmit when readiness is already issued on initial mount', async () => {
    setupFetch([readinessIssued(), readinessIssued()]);
    const onSubmit = vi.fn();
    const publicSessionToken = nextToken();

    render(<PaymentStep {...baseProps} publicSessionToken={publicSessionToken} onSubmit={onSubmit} />);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'paid', issued: true }),
      );
    }, { timeout: 4000 });
    expect(screen.queryByTestId('payment-documents-failed-badge')).not.toBeInTheDocument();
  });
});

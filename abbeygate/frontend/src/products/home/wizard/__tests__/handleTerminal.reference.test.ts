/* @vitest-environment happy-dom */
/**
 * ABY-100 — the customer-facing reference printed on the SuccessScreen
 * (and emailed to the policyholder) MUST be the canonical
 * `policyNumber` business id, never the opaque internal
 * `publicSessionToken` (a 43-char base64 token) or the database UUID.
 *
 * The previous code path in `useHomeQuoteWizardController.handleTerminal`
 * fell back unconditionally to `args.policyId` (which IS the
 * publicSessionToken in customer flows), so customers saw an
 * un-scannable token in their welcome email and on the dashboard.
 * Travel already does this correctly via `session.policyNumber`.
 *
 * The test pins the contract by simulating both branches:
 *   1. session has a populated `policyNumber` → reference == policyNumber.
 *   2. session has no policyNumber (hand-shake race) → reference is a
 *      deterministic `ABH-PENDING-<token-prefix>` placeholder, never
 *      the raw publicSessionToken.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { useHomeQuoteWizardController } from '../useHomeQuoteWizardController';

type AnySessionAdapter = {
  load: ReturnType<typeof vi.fn>;
  patch: ReturnType<typeof vi.fn>;
  rate: ReturnType<typeof vi.fn>;
};

function makeArgs(sessionLoadResult: { ok: boolean; session?: unknown }) {
  const sessionAdapter: AnySessionAdapter = {
    load: vi.fn(async () => sessionLoadResult),
    patch: vi.fn(async () => ({ ok: true })),
    rate: vi.fn(async () => ({ ok: true, quoteResponse: {} })),
  };
  const dispatchEngine = vi.fn();
  const setQuoteResponse = vi.fn();
  const scrollToTop = vi.fn();

  // Wrap the inner test hook in a parent that owns the form + the
  // tested controller, so RHF context exists for the assertion.
  function useHarness(policyId: string) {
    const form = useForm({ defaultValues: {} });
    const controller = useHomeQuoteWizardController({
      policyId,
      currentStepId: 'payment',
      dispatchEngine,
      form,
      sessionAdapter: sessionAdapter as unknown as Parameters<typeof useHomeQuoteWizardController>[0]['sessionAdapter'],
      quoteResponse: null,
      setQuoteResponse,
      scrollToTop,
    });
    return controller;
  }

  return { sessionAdapter, dispatchEngine, useHarness };
}

describe('useHomeQuoteWizardController.handleTerminal — reference (ABY-100)', () => {
  it('uses session.policyNumber as the customer-facing reference', async () => {
    const { useHarness } = makeArgs({
      ok: true,
      session: { policyNumber: 'ABBEY-CY-HOM-2026-001234' },
    });
    const { result } = renderHook(() => useHarness('PUBLIC_SESSION_TOKEN_BASE64_43_CHARS_LONG_xx'));

    await act(async () => {
      await result.current.actions.handleTerminal({ status: 'paid', issued: true });
    });

    expect(result.current.state.terminal).toEqual({
      variant: 'issued',
      reference: 'ABBEY-CY-HOM-2026-001234',
    });
  });

  it('falls back to a deterministic ABH-PENDING-<token-prefix> when policyNumber is not yet assigned', async () => {
    const { useHarness } = makeArgs({ ok: true, session: { policyNumber: '' } });
    const { result } = renderHook(() =>
      useHarness('xEiwuPZBMhChXcaUY1ZFrtcgzkghlwkdgX-0-C5WVVw'),
    );

    await act(async () => {
      await result.current.actions.handleTerminal({ status: 'paid', issued: true });
    });

    expect(result.current.state.terminal?.variant).toBe('issued');
    // Fallback uses the first 8 chars of the token, uppercased. The
    // raw publicSessionToken MUST NOT appear anywhere in the
    // customer-facing reference.
    expect(result.current.state.terminal?.reference).toBe('ABH-PENDING-XEIWUPZB');
    expect(result.current.state.terminal?.reference).not.toContain('xEiwuPZBMhChXcaUY1ZFrtcgzkghlwkdgX');
  });

  it('uses the same fallback path on a session-load error (network / 500)', async () => {
    const { sessionAdapter, useHarness } = makeArgs({ ok: false });
    sessionAdapter.load.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useHarness('TOKEN12345abcdef'));

    await act(async () => {
      await result.current.actions.handleTerminal({ status: 'paid', issued: false });
    });

    expect(result.current.state.terminal?.variant).toBe('pending');
    expect(result.current.state.terminal?.reference).toBe('ABH-PENDING-TOKEN123');
  });

  it('marks terminal as payment_failed when the gateway reports failure (still using the policyNumber when available)', async () => {
    const { useHarness } = makeArgs({
      ok: true,
      session: { policyNumber: 'ABBEY-CY-HOM-2026-005678' },
    });
    const { result } = renderHook(() => useHarness('TOKEN'));

    await act(async () => {
      await result.current.actions.handleTerminal({ status: 'failed' });
    });

    expect(result.current.state.terminal).toEqual({
      variant: 'payment_failed',
      reference: 'ABBEY-CY-HOM-2026-005678',
    });
  });
});

/* @vitest-environment happy-dom */

/**
 * PR-1E — verify-email double-fire + AbortController contract.
 *
 * ABY-29 reproduces as: the customer lands on /verify-email after
 * paying, holds an existing-but-unverified token in localStorage, the
 * `useEffect` bootstrap runs twice (StrictMode dev double-mount, or
 * dep change), and the second run either:
 *
 *   a) double-charges the email-OTP rate limiter (two POSTs to
 *      /auth/email-otp/request for the same email + flow), or
 *   b) writes state on an unmounted tree after the redirect has
 *      started, leaving the page on a half-loaded state with a 401
 *      echo from a racing /users/me fetch.
 *
 * This test pins the contract that fixes both classes:
 *
 *   - the OTP-request fetch fires AT MOST once per page mount, even
 *     if the effect re-runs synchronously (StrictMode pattern)
 *   - on unmount, in-flight fetches are aborted (AbortController is
 *     passed and signal.aborted flips to true)
 *   - the existing-token redirect path (verified user) calls
 *     `safeRedirect` exactly once even when the effect fires twice
 *     concurrently
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import EmailOtpVerifyPage from './EmailOtpVerifyPage';

type FetchCall = { url: string; init?: RequestInit };

function mockSuccessfulOtpRequest(): {
  fetchSpy: ReturnType<typeof vi.fn>;
  calls: FetchCall[];
  abortedSignals: boolean[];
} {
  const calls: FetchCall[] = [];
  const abortedSignals: boolean[] = [];
  const fetchSpy = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = typeof url === 'string' ? url : String(url);
    calls.push({ url: u, init });
    if (init?.signal) abortedSignals.push(init.signal.aborted);
    if (u.endsWith('/auth/email-otp/request')) {
      return new Response(
        JSON.stringify({ success: true, data: { sent: true, devCode: '123456' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (u.endsWith('/users/me')) {
      return new Response(
        JSON.stringify({ success: true, data: { emailVerifiedAt: null } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify({ success: false }), { status: 404 });
  });
  return { fetchSpy, calls, abortedSignals };
}

function renderPage(initialEntries = ['/verify-email?email=effie%40abbeygate.cy&redirect=%2Fclient']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="/verify-email" element={<EmailOtpVerifyPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('EmailOtpVerifyPage — PR-1E double-fire + AbortController guard', () => {
  beforeEach(() => {
    localStorage.clear();
    // Reset module-level redirect lock between tests
    (window as Window & { __facio_verify_redirect_in_flight__?: boolean }).__facio_verify_redirect_in_flight__ = false;
  });
  afterEach(() => {
    // `vi.stubGlobal` registers fetch via vitest's global stub registry
    // (canonical fetch-mock pattern across this repo, e.g.
    // backend/modules/policy/http/__tests__/publicVehiclesRouter.merge.test.ts).
    // `unstubAllGlobals` restores the original `globalThis.fetch`
    // without the brittle direct-assignment + coercion pattern.
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    (window as Window & { __facio_verify_redirect_in_flight__?: boolean }).__facio_verify_redirect_in_flight__ = false;
  });

  it('issues a single OTP request even when the bootstrap effect runs twice (no token path)', async () => {
    const { fetchSpy, calls } = mockSuccessfulOtpRequest();
    vi.stubGlobal('fetch', fetchSpy);

    const { rerender, unmount } = renderPage();
    // Force a re-render that would otherwise re-trigger the effect
    rerender(
      <MemoryRouter initialEntries={['/verify-email?email=effie%40abbeygate.cy&redirect=%2Fclient']}>
        <Routes>
          <Route path="/verify-email" element={<EmailOtpVerifyPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const requestCalls = calls.filter((c) => c.url.endsWith('/auth/email-otp/request'));
    expect(requestCalls).toHaveLength(1);

    unmount();
  });

  it('passes an AbortSignal to the OTP request fetch', async () => {
    const { fetchSpy, calls } = mockSuccessfulOtpRequest();
    vi.stubGlobal('fetch', fetchSpy);

    const { unmount } = renderPage();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const requestCall = calls.find((c) => c.url.endsWith('/auth/email-otp/request'));
    expect(requestCall?.init?.signal).toBeInstanceOf(AbortSignal);

    unmount();
  });

  it('aborts in-flight fetches when the page unmounts mid-flight', async () => {
    let capturedSignal: AbortSignal | undefined;
    type OtpResolver = (response: Response) => void;
    // Closure-mutated outer reference. Wrap in a single-slot box so
    // TypeScript's flow analysis doesn't narrow the cross-callback
    // assignment back to `never` at the post-unmount call site.
    const resolverSlot: { current: OtpResolver | null } = { current: null };

    const fetchSpy = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const u = typeof url === 'string' ? url : String(url);
      if (u.endsWith('/auth/email-otp/request')) {
        capturedSignal = init?.signal ?? undefined;
        return new Promise<Response>((resolve, reject) => {
          resolverSlot.current = resolve;
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      }
      return Promise.resolve(
        new Response(JSON.stringify({ success: false }), { status: 404 }),
      );
    });
    vi.stubGlobal('fetch', fetchSpy);

    const { unmount } = renderPage();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });

    expect(capturedSignal?.aborted).toBe(false);
    unmount();
    expect(capturedSignal?.aborted).toBe(true);

    // Resolving after abort must not blow up — the rejection branch
    // is what runs, and the component is unmounted.
    if (resolverSlot.current) {
      resolverSlot.current(
        new Response(JSON.stringify({ success: true, data: {} }), { status: 200 }),
      );
    }
  });

  it('shows an honest "on its way" banner and a responsive Resend button (ABY-270)', async () => {
    // ABY-270 regression: the page previously stamped a "Code sent"
    // banner that read like confirmed delivery, while the underlying
    // dispatch is only QUEUED (worker actually emails it later — see
    // ABY-268). Resend was also visually inert: the label flipped to
    // "Sending..." only when `loading && !sent`, which never fired
    // again after the first successful request because `sent` stayed
    // true. Pin both repairs so we don't regress while the worker
    // delivery contract is being firmed up.
    const { fetchSpy } = mockSuccessfulOtpRequest();
    vi.stubGlobal('fetch', fetchSpy);

    const { findByText, getByRole, unmount } = renderPage();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(await findByText(/on its way/i)).toBeTruthy();
    const banner = await findByText(/on its way/i);
    expect(banner.textContent).toMatch(/spam folder/i);

    const resend = getByRole('button', { name: /resend code/i });
    expect(resend.getAttribute('disabled')).toBeNull();

    const callsBefore = fetchSpy.mock.calls.length;
    await act(async () => {
      resend.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    const otpCallUrls = fetchSpy.mock.calls
      .map(([url]) => (typeof url === 'string' ? url : String(url)))
      .filter((u) => u.endsWith('/auth/email-otp/request'));
    expect(otpCallUrls.length).toBeGreaterThanOrEqual(2);
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(callsBefore);

    unmount();
  });

  it('does not claim a code was emailed when the API reports delivery was skipped (ABY-374)', async () => {
    const fetchSpy = vi.fn(async (url: RequestInfo | URL) => {
      const u = typeof url === 'string' ? url : String(url);
      if (u.endsWith('/auth/email-otp/request')) {
        return new Response(
          JSON.stringify({ success: true, data: { sent: false, expiresMinutes: 10 } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ success: false }), { status: 404 });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const { findByText, getByRole, queryByText, unmount } = renderPage();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(await findByText(/could not send a verification code/i)).toBeTruthy();
    expect(queryByText(/verification code on its way/i)).toBeNull();
    expect(queryByText(/we emailed a 6-digit code/i)).toBeNull();
    expect(getByRole('button', { name: /resend code/i }).getAttribute('disabled')).toBeNull();

    unmount();
  });

  it('keeps a non-production dev code visible when email delivery was skipped (ABY-375)', async () => {
    const fetchSpy = vi.fn(async (url: RequestInfo | URL) => {
      const u = typeof url === 'string' ? url : String(url);
      if (u.endsWith('/auth/email-otp/request')) {
        return new Response(
          JSON.stringify({ success: true, data: { sent: false, devCode: '654321' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ success: false }), { status: 404 });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const { findByText, queryByText, unmount } = renderPage();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(await findByText(/could not send a verification code/i)).toBeTruthy();
    expect(await findByText(/dev code:/i)).toBeTruthy();
    expect(await findByText('654321')).toBeTruthy();
    expect(queryByText(/we emailed a 6-digit code/i)).toBeNull();

    unmount();
  });

  it('redirects exactly once on the existing-token verified-user path', async () => {
    localStorage.setItem('auth_token', 'tok_123');

    const fetchSpy = vi.fn(async (url: RequestInfo | URL) => {
      const u = typeof url === 'string' ? url : String(url);
      if (u.endsWith('/users/me')) {
        return new Response(
          JSON.stringify({
            success: true,
            data: { emailVerifiedAt: '2026-01-01T00:00:00.000Z' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ success: false }), { status: 404 });
    });
    vi.stubGlobal('fetch', fetchSpy);

    // Stub window.location.href reads/writes via a spy on the
    // descriptor — happy-dom allows assignment. Use a Partial<Location>
    // target so we don't trip the consistent-type-assertions ESLint rule
    // with `{} as Location`; the Proxy returns the same shape and
    // Object.defineProperty.value is `any` so no cast is needed at the
    // assignment site.
    const writes: string[] = [];
    const origDescriptor = Object.getOwnPropertyDescriptor(window, 'location');
    const locationTarget: Partial<Location> = {};
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: new Proxy(locationTarget, {
        get: (_t, key) => {
          if (key === 'href') return 'http://localhost/verify-email';
          if (key === 'search') return '?email=effie%40abbeygate.cy&redirect=%2Fclient';
          return '';
        },
        set: (_t, key, value) => {
          if (key === 'href') writes.push(String(value));
          return true;
        },
      }),
    });

    const { unmount } = renderPage();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    // Exactly one navigation, even if the gate effect tries to fire
    // twice (StrictMode / dep change). The module-level
    // `__facio_verify_redirect_in_flight__` lock + the gateFiredRef
    // guard combine to enforce single-shot.
    expect(writes).toEqual(['/client']);

    if (origDescriptor) Object.defineProperty(window, 'location', origDescriptor);
    unmount();
  });
});

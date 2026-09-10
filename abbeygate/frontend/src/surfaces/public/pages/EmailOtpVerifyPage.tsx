import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/src/shared/ui';
import { Input } from '@/src/shared/ui';

const POST_PAYMENT_OTP_FLOW = 'DASHBOARD_ACCESS' as const;

type CurrentUserPayload = {
  emailVerifiedAt?: string | null;
};

function isAbortError(err: unknown): boolean {
  if (!err) return false;
  if (typeof err === 'object' && 'name' in err) {
    const name = String((err as { name?: unknown }).name || '');
    if (name === 'AbortError') return true;
  }
  return false;
}

function safeRedirect(redirectTo: string) {
  // PR-1E — guard the existing-token redirect path against double-fire.
  // React StrictMode mounts effects twice in development, and even in
  // production a stale dep on `meEndpoint`/`redirectTo` could re-run
  // the gate effect and fire a second `window.location.href = …`
  // assignment AFTER the first navigation has started. Browsers
  // generally coalesce, but the double assignment has been observed
  // to leave the page on a half-loaded state with a 401 echo from a
  // racing /users/me fetch (ABY-29). The module-level lock ensures
  // exactly one redirect attempt per page lifetime.
  const w = window as Window & { __facio_verify_redirect_in_flight__?: boolean };
  if (w.__facio_verify_redirect_in_flight__) return;
  w.__facio_verify_redirect_in_flight__ = true;
  window.location.href = redirectTo || '/client';
}

export default function EmailOtpVerifyPage() {
  const [searchParams] = useSearchParams();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const email = String(searchParams.get('email') || '').trim();
  const redirectTo = String(searchParams.get('redirect') || '/client').trim();

  const apiBase = useMemo(() => {
    const configured = String(import.meta.env.VITE_API_URL || '/api').trim();
    return configured.endsWith('/') ? configured.slice(0, -1) : configured;
  }, []);

  const meEndpoint = `${apiBase}/users/me`;
  const requestEndpoint = `${apiBase}/auth/email-otp/request`;
  const verifyEndpoint = `${apiBase}/auth/email-otp/verify`;

  const mountedRef = useRef(true);
  // PR-1E — double-fire guard. The bootstrap effect must run AT MOST
  // once per page mount even when StrictMode double-invokes it, and
  // even when a parent re-renders cause `meEndpoint`/`redirectTo` to
  // change. Without this guard a second invocation would race the
  // first OTP request, double-charge the email-OTP rate limiter, and
  // leave the UI in an inconsistent state (ABY-29).
  const gateFiredRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const requestCode = useCallback(
    async (opts?: { signal?: AbortSignal }) => {
      if (!email) {
        if (mountedRef.current) setError('Missing email for verification.');
        return;
      }
      if (mountedRef.current) {
        setLoading(true);
        setError(null);
        setDevCode(null);
        // ABY-270: explicitly flip `sent` back to false so the
        // resend button shows a "Sending..." state again and the
        // user-visible banner can refresh ("queued just now")
        // instead of leaving the previous "Code sent" stamp in
        // place from the initial mount request. Without this,
        // pressing Resend after the initial request looked like
        // a no-op even when a new OTP was successfully queued.
        setSent(false);
      }
      try {
        const res = await fetch(requestEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, flow: POST_PAYMENT_OTP_FLOW }),
          signal: opts?.signal,
        });
        const json = await res.json().catch(() => null);
        if (!json?.success) throw new Error(json?.error?.message || 'Failed to send verification code.');
        if (json?.data?.alreadyVerified) {
          safeRedirect(redirectTo);
          return;
        }
        if (!mountedRef.current) return;
        if (json?.data?.devCode) setDevCode(String(json.data.devCode));
        if (json?.data?.sent !== true) {
          setError('We could not send a verification code right now. Please try again in a moment.');
          return;
        }
        setSent(true);
      } catch (e) {
        if (isAbortError(e)) return;
        if (mountedRef.current) setError((e as Error)?.message || 'Failed to send verification code.');
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [email, redirectTo, requestEndpoint],
  );

  const verifyCode = useCallback(async () => {
    const codeValue = String(code || '').trim();
    if (!email || !codeValue) {
      setError('Email and code are required.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(verifyEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code: codeValue, flow: POST_PAYMENT_OTP_FLOW }),
      });
      const json = await res.json().catch(() => null);
      if (!json?.success) throw new Error(json?.error?.message || 'Invalid or expired code.');

      const token = String(json?.data?.token || '').trim();
      const user = json?.data?.user || null;
      if (!token) throw new Error('Verification succeeded, but no session was issued.');

      localStorage.setItem('auth_token', token);
      if (user) localStorage.setItem('user_info', JSON.stringify(user));
      safeRedirect(redirectTo);
    } catch (e) {
      if (mountedRef.current) setError((e as Error)?.message || 'Verification failed.');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [code, email, redirectTo, verifyEndpoint]);

  useEffect(() => {
    if (!email) return;
    if (gateFiredRef.current) return;
    gateFiredRef.current = true;

    const controller = new AbortController();

    const ensureOtpGate = async () => {
      const token = String(localStorage.getItem('auth_token') || '').trim();
      if (token) {
        try {
          const meResponse = await fetch(meEndpoint, {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
          });
          const meJson = await meResponse.json().catch(() => null);
          if (meResponse.ok && meJson?.success) {
            const meData = (meJson?.data || {}) as CurrentUserPayload;
            if (meData.emailVerifiedAt) {
              safeRedirect(redirectTo);
              return;
            }
          } else if (meResponse.status === 401) {
            localStorage.removeItem('auth_token');
            localStorage.removeItem('user_info');
          }
        } catch (e) {
          if (isAbortError(e)) return;
          // Non-blocking: continue to OTP request if profile check fails.
        }
      }

      if (controller.signal.aborted) return;
      await requestCode({ signal: controller.signal });
    };

    void ensureOtpGate();

    return () => {
      // Abort any in-flight `/users/me` or `/email-otp/request` so a
      // re-mount under StrictMode (or a route change while the gate
      // is still resolving) doesn't write to state on an unmounted
      // tree or double-charge the OTP rate limiter.
      controller.abort();
    };
  }, [email, meEndpoint, redirectTo, requestCode]);

  const isSending = loading && !sent;

  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
        <h1 className="text-2xl font-bold text-slate-900">Check your email</h1>
        {isSending ? (
          <p className="mt-2 text-sm text-slate-600">
            Sending a 6-digit verification code to{' '}
            <span className="font-semibold text-slate-900">{email || 'your email'}</span>…
          </p>
        ) : sent ? (
          <p className="mt-2 text-sm text-slate-600">
            We emailed a 6-digit code to{' '}
            <span className="font-semibold text-slate-900">{email || 'your email'}</span>.
            Enter it below to access your account.
          </p>
        ) : (
          <p className="mt-2 text-sm text-slate-600">
            Enter a verification code when one is available. Use Resend code to try again.
          </p>
        )}

        {error ? (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800">
            {error}
          </div>
        ) : null}

        {sent && !error ? (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">
            {/* ABY-270: the OTP request returns success once the
                message is queued for delivery; the customer-email
                worker actually dispatches it (tracked in ABY-268).
                Wording acknowledges the small delivery delay so
                the user doesn't assume the system silently failed. */}
            Verification code on its way — it can take a minute or two. Please also check your spam folder.
          </div>
        ) : null}

        {devCode ? (
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
            Dev code: <span className="font-black tracking-widest">{devCode}</span>
          </div>
        ) : null}

        <div className="mt-4">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-500">6-digit code</label>
          <Input
            type="text"
            inputMode="numeric"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 font-medium tracking-[0.2em] text-slate-700 outline-none transition focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20"
            placeholder="123456"
            disabled={isSending}
          />
        </div>

        <div className="mt-4 flex items-center justify-between">
          <span className="text-[11px] font-semibold text-slate-400">Didn't receive it?</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void requestCode({})}
            disabled={loading}
            className="text-xs font-bold text-slate-500 underline underline-offset-4 hover:text-slate-700 disabled:opacity-60 bg-transparent !p-0"
          >
            {/* ABY-270: previously read "Resend code" while loading
                because `loading && !sent` was always false after the
                first send. Show the in-flight state on every click. */}
            {loading ? 'Sending…' : 'Resend code'}
          </Button>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3">
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={() => { window.location.href = '/login'; }}
            className="rounded-xl border border-slate-200 px-4 py-2 font-bold text-slate-700 transition hover:bg-slate-50"
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={() => void verifyCode()}
            className="rounded-xl bg-slate-900 px-4 py-2 font-bold text-white transition hover:bg-slate-800 disabled:opacity-60"
            disabled={loading || isSending}
          >
            {loading && sent ? 'Verifying…' : 'Verify & continue'}
          </Button>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Input } from '@/src/shared/ui';

/**
 * Magic-link reset landing page.
 *
 * Reached by users who click the link in the password-reset email mailed by
 * `accessControl.adminResetUserPassword`. The token is embedded as
 * `?token=<base64url>` and is single-use, expiring 24h after issue.
 *
 * On submit we POST `{ token, newPassword }` to
 * `/api/auth/password-reset/confirm-link`. On success the server marks the
 * token consumed, persists the new bcrypt hash, and bumps `tokenVersion` to
 * invalidate any active sessions, then we redirect to `/login` with a notice.
 */
export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = String(searchParams.get('token') || '').trim();

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const apiBase = useMemo(() => {
    return window.location.hostname === 'localhost' ? 'http://localhost:3000' : window.location.origin;
  }, []);

  const tokenMissing = token.length === 0;

  useEffect(() => {
    if (tokenMissing) {
      setError('This password reset link is missing its token. Please use the link from your email or request a new reset.');
    }
  }, [tokenMissing]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (tokenMissing) return;

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${apiBase}/api/auth/password-reset/confirm-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword }),
      });
      const json = await res.json().catch(() => null);
      if (!json?.success) {
        const code = String(json?.error?.code || '');
        if (code === 'RESET_LINK_INVALID') {
          throw new Error('This reset link is invalid, expired, or has already been used. Please request a new password reset.');
        }
        throw new Error(json?.error?.message || 'Failed to reset password.');
      }
      setSuccess(true);
      const redirectPath = String(json?.data?.redirectPath || '/login').trim();
      const loginTarget = `/login?reset=success&next=${encodeURIComponent(redirectPath)}`;
      // Brief pause so the user sees the success state before redirect.
      window.setTimeout(() => {
        navigate(loginTarget, { replace: true });
      }, 1600);
    } catch (e) {
      setError((e as Error)?.message || 'Failed to reset password.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-white p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
        <h1 className="text-2xl font-bold text-slate-900">Set a new password</h1>
        <p className="mt-2 text-sm text-slate-600">
          Choose a new password to regain access to your account. The link you used is valid once and will be consumed when you submit.
        </p>

        {error ? (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800">
            {error}
          </div>
        ) : null}

        {success ? (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">
            Password updated. Redirecting you to sign in…
          </div>
        ) : null}

        <form onSubmit={submit} className="mt-5 space-y-4">
          <div className="relative">
            <label className="absolute -top-2 left-3 z-10 bg-white px-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">New password</label>
            <Input
              type={showPassword ? 'text' : 'password'}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 font-medium text-slate-700 outline-none transition focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20"
              placeholder="At least 8 characters"
              disabled={submitting || success || tokenMissing}
              required
            />
          </div>

          <div className="relative">
            <label className="absolute -top-2 left-3 z-10 bg-white px-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">Confirm new password</label>
            <Input
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 font-medium text-slate-700 outline-none transition focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20"
              placeholder="Repeat your new password"
              disabled={submitting || success || tokenMissing}
              required
            />
          </div>

          <div className="flex items-center justify-between">
            <Button
              type="button"
              variant="link"
              size="none"
              onClick={() => setShowPassword((prev) => !prev)}
              className="text-xs font-semibold text-slate-500 hover:text-slate-700 underline underline-offset-4"
            >
              {showPassword ? 'Hide passwords' : 'Show passwords'}
            </Button>
          </div>

          <Button
            type="submit"
            className="w-full rounded-xl bg-brand-primary px-4 py-4 text-sm font-bold text-white shadow-lg transition hover:bg-brand-secondary active:scale-[0.99] disabled:opacity-60"
            disabled={submitting || success || tokenMissing}
          >
            {submitting ? 'Updating password…' : success ? 'Updated' : 'Set new password'}
          </Button>
        </form>

        <div className="mt-4 text-center">
          <Button
            type="button"
            variant="link"
            size="none"
            onClick={() => navigate('/login')}
            className="text-xs font-semibold text-slate-500 hover:text-brand-primary underline underline-offset-4"
          >
            Back to sign in
          </Button>
        </div>
      </div>
    </div>
  );
}

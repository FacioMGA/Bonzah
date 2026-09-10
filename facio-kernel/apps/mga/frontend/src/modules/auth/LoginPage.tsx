import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Modal } from '@/src/shared/ui';
import { Button } from '@/src/shared/ui';
import { Input } from '@/src/shared/ui';

import { logger } from '@/src/shared/lib/logger';



function normalizeExplicitNext(value: string): string | null {
  const trimmed = String(value || '').trim();
  if (!trimmed || !trimmed.startsWith('/') || trimmed.startsWith('//')) return null;
  return trimmed;
}

interface LoginProps {
  onLogin: (token: string, user: Record<string, unknown> | null) => void;
  platformMode?: boolean;
  organizationProviders?: Array<{ id: string; label: string }>;
  passwordLoginEnabled?: boolean;
}

const LoginPage: React.FC<LoginProps> = ({ onLogin, platformMode = false, organizationProviders = [], passwordLoginEnabled = true }) => {
  const [searchParams] = useSearchParams();
  const claimToken = String(searchParams.get('claimToken') || '').trim();
  const explicitNextUrl = normalizeExplicitNext(String(searchParams.get('next') || ''));
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [forgotOpen, setForgotOpen] = useState(false);
  // Magic-link forgot-password: a single step (collect email) followed by a
  // "we've sent you a link" confirmation. The legacy 6-digit OTP UX is gone.
  const [forgotStep, setForgotStep] = useState<'request' | 'sent'>('request');
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotError, setForgotError] = useState<string | null>(null);
  const [forgotDevUrl, setForgotDevUrl] = useState<string | null>(null);

  const [verifyOpen, setVerifyOpen] = useState(false);
  const [verifyCode, setVerifyCode] = useState('');
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifyDevCode, setVerifyDevCode] = useState<string | null>(null);

  const apiBase = useMemo(() => {
    return (import.meta.env.VITE_API_URL || '/api').replace(/\/api\/?$/, '').replace(/\/$/, '');
  }, []);

  useEffect(() => {
    const mode = String(searchParams.get('mode') || '').trim().toLowerCase();
    if (!platformMode && (mode === 'signup' || claimToken)) {
      setIsSignUp(true);
      if (claimToken) {
        setNotice('Create an account to unlock your customer portal and link this policy.');
      }
    }
    const prefillEmail = String(searchParams.get('email') || '').trim();
    if (prefillEmail) setEmail(prefillEmail);
    const resetFlag = String(searchParams.get('reset') || '').trim().toLowerCase();
    if (resetFlag === 'success') {
      setNotice('Password updated. Sign in with your new password.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requestEmailVerificationCode = async (targetEmail: string) => {
    const e = String(targetEmail || '').trim();
    if (!e) return;
    setVerifyLoading(true);
    setVerifyError(null);
    setVerifyDevCode(null);
    try {
      const res = await fetch(`${apiBase}/api/auth/email-otp/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: e }),
      });
      const json = await res.json().catch(() => null);
      if (!json?.success) throw new Error(json?.error?.message || 'Failed to send verification code.');
      if (json?.data?.devCode) setVerifyDevCode(String(json.data.devCode));
    } catch (e2) {
      setVerifyError((e2 as Error).message || 'Failed to send verification code.');
    } finally {
      setVerifyLoading(false);
    }
  };

  const verifyEmailAndLogin = async () => {
    const e = String(email || '').trim();
    const code = String(verifyCode || '').trim();
    if (!e || !code) {
      setVerifyError('Email and code are required.');
      return;
    }

    setVerifyLoading(true);
    setVerifyError(null);
    try {
      const v = await fetch(`${apiBase}/api/auth/email-otp/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: e, code }),
      });
      const vj = await v.json().catch(() => null);
      if (!vj?.success) throw new Error(vj?.error?.message || 'Invalid or expired code.');
      const token = String(vj?.data?.token || '').trim();
      const user = vj?.data?.user;
      if (token) {
        localStorage.setItem('auth_token', token);
        if (user) localStorage.setItem('user_info', JSON.stringify(user));
        const tenantId = String(vj?.data?.tenantId || (user && typeof user === 'object' ? (user as Record<string, unknown>).primaryAccountId : '') || '').trim();
        if (tenantId) localStorage.setItem('active_tenant_id', tenantId);
        onLogin(token, user);
        if (explicitNextUrl && !platformMode) window.location.assign(explicitNextUrl);
      } else if (password) {
        const loginRes = await fetch(`${apiBase}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: e, password }),
        });
        const loginJson = await loginRes.json().catch(() => null);
        if (!loginJson?.success) throw new Error(loginJson?.error?.message || 'Login failed.');
        localStorage.setItem('auth_token', loginJson.data.token);
        localStorage.setItem('user_info', JSON.stringify(loginJson.data.user));
        const tenantId = String(loginJson?.data?.tenantId || loginJson?.data?.user?.primaryAccountId || '').trim();
        if (tenantId) localStorage.setItem('active_tenant_id', tenantId);
        onLogin(loginJson.data.token, loginJson.data.user);
        if (explicitNextUrl && !platformMode) window.location.assign(explicitNextUrl);
      } else {
        throw new Error('Verification succeeded, but no session was issued.');
      }
      setVerifyOpen(false);
    } catch (e3) {
      setVerifyError((e3 as Error).message || 'Verification failed.');
    } finally {
      setVerifyLoading(false);
    }
  };

  const openForgot = () => {
    setNotice(null);
    setForgotError(null);
    setForgotDevUrl(null);
    setForgotEmail((email || '').trim());
    setForgotStep('request');
    setForgotOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isSignUp && password !== confirmPassword) {
      alert('Passwords do not match!');
      return;
    }

    setLoading(true);

    const endpoint = isSignUp ? '/api/auth/signup' : '/api/auth/login';
    const API_URL = `${apiBase}${endpoint}`;

    try {
      const body = isSignUp
        ? { username: email, email, password, name, ...(claimToken ? { claimToken } : {}) }
        : { username: email, password };

      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const result = await response.json();

      if (result.success) {
        if (isSignUp) {
          setNotice('Account created. Please verify your email to continue.');
          setVerifyOpen(true);
          setVerifyCode('');
          await requestEmailVerificationCode(String(email || '').trim());
        } else {
          localStorage.setItem('auth_token', result.data.token);
          localStorage.setItem('user_info', JSON.stringify(result.data.user));
          const tenantId = String(result?.data?.tenantId || result?.data?.user?.primaryAccountId || '').trim();
          if (tenantId) localStorage.setItem('active_tenant_id', tenantId);
          onLogin(result.data.token, result.data.user);
          if (explicitNextUrl && !platformMode) window.location.assign(explicitNextUrl);
        }
      } else {
        const msg = (isSignUp ? 'Sign up failed: ' : 'Login failed: ') + (result?.error?.message || 'Unknown error');
        alert(msg);
      }
    } catch (err) {
      logger.error('Auth error:', err);
      alert('Operation failed. Ensure backend is running.');
    } finally {
      setLoading(false);
    }
  };

  const requestPasswordReset = async () => {
    const target = String(forgotEmail || '').trim();
    if (!target) {
      setForgotError('Please enter your email address.');
      return;
    }
    setForgotLoading(true);
    setForgotError(null);
    setForgotDevUrl(null);
    try {
      const res = await fetch(`${apiBase}/api/auth/password-reset/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: target }),
      });
      const json = await res.json();
      if (!json?.success) throw new Error(json?.error?.message || 'Failed to send reset link.');
      // The backend deliberately responds with success regardless of whether
      // the email exists, to avoid account enumeration. In dev mode it may
      // surface a `devUrl` so we can click through without a real email.
      if (json?.data?.devUrl) setForgotDevUrl(String(json.data.devUrl));
      setForgotStep('sent');
    } catch (e) {
      setForgotError((e as Error).message || 'Failed to send reset link.');
    } finally {
      setForgotLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-white font-sans p-6">
      <div className="w-full max-w-[440px] space-y-8 animate-in fade-in duration-500">
        <div className="text-center">
          <p className="text-sm uppercase tracking-[0.18em] font-black text-slate-600 mb-6">Facio Platform</p>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight mb-2">
            {isSignUp ? 'Create Account' : platformMode ? 'Open your workspace' : 'Login'}
          </h1>
          <p className="text-slate-500 text-sm font-medium">
            {isSignUp ? 'Join the MGA platform' : platformMode ? 'Sign in to select an authorized MGA workspace.' : 'Welcome back to the platform'}
          </p>
          {notice && (
            <div className="mt-4 text-sm font-semibold text-slate-600">
              {notice}
            </div>
          )}
        </div>

        {platformMode && organizationProviders.length > 0 && <div className="space-y-3">{organizationProviders.map(provider => <a key={provider.id} href={`/auth/login?provider=${encodeURIComponent(provider.id)}`} className="block text-center w-full rounded-xl border border-slate-300 px-5 py-4 font-bold text-slate-800 hover:bg-slate-50">Continue with {provider.label}</a>)}</div>}
        {(!platformMode || passwordLoginEnabled) && <form onSubmit={handleSubmit} className="space-y-5">
          {isSignUp && (
            <div className="relative animate-in slide-in-from-top-2 duration-300">
              <label className="absolute -top-2 left-3 bg-white px-1 text-[11px] font-bold text-slate-400 z-10 uppercase tracking-wider">Full Name *</label>
              <Input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-4 rounded-xl bg-slate-50 border border-slate-200 focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary transition outline-none font-medium text-slate-700"
                placeholder="John Doe"
                required={isSignUp}
              />
            </div>
          )}

          <div className="relative">
            <label className="absolute -top-2 left-3 bg-white px-1 text-[11px] font-bold text-slate-400 z-10 uppercase tracking-wider">Email Address *</label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-4 rounded-xl bg-slate-50 border border-slate-200 focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary transition outline-none font-medium text-slate-700"
              placeholder="name@company.com"
              required
            />
          </div>

          <div className="relative">
            <label className="absolute -top-2 left-3 bg-white px-1 text-[11px] font-bold text-slate-400 z-10 uppercase tracking-wider">Password *</label>
            <div className="relative">
              <Input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-4 rounded-xl bg-slate-50 border border-slate-200 focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary transition outline-none font-medium text-slate-700"
                placeholder="••••••••"
                required
              />
              <Button
                type="button"
                variant="link"
                size="none"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {showPassword ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0zM2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.882 9.882L19.07 19M9.882 9.882l-7.95-7.95" />
                  )}
                </svg>
              </Button>
            </div>
          </div>

          {isSignUp && (
            <div className="relative animate-in slide-in-from-top-2 duration-300">
              <label className="absolute -top-2 left-3 bg-white px-1 text-[11px] font-bold text-slate-400 z-10 uppercase tracking-wider">Confirm Password *</label>
              <Input
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-4 py-4 rounded-xl bg-slate-50 border border-slate-200 focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary transition outline-none font-medium text-slate-700"
                placeholder="••••••••"
                required={isSignUp}
              />
            </div>
          )}

          <Button
            type="submit"
            disabled={loading}
            className={`w-full bg-brand-primary text-white py-4 rounded-xl font-bold text-sm shadow-lg hover:bg-brand-secondary transition transform active:scale-[0.98] ${loading ? 'opacity-70 cursor-not-allowed' : ''}`}
          >
            {loading ? (isSignUp ? 'Creating Account...' : 'Logging in...') : (isSignUp ? 'Create Account' : 'Login')}
          </Button>
        </form>}

        {!platformMode && <div className="text-center space-y-4 pt-2">
          <p className="text-sm text-slate-600 font-medium">
            {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
            <Button
              type="button"
              variant="link"
              size="none"
              onClick={() => setIsSignUp(!isSignUp)}
              className="text-[#0070f3] font-bold hover:underline ml-1"
            >
              {isSignUp ? 'Login here' : 'Sign up here'}
            </Button>
          </p>
          {!isSignUp && (
            <Button
              type="button"
              variant="link"
              size="none"
              onClick={openForgot}
              className="mt-8 text-xs font-semibold text-slate-500 hover:text-brand-primary transition underline-offset-4 hover:underline"
            >
              Trouble logging in? Reset your password.
            </Button>
          )}
        </div>}
      </div>

      <Modal
        isOpen={verifyOpen}
        onClose={() => setVerifyOpen(false)}
        title="Verify Code"
        maxWidth="max-w-md"
        actions={(
          <div className="flex items-center gap-3">
            <Button
              type="button"
              onClick={() => setVerifyOpen(false)}
              className="px-4 py-2 rounded-xl border border-slate-200 text-slate-700 font-bold hover:bg-slate-50 transition"
              disabled={verifyLoading}
            >
              Close
            </Button>
            <Button
              type="button"
              onClick={() => void verifyEmailAndLogin()}
              disabled={verifyLoading}
              className="px-4 py-2 rounded-xl bg-slate-900 text-white font-bold hover:bg-slate-800 transition disabled:opacity-60"
            >
              {verifyLoading ? 'Verifying…' : 'Verify code'}
            </Button>
          </div>
        )}
      >
        <div className="space-y-4">
          <div className="text-sm font-semibold text-slate-600">
            Enter the 6-digit code sent to <span className="font-black">{String(email || '').trim()}</span>.
          </div>

          {verifyError && (
            <div className="p-3 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-sm font-semibold">
              {verifyError}
            </div>
          )}

          {verifyDevCode && (
            <div className="p-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 text-sm font-semibold">
              Dev code: <span className="font-black tracking-widest">{verifyDevCode}</span>
            </div>
          )}

          <div className="relative">
            <label className="absolute -top-2 left-3 bg-white px-1 text-[11px] font-bold text-slate-400 z-10 uppercase tracking-wider">Code</label>
            <Input
              type="text"
              inputMode="numeric"
              value={verifyCode}
              onChange={(e) => setVerifyCode(e.target.value)}
              className="w-full px-4 py-4 rounded-xl bg-slate-50 border border-slate-200 focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary transition outline-none font-medium text-slate-700 tracking-[0.2em]"
              placeholder="123456"
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <Button
              type="button"
              onClick={() => void requestEmailVerificationCode(String(email || '').trim())}
              className="text-xs font-bold text-slate-500 hover:text-slate-700 underline underline-offset-4"
              disabled={verifyLoading}
            >
              Resend code
            </Button>
            <div className="text-[11px] text-slate-400 font-semibold">
              Did not get it yet?
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={forgotOpen}
        onClose={() => setForgotOpen(false)}
        title="Reset password"
        maxWidth="max-w-md"
        actions={(
          <div className="flex items-center gap-3">
            <Button
              type="button"
              onClick={() => setForgotOpen(false)}
              className="px-4 py-2 rounded-xl border border-slate-200 text-slate-700 font-bold hover:bg-slate-50 transition"
            >
              Close
            </Button>
            {forgotStep === 'request' ? (
              <Button
                type="button"
                onClick={() => void requestPasswordReset()}
                disabled={forgotLoading}
                className="px-4 py-2 rounded-xl bg-slate-900 text-white font-bold hover:bg-slate-800 transition disabled:opacity-60"
              >
                {forgotLoading ? 'Sending…' : 'Send reset link'}
              </Button>
            ) : (
              <Button
                type="button"
                onClick={() => setForgotOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-900 text-white font-bold hover:bg-slate-800 transition"
              >
                Done
              </Button>
            )}
          </div>
        )}
      >
        <div className="space-y-4">
          {forgotStep === 'request' ? (
            <>
              <div className="text-sm font-semibold text-slate-600">
                Enter your email and we&rsquo;ll send you a secure link to reset your password. The link expires in 24&nbsp;hours.
              </div>

              {forgotError && (
                <div className="p-3 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-sm font-semibold">
                  {forgotError}
                </div>
              )}

              <div className="relative">
                <label className="absolute -top-2 left-3 bg-white px-1 text-[11px] font-bold text-slate-400 z-10 uppercase tracking-wider">Email</label>
                <Input
                  type="email"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  className="w-full px-4 py-4 rounded-xl bg-slate-50 border border-slate-200 focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary transition outline-none font-medium text-slate-700"
                  placeholder="name@company.com"
                  required
                />
              </div>
            </>
          ) : (
            <>
              <div className="text-sm font-semibold text-slate-600">
                If an account exists for <span className="font-black">{forgotEmail || 'this address'}</span>, we&rsquo;ve emailed a secure link to reset your password. Check your inbox (and spam) within a few minutes.
              </div>

              {forgotDevUrl && (
                <div className="p-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 text-xs font-semibold space-y-2">
                  <div>Dev mode — email could not be sent. Use this link directly:</div>
                  <a
                    href={forgotDevUrl}
                    className="block break-all underline font-mono text-[11px] text-amber-900"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {forgotDevUrl}
                  </a>
                </div>
              )}
            </>
          )}
        </div>
      </Modal>
    </div>
  );
};

export default LoginPage;

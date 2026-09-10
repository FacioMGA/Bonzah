import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { WizardButton as Button, WizardInput as Input } from '@/src/shared/ui';

interface EmailOtpVerifyModalProps {
  isOpen: boolean;
  email: string;
  title?: string;
  subtitle?: string;
  verifyButtonLabel?: string;
  redirectTo?: string;
  onClose: () => void;
  onVerified?: (payload: { token?: string; user?: Record<string, unknown>; data?: Record<string, unknown> }) => void | Promise<void>;
  requestPayload?: Record<string, unknown>;
  verifyPayload?: Record<string, unknown>;
  requireAuthToken?: boolean;
  verifyingLabel?: string;
  postVerifyPendingLabel?: string;
}

export function EmailOtpVerifyModal({
  isOpen,
  email,
  title = 'Verify Code',
  subtitle = 'Enter the 6-digit code sent to',
  verifyButtonLabel = 'Verify & continue',
  redirectTo = '/client',
  onClose,
  onVerified,
  requestPayload,
  verifyPayload,
  requireAuthToken = true,
  verifyingLabel = 'Verifying…',
  postVerifyPendingLabel = 'Sending quote…',
}: EmailOtpVerifyModalProps) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [phase, setPhase] = useState<'idle' | 'verify' | 'post-verify'>('idle');

  const normalizedEmail = String(email || '').trim();

  const requestCode = async () => {
    if (!normalizedEmail) {
      setError('Missing email for verification.');
      return;
    }
    setLoading(true);
    setError(null);
    setDevCode(null);
    try {
      const res = await fetch('/api/auth/email-otp/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail, ...(requestPayload || {}) }),
      });
      const json = await res.json().catch(() => null);
      if (!json?.success) throw new Error(json?.error?.message || 'Failed to send verification code.');
      if (json?.data?.devCode) setDevCode(String(json.data.devCode));
    } catch (e) {
      setError((e as Error)?.message || 'Failed to send verification code.');
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async () => {
    if (!normalizedEmail || !code.trim()) {
      setError('Email and code are required.');
      return;
    }
    setLoading(true);
    setPhase('verify');
    setError(null);
    try {
      const res = await fetch('/api/auth/email-otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail, code: String(code || '').trim(), ...(verifyPayload || {}) }),
      });
      const json = await res.json().catch(() => null);
      if (!json?.success) throw new Error(json?.error?.message || 'Invalid or expired code.');

      const token = json?.data?.token ? String(json.data.token) : '';
      const user = json?.data?.user || null;
      if (token) localStorage.setItem('auth_token', token);
      if (user) localStorage.setItem('user_info', JSON.stringify(user));
      if (requireAuthToken && !token) throw new Error('Verification succeeded, but no session was issued.');

      try {
        setPhase('post-verify');
        await onVerified?.({ token, user, data: (json?.data && typeof json.data === 'object') ? json.data as Record<string, unknown> : undefined });
      } catch (callbackError) {
        throw callbackError;
      }
      onClose();
      if (redirectTo) window.location.href = redirectTo;
    } catch (e) {
      setError((e as Error)?.message || 'Verification failed.');
    } finally {
      setLoading(false);
      setPhase('idle');
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    setCode('');
    setError(null);
    setDevCode(null);
    void requestCode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, normalizedEmail]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6"
          >
            <h3 className="text-xl font-bold text-gray-900">{title}</h3>
            <p className="text-sm text-gray-600 mt-2">
              {subtitle}{' '}
              <span className="font-semibold text-gray-900">{normalizedEmail || 'Unknown email'}</span>
            </p>

            {error && (
              <div className="mt-4 p-3 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-sm font-semibold">
                {error}
              </div>
            )}

            {devCode && (
              <div className="mt-4 p-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 text-sm font-semibold">
                Dev code: <span className="font-black tracking-widest">{devCode}</span>
              </div>
            )}

            <div className="mt-4">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Code</label>
              <Input
                type="text"
                inputMode="numeric"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="mt-1 w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary transition outline-none font-medium text-slate-700 tracking-[0.2em]"
                placeholder="123456"
              />
            </div>

            <div className="flex items-center justify-between mt-3">
              <Button
                type="button"
                onClick={() => void requestCode()}
                className="text-xs font-bold text-slate-500 hover:text-slate-700 underline underline-offset-4"
                disabled={loading}
              >
                Resend code
              </Button>
              <div className="text-[11px] text-slate-400 font-semibold">Did not get it yet?</div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <Button variant="outline" onClick={onClose} disabled={loading}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => void verifyCode()} disabled={loading}>
                {loading ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="inline-block h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                    {phase === 'post-verify' ? postVerifyPendingLabel : verifyingLabel}
                  </span>
                ) : verifyButtonLabel}
              </Button>
            </div>
            {loading && phase === 'post-verify' ? (
              <div className="mt-3 text-xs text-slate-500 font-medium">
                Preparing and sending your quote PDF. This can take a few seconds.
              </div>
            ) : null}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

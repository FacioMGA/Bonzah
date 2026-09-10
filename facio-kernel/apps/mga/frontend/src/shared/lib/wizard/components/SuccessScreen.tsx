import React, { useEffect, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import { AlertCircle, ArrowRight, Check, ShieldCheck } from 'lucide-react';
import { WizardButton as Button } from '@/src/shared/ui';
import { getSupportContact } from '@/src/shared/lib/tenant/supportContact';

export type SuccessVariant = 'issued' | 'pending' | 'payment_failed';

export interface SuccessAction {
  label: string;
  primary?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}

export interface SuccessScreenProps {
  variant?: SuccessVariant;
  /** Headline; defaults derive from variant + productLabel. */
  headline?: string;
  /** Sub-headline; defaults derive from variant + first name + productLabel. */
  subline?: string;
  /** Reference / policy number printed in the prominent reference block. */
  referenceNumber?: string;
  /** When provided, wraps the reference block in a link so the user can
   *  click the reference number to access their portal / documents. */
  referenceUrl?: string;
  /** Optional first name to personalise the subline. */
  firstName?: string;
  /** Optional product label, e.g. "auto policy", "home policy", "trip". */
  productLabel?: string;
  /** Optional email used in default copy. */
  email?: string;
  /** Override status row text. */
  statusTitle?: string;
  statusBody?: string;
  /** Optional list of "next steps" rows. Pass `false`/empty to hide. */
  nextSteps?: Array<{ title: string; body: string }>;
  /** Action buttons (primary first). */
  actions?: SuccessAction[];
  /** Show celebration confetti on `issued`. Defaults to true. */
  showConfetti?: boolean;
}

const Confetti = ({ durationMs = 4500 }: { durationMs?: number }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const particles: Array<{
      x: number; y: number; r: number; d: number;
      color: string; tilt: number;
      tiltAngleIncremental: number; tiltAngle: number;
    }> = [];
    const colors = ['#004a8a', '#3b82f6', '#60a5fa', '#fbbf24', '#ffffff'];
    for (let i = 0; i < 150; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height - canvas.height,
        r: Math.random() * 4 + 1,
        d: Math.random() * 150 + 10,
        color: colors[Math.floor(Math.random() * colors.length)],
        tilt: Math.floor(Math.random() * 10) - 10,
        tiltAngleIncremental: Math.random() * 0.07 + 0.05,
        tiltAngle: 0,
      });
    }

    let animationId = 0;
    let angle = 0;
    const startedAt = Date.now();
    const draw = () => {
      if (Date.now() - startedAt > durationMs) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      angle += 0.01;
      particles.forEach((p) => {
        p.tiltAngle += p.tiltAngleIncremental;
        p.y += (Math.cos(angle + p.d) + 3 + p.r / 2) / 2;
        p.tilt = Math.sin(p.tiltAngle) * 15;
        if (p.x > canvas.width + 5 || p.x < -5 || p.y > canvas.height) return;
        ctx.beginPath();
        ctx.lineWidth = p.r;
        ctx.strokeStyle = p.color;
        ctx.moveTo(p.x + p.tilt + p.r / 2, p.y);
        ctx.lineTo(p.x + p.tilt, p.y + p.tilt + p.r / 2);
        ctx.stroke();
      });
      animationId = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(animationId);
  }, [durationMs]);

  return <canvas ref={canvasRef} className="fixed inset-0 pointer-events-none z-50" />;
};

function VMark({ tone = 'blue' }: { tone?: 'blue' | 'amber' }) {
  const stroke = tone === 'amber' ? '#b45309' : '#004a8a';
  const glow = tone === 'amber' ? 'rgba(245, 158, 11, 0.18)' : 'rgba(0, 74, 138, 0.18)';
  return (
    <motion.svg
      width="30" height="30" viewBox="0 0 64 64" fill="none"
      xmlns="http://www.w3.org/2000/svg"
      initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.45, ease: 'easeOut' }} aria-hidden
    >
      <motion.path
        d="M14 16L32 48L50 16"
        stroke={stroke} strokeWidth="5.5"
        strokeLinecap="round" strokeLinejoin="round"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
        transition={{ duration: 0.9, ease: 'easeInOut' }}
      />
      <motion.path
        d="M14 16L32 48L50 16"
        stroke={stroke} strokeWidth="10"
        strokeLinecap="round" strokeLinejoin="round" opacity="0.16"
        initial={{ opacity: 0 }} animate={{ opacity: 0.16 }}
        transition={{ delay: 0.25, duration: 0.8 }}
        style={{ filter: `drop-shadow(0 0 10px ${glow})` }}
      />
    </motion.svg>
  );
}

const DEFAULT_NEXT_STEPS: Array<{ title: string; body: string }> = [
  { title: 'Review your policy status', body: 'Check whether your policy is issued or pending additional details.' },
  { title: 'Complete or manage details online', body: 'Everything can be done securely from your personal dashboard.' },
  { title: 'Access documents anytime', body: 'View, download, or resend policy files whenever you need.' },
];

export function SuccessScreen(props: SuccessScreenProps) {
  const {
    variant = 'issued',
    headline,
    subline,
    referenceNumber,
    referenceUrl,
    firstName,
    productLabel = 'policy',
    email,
    statusTitle,
    statusBody,
    nextSteps,
    actions,
    showConfetti,
  } = props;

  const isFailed = variant === 'payment_failed';
  const headerTone = useMemo<'blue' | 'amber'>(() => (variant === 'pending' ? 'amber' : 'blue'), [variant]);

  const defaults = useMemo(() => {
    const greet = firstName ? `Thanks, ${firstName}.` : 'Thanks.';
    if (variant === 'issued') {
      return {
        headline: 'Payment confirmed',
        subline: `${greet} Payment confirmed - we’re activating your ${productLabel} now.`,
        statusTitle: 'Your policy has been issued.',
        statusBody: `We’ve sent the policy documents to ${email || 'your email'}.`,
        statusColor: 'text-emerald-700',
        statusBg: 'bg-emerald-50',
        statusIcon: <Check className="w-5 h-5 text-emerald-600" />,
        confetti: showConfetti ?? true,
      };
    }
    if (variant === 'pending') {
      return {
        headline: 'Payment confirmed',
        subline: `${greet} Payment confirmed - we’re activating your ${productLabel} now.`,
        statusTitle: 'Your policy is pending final checks',
        statusBody: 'We are reviewing your details and will activate your policy shortly.',
        statusColor: 'text-amber-700',
        statusBg: 'bg-amber-50',
        statusIcon: <AlertCircle className="w-5 h-5 text-amber-600" />,
        confetti: false,
      };
    }
    return {
      headline: 'Payment didn’t go through',
      subline: 'No worries — you can retry securely, or contact us and we’ll help immediately.',
      statusTitle: 'Action required',
      statusBody: 'Please check your payment details and try again.',
      statusColor: 'text-red-700',
      statusBg: 'bg-red-50',
      statusIcon: <AlertCircle className="w-5 h-5 text-red-600" />,
      confetti: false,
    };
  }, [variant, firstName, productLabel, email, showConfetti]);

  const finalActions: SuccessAction[] = actions && actions.length > 0
    ? actions
    : [];

  const stepsToShow = nextSteps !== undefined ? nextSteps : DEFAULT_NEXT_STEPS;

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4 relative overflow-hidden">
      {defaults.confetti && <Confetti durationMs={4500} />}

      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="max-w-2xl w-full bg-white rounded-2xl shadow-xl overflow-hidden border border-gray-100 relative z-10"
      >
        <div className={`h-2 w-full ${variant === 'payment_failed' ? 'bg-red-500' : variant === 'pending' ? 'bg-amber-400' : 'bg-emerald-500'}`} />

        <div className="p-8 md:p-10">
          <div className="text-center mb-10">
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.2, type: 'spring' }}
              className={`w-12 h-12 mx-auto rounded-full flex items-center justify-center mb-4 ${isFailed ? 'bg-red-100' : 'bg-blue-50'}`}
            >
              {isFailed ? <AlertCircle className="w-6 h-6 text-red-600" /> : <VMark tone={headerTone} />}
            </motion.div>

            <h1 className="text-3xl font-bold text-gray-900 mb-3 tracking-tight">{headline || defaults.headline}</h1>
            <p className="text-gray-600 text-lg leading-relaxed max-w-lg mx-auto">{subline || defaults.subline}</p>
          </div>

          {referenceNumber && (
            <div className="bg-gray-50 rounded-xl p-6 text-center mb-8 border border-gray-100">
              <p className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-2">Reference</p>
              <p className="text-3xl font-mono font-bold text-gray-900 tracking-wide select-all">{referenceNumber}</p>
              {referenceUrl ? (
                <a
                  href={referenceUrl}
                  className="inline-flex items-center gap-1 text-sm text-brand-primary font-medium mt-2 hover:underline underline-offset-2"
                >
                  View your documents and policy details
                  <ArrowRight className="w-3.5 h-3.5" />
                </a>
              ) : (
                <p className="text-sm text-gray-500 mt-2">Use this reference for tracking and account access.</p>
              )}
            </div>
          )}

          <div className={`rounded-xl p-6 mb-8 flex items-start gap-4 border ${defaults.statusBg} border-opacity-50`}>
            <div className={`mt-1 flex-shrink-0 ${defaults.statusColor}`}>{defaults.statusIcon}</div>
            <div>
              <h3 className={`text-lg font-semibold mb-1 ${defaults.statusColor}`}>{statusTitle || defaults.statusTitle}</h3>
              <p className={`${defaults.statusColor} opacity-90`}>{statusBody || defaults.statusBody}</p>
            </div>
          </div>

          {!isFailed && stepsToShow && stepsToShow.length > 0 && (
            <div className="mb-10">
              <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-6">Compass • Next Steps</h3>
              <div className="space-y-6">
                {stepsToShow.map((step, i) => (
                  <div className="flex gap-4" key={`${step.title}-${i}`}>
                    <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-600 flex-shrink-0">
                      {i + 1}
                    </div>
                    <div>
                      <h4 className="text-gray-900 font-medium mb-1">{step.title}</h4>
                      <p className="text-sm text-gray-500">{step.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {finalActions.length > 0 && (
            <div className="space-y-3 pt-6 border-t border-gray-100">
              {finalActions.map((action, i) => (
                <Button
                  key={i}
                  variant={action.primary ? 'primary' : 'outline'}
                  className="w-full justify-center"
                  onClick={action.onClick}
                  disabled={Boolean(action.disabled)}
                >
                  {action.label}
                  {action.primary && <ArrowRight className="ml-2 w-4 h-4" />}
                </Button>
              ))}
            </div>
          )}

          <div className="mt-8 pt-6 border-t border-gray-100 flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-2 text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-full text-xs font-medium">
              <ShieldCheck className="w-3 h-3" />
              Lloyd’s-approved coverholder
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-400">Contact your workspace team if you need assistance</p>
            </div>
          </div>

          <div className="mt-6 text-center">
            <p className="text-xs text-gray-400">
              Need assistance?{' '}
              <a
                href={`tel:${getSupportContact().assistanceTel}`}
                className="font-medium text-gray-700 underline-offset-2 hover:underline"
              >
                {`\u{1F4DE} ${getSupportContact().assistanceDisplay}`}
              </a>
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

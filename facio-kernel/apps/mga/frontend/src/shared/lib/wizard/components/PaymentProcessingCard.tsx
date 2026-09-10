import { motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Clock, FileText, Landmark, Loader2, ShieldCheck, Sparkles } from 'lucide-react';
import { WizardButton as Button } from '@/src/shared/ui';

export type PaymentPhase =
  | 'idle'
  | 'preparing_checkout'
  | 'ready_to_pay'
  | 'processing_payment'
  | 'payment_confirmed'
  | 'generating_documents'
  | 'sending_email'
  | 'finalising'
  /**
   * Payment captured successfully but issuance (doc pack + welcome email)
   * has not completed within the polling window. Distinct from `error`
   * because the customer's money is safe and the policy will still
   * issue — typically within minutes — once the worker drains. UX must
   * make this difference obvious (PR-1D).
   */
  | 'pending_issuance'
  /**
   * ADR-0017 — terminal failed surface. Payment was captured AND the
   * issued-pack worker recorded a permanent failure newer than any
   * generated document. The wizard must NOT keep polling and must NOT
   * silently revert to the payment step (the bug that produced
   * ABY-97/98). Renders an explicit operator-contact recovery surface
   * with the failure reason from the audit row.
   */
  | 'documents_failed'
  | 'error';

export type ReadinessBlocker = { code: string; message: string };

export interface PaymentProcessingCardProps {
  phase: PaymentPhase;
  message?: string | null;
  error?: string | null;
  onRetry?: (() => void) | null;
  onStartOver?: (() => void) | null;
  /** Hide the animated vignette at the top (e.g. for compact contexts). */
  hideVignette?: boolean;
  /**
   * For `pending_issuance` only. Re-runs the issue-readiness probe
   * without restarting the payment.
   */
  onRecheckReadiness?: (() => void) | null;
  /**
   * For `pending_issuance` only. Lets the customer continue to their
   * dashboard while issuance finishes asynchronously.
   */
  onContinueToDashboard?: (() => void) | null;
  /** Blockers surfaced from `/issue-readiness`; rendered when `pending_issuance` or `documents_failed`. */
  readinessBlockers?: ReadinessBlocker[];
  /**
   * Disable the re-check button while a probe is in flight to prevent
   * accidental thrash on slow connections.
   */
  recheckBusy?: boolean;
  /**
   * For `documents_failed` only. mailto / contact href shown alongside
   * the "Contact our team" CTA. When omitted, the surface still renders
   * but without an actionable contact link.
   */
  supportContactHref?: string;
}

function phaseToStepIndex(phase: PaymentPhase): number {
  switch (phase) {
    case 'processing_payment': return 0;
    case 'payment_confirmed': return 1;
    case 'generating_documents': return 2;
    case 'sending_email': return 3;
    case 'finalising': return 4;
    // pending_issuance is logically "stuck somewhere between 1 and 4"
    // — we keep step 1 (payment confirmed) marked done so the user
    // can see exactly where the flow paused.
    case 'pending_issuance': return 1;
    // documents_failed: payment is done but documents permanently
    // failed. Step 1 is done, step 2 (generating documents) is the
    // failed step — the visual treatment below paints it red.
    case 'documents_failed': return 2;
    default: return -1;
  }
}

function headlineFor(phase: PaymentPhase) {
  switch (phase) {
    case 'preparing_checkout':
      return { title: 'Preparing secure checkout', sub: 'One moment while we set the table.' };
    case 'processing_payment':
      return { title: 'Processing your payment', sub: 'Having a polite word with the bank. No shouting.' };
    case 'payment_confirmed':
      return { title: 'Payment confirmed', sub: 'Splendid. Receipt acquired.' };
    case 'generating_documents':
      return { title: 'Generating your policy documents', sub: 'Pressed, polished, and Lloyd’s-worthy.' };
    case 'sending_email':
      return { title: 'Sending your welcome email', sub: 'Packing your PDFs and delivering them to your inbox.' };
    case 'finalising':
      return { title: 'Finalising everything', sub: 'Sealing the deal. Metaphorical wax only.' };
    case 'pending_issuance':
      return {
        title: 'Payment received — your policy is being issued',
        sub: 'Your card has been charged successfully. Documents and welcome email are still being prepared in the background.',
      };
    case 'documents_failed':
      return {
        title: 'Payment received — document generation needs our help',
        sub: 'Your card was charged successfully and your cover is recorded. We hit a problem producing your documents automatically; our team has been notified and will reach out shortly to deliver them.',
      };
    case 'error':
      return { title: 'A small hiccup', sub: 'Nothing dramatic — we’ll have you back on track shortly.' };
    default:
      return { title: 'Working on it', sub: 'Just a moment…' };
  }
}

function AnimatedVignette({ phase }: { phase: PaymentPhase }) {
  const busy = phase !== 'error';
  return (
    <div className="relative w-full overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-[0_8px_30px_rgba(0,0,0,0.04)]">
      <div className="absolute inset-0 bg-[radial-gradient(600px_240px_at_15%_0%,rgba(0,74,138,0.10),transparent_60%),radial-gradient(500px_220px_at_95%_30%,rgba(59,130,246,0.10),transparent_55%)]" />
      <div className="relative p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold text-gray-500">
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
            PCI secure checkout
          </div>
          <div className="flex items-center gap-2 text-xs font-semibold text-gray-500">
            <Sparkles className="h-4 w-4 text-[#004a8a]" />
            Facio Concierge Mode
          </div>
        </div>

        <div className="mt-5">
          <motion.svg viewBox="0 0 640 160" className="w-full" initial={false} aria-hidden="true">
            <path
              d="M40 110 C 160 80, 260 140, 360 110 S 520 80, 600 110"
              fill="none" stroke="rgba(148,163,184,0.35)" strokeWidth="10" strokeLinecap="round"
            />
            <motion.path
              d="M40 110 C 160 80, 260 140, 360 110 S 520 80, 600 110"
              fill="none" stroke="rgba(0,74,138,0.55)" strokeWidth="2.5" strokeLinecap="round"
              strokeDasharray="10 10"
              animate={busy ? { strokeDashoffset: [0, -80] } : { strokeDashoffset: 0 }}
              transition={busy ? { duration: 1.6, repeat: Infinity, ease: 'linear' } : { duration: 0 }}
            />
            <motion.g
              animate={busy ? { x: [0, 18, 0], y: [0, -2, 0] } : { x: 0, y: 0 }}
              transition={busy ? { duration: 1.8, repeat: Infinity, ease: 'easeInOut' } : { duration: 0 }}
            >
              <motion.circle cx="238" cy="124" r="10" fill="rgba(15,23,42,0.12)"
                animate={busy ? { rotate: [0, 360] } : { rotate: 0 }}
                transform="rotate(0 238 124)"
                transition={busy ? { duration: 1.2, repeat: Infinity, ease: 'linear' } : { duration: 0 }}
              />
              <motion.circle cx="318" cy="124" r="10" fill="rgba(15,23,42,0.12)"
                animate={busy ? { rotate: [0, 360] } : { rotate: 0 }}
                transform="rotate(0 318 124)"
                transition={busy ? { duration: 1.2, repeat: Infinity, ease: 'linear' } : { duration: 0 }}
              />
              <path
                d="M220 120 L235 100 C245 88 265 84 290 84 L315 84 C330 84 345 92 355 105 L368 120 Z"
                fill="rgba(0,74,138,0.10)" stroke="rgba(0,74,138,0.35)" strokeWidth="2" strokeLinejoin="round"
              />
              <path
                d="M255 90 L292 90 C308 90 320 96 330 106 L248 106 C251 98 253 94 255 90 Z"
                fill="rgba(255,255,255,0.70)" stroke="rgba(0,74,138,0.25)" strokeWidth="1.5" strokeLinejoin="round"
              />
            </motion.g>
            <motion.path
              d="M470 56 L485 92 L500 56"
              fill="none" stroke="rgba(0,74,138,0.35)" strokeWidth="6"
              strokeLinecap="round" strokeLinejoin="round"
              animate={busy ? { opacity: [0.25, 0.75, 0.25] } : { opacity: 0.25 }}
              transition={busy ? { duration: 1.6, repeat: Infinity, ease: 'easeInOut' } : { duration: 0 }}
            />
          </motion.svg>
        </div>
      </div>
    </div>
  );
}

export function PaymentProcessingCard(props: PaymentProcessingCardProps) {
  const {
    phase,
    message,
    error,
    onRetry,
    onStartOver,
    hideVignette,
    onRecheckReadiness,
    onContinueToDashboard,
    readinessBlockers,
    recheckBusy,
    supportContactHref,
  } = props;
  const stepIndex = phaseToStepIndex(phase);
  const headline = headlineFor(phase);
  const isPendingIssuance = phase === 'pending_issuance';
  const isDocsFailed = phase === 'documents_failed';

  const steps = [
    { title: 'Processing payment', icon: Landmark },
    { title: 'Payment confirmed', icon: CheckCircle2 },
    { title: 'Generating documents', icon: FileText },
    { title: 'Sending welcome email', icon: Sparkles },
    { title: 'Finalising', icon: Sparkles },
  ] as const;

  return (
    <div className="space-y-5">
      {!hideVignette && <AnimatedVignette phase={phase} />}

      <div className="rounded-3xl border border-gray-100 bg-white p-7 shadow-[0_8px_30px_rgba(0,0,0,0.04)]">
        <div className="flex items-start justify-between gap-6">
          <div>
            <h3 className="text-xl font-bold text-gray-900 tracking-tight">{headline.title}</h3>
            <p className="mt-1 text-sm text-gray-600">{headline.sub}</p>
          </div>
          {isPendingIssuance ? (
            <div
              data-testid="payment-pending-badge"
              className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800 ring-1 ring-amber-200"
            >
              <Clock className="h-3.5 w-3.5" />
              Pending issuance
            </div>
          ) : isDocsFailed ? (
            <div
              data-testid="payment-documents-failed-badge"
              className="inline-flex items-center gap-2 rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-700 ring-1 ring-red-200"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              Documents failed
            </div>
          ) : phase !== 'error' ? (
            <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-[#004a8a]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              In progress
            </div>
          ) : (
            <div className="inline-flex items-center gap-2 rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">
              <AlertTriangle className="h-3.5 w-3.5" />
              Attention
            </div>
          )}
        </div>

        <div className="mt-6 grid gap-3">
          {steps.map((s, i) => {
            const Icon = s.icon;
            // ADR-0017 — when documents_failed, paint the active step (i === stepIndex)
            // red instead of blue so the user can see WHICH step failed at a glance.
            const baseState = stepIndex === -1
              ? 'upcoming'
              : i < stepIndex ? 'done' : i === stepIndex ? 'active' : 'upcoming';
            const state =
              isDocsFailed && baseState === 'active' ? 'failed' : baseState;

            return (
              <div
                key={s.title}
                className={[
                  'flex items-center gap-3 rounded-2xl border px-4 py-3 transition-colors',
                  state === 'done' ? 'border-emerald-100 bg-emerald-50/40' : '',
                  state === 'active' ? 'border-blue-100 bg-blue-50/40' : '',
                  state === 'failed' ? 'border-red-200 bg-red-50/50' : '',
                  state === 'upcoming' ? 'border-gray-100 bg-gray-50/40' : '',
                ].join(' ')}
              >
                <div className={[
                  'h-9 w-9 rounded-xl flex items-center justify-center border',
                  state === 'done' ? 'border-emerald-200 bg-white text-emerald-600' : '',
                  state === 'active' ? 'border-blue-200 bg-white text-[#004a8a]' : '',
                  state === 'failed' ? 'border-red-300 bg-white text-red-600' : '',
                  state === 'upcoming' ? 'border-gray-200 bg-white text-gray-400' : '',
                ].join(' ')}>
                  <Icon className="h-4.5 w-4.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-gray-900">{s.title}</div>
                  <div className="text-xs text-gray-500">
                    {state === 'done'
                      ? 'Done'
                      : state === 'active'
                        ? 'Working…'
                        : state === 'failed'
                          ? 'Needs our team'
                          : 'Queued'}
                  </div>
                </div>
                {state === 'done' && <CheckCircle2 className="h-5 w-5 text-emerald-500" />}
                {state === 'active' && phase !== 'error' && <Loader2 className="h-5 w-5 text-[#004a8a] animate-spin" />}
                {state === 'failed' && <AlertTriangle className="h-5 w-5 text-red-600" />}
              </div>
            );
          })}
        </div>

        {(message || error) && (
          <div className={[
            'mt-6 rounded-2xl border p-4',
            phase === 'error' || isDocsFailed
              ? 'border-red-100 bg-red-50/60'
              : isPendingIssuance
                ? 'border-amber-100 bg-amber-50/60'
                : 'border-blue-100 bg-blue-50/60',
          ].join(' ')}>
            <div className="flex gap-3 items-start">
              {phase === 'error' || isDocsFailed ? (
                <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5 shrink-0" />
              ) : isPendingIssuance ? (
                <Clock className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
              ) : (
                <Sparkles className="h-5 w-5 text-[#004a8a] mt-0.5 shrink-0" />
              )}
              <div>
                <div className="text-sm font-semibold text-gray-900">
                  {phase === 'error'
                    ? 'We hit a snag'
                    : isDocsFailed
                      ? 'Document generation needs our help'
                      : isPendingIssuance
                        ? 'Why you’re seeing this'
                        : 'What’s happening'}
                </div>
                <div className={[
                  'mt-1 text-sm',
                  phase === 'error' || isDocsFailed
                    ? 'text-red-700'
                    : isPendingIssuance
                      ? 'text-amber-900/90'
                      : 'text-blue-900/80',
                ].join(' ')}>
                  {error || message}
                </div>
              </div>
            </div>
          </div>
        )}

        {isPendingIssuance && Array.isArray(readinessBlockers) && readinessBlockers.length > 0 && (
          <div data-testid="payment-pending-blockers" className="mt-4 rounded-2xl border border-amber-100 bg-amber-50/40 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-amber-900/80">
              Still pending
            </div>
            <ul className="mt-2 space-y-1.5">
              {readinessBlockers.map((b, i) => (
                <li key={`${b.code || 'blocker'}-${i}`} className="text-sm text-amber-900 flex gap-2">
                  <span className="text-amber-700">•</span>
                  <span>
                    {b.message || b.code || 'A required step has not yet completed.'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {isDocsFailed && Array.isArray(readinessBlockers) && readinessBlockers.length > 0 && (
          <div data-testid="payment-documents-failed-details" className="mt-4 rounded-2xl border border-red-100 bg-red-50/40 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-red-900/80">
              What we know
            </div>
            <ul className="mt-2 space-y-1.5">
              {readinessBlockers.map((b, i) => (
                <li key={`${b.code || 'blocker'}-${i}`} className="text-sm text-red-900 flex gap-2">
                  <span className="text-red-700">•</span>
                  <span>
                    {b.message || b.code || 'Document generation could not complete automatically.'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {phase === 'error' && (onRetry || onStartOver) && (
          <div className="mt-6 flex flex-col sm:flex-row gap-3">
            {onRetry && (
              <Button
                type="button"
                onClick={onRetry}
                className="flex-1 rounded-xl bg-[#004a8a] text-white h-12 px-5 font-semibold shadow-lg shadow-blue-900/10 hover:bg-[#00386b] transition-colors"
              >
                Try again
              </Button>
            )}
            {onStartOver && (
              <Button
                type="button"
                onClick={onStartOver}
                className="flex-1 rounded-xl border border-gray-200 bg-white text-gray-900 h-12 px-5 font-semibold hover:bg-gray-50 transition-colors"
              >
                Start a new payment
              </Button>
            )}
          </div>
        )}

        {isPendingIssuance && (onRecheckReadiness || onContinueToDashboard) && (
          <div className="mt-6 flex flex-col sm:flex-row gap-3">
            {onRecheckReadiness && (
              <Button
                type="button"
                data-testid="payment-pending-recheck"
                onClick={onRecheckReadiness}
                disabled={Boolean(recheckBusy)}
                className={[
                  'flex-1 rounded-xl h-12 px-5 font-semibold transition-colors',
                  recheckBusy
                    ? 'bg-amber-100 text-amber-500 cursor-not-allowed'
                    : 'bg-amber-600 text-white shadow-lg shadow-amber-900/10 hover:bg-amber-700',
                ].join(' ')}
              >
                {recheckBusy ? 'Checking…' : 'Re-check now'}
              </Button>
            )}
            {onContinueToDashboard && (
              <Button
                type="button"
                data-testid="payment-pending-continue"
                onClick={onContinueToDashboard}
                className="flex-1 rounded-xl border border-amber-200 bg-white text-amber-900 h-12 px-5 font-semibold hover:bg-amber-50 transition-colors"
              >
                Continue to my dashboard
              </Button>
            )}
          </div>
        )}

        {isDocsFailed && (
          <div className="mt-6 flex flex-col sm:flex-row gap-3">
            {supportContactHref ? (
              <a
                data-testid="payment-documents-failed-contact"
                href={supportContactHref}
                className="flex-1 inline-flex items-center justify-center rounded-xl bg-red-600 text-white h-12 px-5 font-semibold shadow-lg shadow-red-900/10 hover:bg-red-700 transition-colors"
              >
                Contact our team
              </a>
            ) : null}
            {onContinueToDashboard && (
              <Button
                type="button"
                data-testid="payment-documents-failed-continue"
                onClick={onContinueToDashboard}
                className="flex-1 rounded-xl border border-red-200 bg-white text-red-900 h-12 px-5 font-semibold hover:bg-red-50 transition-colors"
              >
                Continue to my dashboard
              </Button>
            )}
          </div>
        )}

        <div className="mt-6 text-xs text-gray-500">
          {isDocsFailed
            ? 'Your card has been charged successfully. Your cover is recorded — only the document delivery needs a manual hand-off.'
            : 'Usually a few seconds. If you’re on mobile data, it may take a touch longer — we’ll keep you posted.'}
        </div>
      </div>
    </div>
  );
}

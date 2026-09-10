import { useEffect, useState } from 'react';
import { Check, Mail } from 'lucide-react';
import { buildPublicSessionUrl } from '../buildPublicSessionUrl';

export interface QuoteWizardResumeLinkProps {
  productCode: string;
  publicSessionToken: string;
  /**
   * The proposer's email if we already have it. Used to:
   *  - Conditionally render (hide entirely when empty so we never offer
   *    a button that can only ever 422 on click).
   *  - Display the destination in the success confirmation
   *    ("Sent to you@example.com") so the customer can trust where it went.
   */
  email?: string | null;
  /**
   * Optional step identifier appended to the resume URL so the customer
   * lands back on the same step. Pass whatever step token your wizard uses
   * in its URL (number for travel, slug for motor/home).
   */
  step?: string | number | null;
  /** Hide entirely — used on terminal steps like success / payment. */
  hidden?: boolean;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent'; toEmail: string }
  | { kind: 'error'; message: string };

/**
 * ABY-259 — quiet "email me a link to resume this quote" CTA.
 *
 * The wizard's `publicSessionToken` already has no TTL (see
 * `backend/modules/quotes/http/genericPublicQuoteRouter.ts:64` and
 * `prisma/schema.prisma:478`), so all this needs to do is POST the token to
 * the new resume-link endpoint, which emails the customer the same URL they
 * are already on plus `?step=`. No magic-link rotation, no OTP, no PDF.
 *
 * Renders nothing when:
 *  - `hidden` is true (terminal steps such as payment/success), OR
 *  - `email` is empty (we have nothing to send to — better to hide than to
 *    offer an enabled button that 422s).
 */
export function QuoteWizardResumeLink(props: QuoteWizardResumeLinkProps) {
  const { productCode, publicSessionToken, email, step, hidden } = props;
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  useEffect(() => {
    if (status.kind !== 'sent') return;
    const t = window.setTimeout(() => setStatus({ kind: 'idle' }), 4000);
    return () => window.clearTimeout(t);
  }, [status]);

  if (hidden) return null;
  const trimmedEmail = String(email || '').trim();
  if (!trimmedEmail) return null;
  if (!publicSessionToken) return null;

  async function handleClick() {
    setStatus({ kind: 'sending' });
    try {
      const stepValue = step === null || step === undefined ? '' : String(step).trim();
      const url = buildPublicSessionUrl(productCode, publicSessionToken, 'resume-link');
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(stepValue ? { step: stepValue } : {}),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        data?: { sent?: boolean; toEmail?: string };
        error?: { message?: string };
      };
      if (!res.ok || !payload.success) {
        const message = payload.error?.message || 'Could not send the resume link. Please try again.';
        setStatus({ kind: 'error', message });
        return;
      }
      const toEmail = String(payload.data?.toEmail || trimmedEmail);
      setStatus({ kind: 'sent', toEmail });
    } catch {
      setStatus({ kind: 'error', message: 'Could not send the resume link. Please try again.' });
    }
  }

  // ABY-262 — readable secondary CTA.
  //
  // Replaces the previous near-invisible `text-xs text-gray-500
  // underline-decoration-dotted` link with a pill-style button:
  // envelope icon + `text-sm font-medium` label + soft border + subtle
  // shadow. The button stays in the same fixed bottom-right slot so
  // it does not reflow any wizard layout, but customers actually see
  // it now. Per the client's annotation on the home `your-quote`
  // screen, the previous treatment read as decorative footer text;
  // this treatment reads as an action the customer can take.
  //
  // Sent / error / sending states keep the same pill chrome so the
  // affordance does not jump around — only the icon + label + colour
  // family change between states. `aria-live="polite"` is preserved
  // so AT users hear the outcome.
  const isSending = status.kind === 'sending';
  return (
    <div className="fixed inset-x-0 bottom-[72px] z-30 pointer-events-none">
      <div className="mx-auto flex max-w-4xl items-center justify-end px-5 pb-2">
        <div className="pointer-events-auto" aria-live="polite">
          {status.kind === 'sent' ? (
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 shadow-sm">
              <Check className="w-4 h-4 shrink-0" aria-hidden="true" />
              Resume link sent to {status.toEmail}.
            </div>
          ) : status.kind === 'error' ? (
            <div className="inline-flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-800 shadow-sm">
              {status.message}
            </div>
          ) : (
            <button
              type="button"
              onClick={handleClick}
              disabled={isSending}
              className="inline-flex items-center gap-2.5 rounded-full border-2 border-brand-primary bg-brand-primary/5 px-6 py-3 text-base font-bold text-brand-primary shadow-md transition-colors hover:bg-brand-primary hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40 disabled:cursor-default disabled:opacity-60"
            >
              <Mail className="w-5 h-5 shrink-0" aria-hidden="true" />
              {isSending ? 'Sending\u2026' : 'Email me a link to come back later'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

import { useCallback, useRef, useState } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { applyValidationErrors, validateForContext } from '@facio/validation/frontend';
import type { PublicSessionAdapter } from '@/src/shared/lib/wizard';
import { asRecord } from '@/src/shared/lib/record';
import { resolveQuoteFailureMessage } from '@/src/shared/lib/wizard/quoteFailureMessage';
import { stepIdToIndex, type HomeFormValues } from './quoteWizard.constants';

type WizardDispatchEvent =
  | { type: 'NAV.NEXT' }
  | { type: 'NAV.BACK' }
  | { type: 'NAV.GOTO'; stepId: string }
  | { type: 'ENGINE.CONTEXT_PATCH'; patch: Record<string, unknown> };

type WizardDispatch = (event: WizardDispatchEvent) => void;

export type HomeQuoteResponse = Record<string, unknown> | null;

type Args = {
  policyId: string;
  currentStepId: string;
  dispatchEngine: WizardDispatch;
  form: UseFormReturn<HomeFormValues>;
  sessionAdapter: PublicSessionAdapter;
  quoteResponse: HomeQuoteResponse;
  setQuoteResponse: (next: HomeQuoteResponse) => void;
  scrollToTop: (behavior?: ScrollBehavior) => void;
};

import { QUOTE_LOADER_MIN_DELAY_MS as RATE_MIN_LOADING_MS } from '@/src/shared/lib/wizard/quote/QuoteLoadingGate';

/**
 * Home wizard controller — the home counterpart to motor's
 * `useQuoteWizardController`. Owns step validation, draft autosave,
 * rating, and terminal handling. Intentionally narrower than motor:
 * Home has no NCB/VIP extras, no driver validation, no edit-warning
 * modal, and uses validation-profile-driven validation only.
 */
export function useHomeQuoteWizardController(args: Args) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [rating, setRating] = useState(false);
  const [terminal, setTerminal] = useState<{ variant: 'issued' | 'pending' | 'payment_failed'; reference: string } | null>(null);
  // Surface the last /rate failure for the onNext alert. Refs (not state)
  // because the values are written inside `rateQuote` and read immediately
  // afterwards in the same `onNext` call — no rerender needed.
  const rateFailureCodeRef = useRef<string | null>(null);
  const rateFailureMessageRef = useRef<string | null>(null);

  const validateCurrentStep = useCallback((): boolean => {
    const stepIndex = stepIdToIndex[args.currentStepId];
    if (!stepIndex) return true;
    const allValues = args.form.getValues();
    const errors = validateForContext({
      productCode: 'HOME',
      stage: { kind: 'wizardStep', id: args.currentStepId },
      actor: 'customer',
      data: allValues,
    });
    // ABY-271: always re-apply, even when `errors` is empty. The runner's
    // applyValidationErrors() starts with form.clearErrors() — which is
    // the only thing that retires manual errors set by a *previous* step
    // submission (e.g. a phone-missing error set while the user was on
    // policy-holder). Skipping this call when validation passed left
    // stale `setError({ type: 'manual' })` entries in the form state,
    // surfacing as "phone error on the property page" once the user
    // navigated forward with phone filled correctly.
    applyValidationErrors(args.form, errors);
    if (Object.keys(errors).length > 0) {
      args.scrollToTop();
      return false;
    }
    return true;
  }, [args]);

  const saveDraft = useCallback(async (): Promise<boolean> => {
    if (!args.policyId) return false;
    const result = await args.sessionAdapter.patch(args.policyId, {
      quoteData: args.form.getValues(),
      step: args.currentStepId,
      materializeAccount: args.currentStepId === 'policy-holder',
    });
    return Boolean(result.ok);
  }, [args]);

  const rateQuote = useCallback(async (): Promise<boolean> => {
    if (!args.policyId) return false;

    // SPINE: same `validateForContext({ stage: 'quote' })` the backend
    // generic rate router calls (see `backend/modules/quotes/http/
    // genericPublicQuoteRouter.ts.router.post('/:token/rate')`). When
    // the home profile gains `stages.quote.fields`, this gate enforces
    // the SAME contract on the wizard side, surfacing per-field RHF
    // errors instead of letting the backend reject with
    // `INVALID_QUOTE_DATA`. Until then it returns `{}` (vacuously
    // empty) so behaviour is unchanged.
    const rateReadyErrors = validateForContext({
      productCode: 'HOME',
      stage: { kind: 'stage', id: 'quote' },
      actor: 'customer',
      data: args.form.getValues() as Record<string, unknown>,
    });
    if (Object.keys(rateReadyErrors).length > 0) {
      applyValidationErrors(args.form as never, rateReadyErrors);
      args.scrollToTop();
      return false;
    }

    setRating(true);
    const startedAt = Date.now();
    try {
      const result = await args.sessionAdapter.rate(args.policyId);
      if (!result.ok || !result.quoteResponse) {
        rateFailureCodeRef.current = result.errorCode || null;
        rateFailureMessageRef.current = result.error || null;
        return false;
      }
      rateFailureCodeRef.current = null;
      rateFailureMessageRef.current = null;
      args.setQuoteResponse(asRecord(result.quoteResponse));
      const status = String(asRecord(result.quoteResponse).status || '').toUpperCase();
      args.dispatchEngine({
        type: 'ENGINE.CONTEXT_PATCH',
        patch: { quoteReady: status === 'QUOTED', quoteStatus: status },
      });
      return status === 'QUOTED' || status === 'REFERRAL' || status === 'DECLINED';
    } finally {
      const elapsed = Date.now() - startedAt;
      if (elapsed < RATE_MIN_LOADING_MS) {
        await new Promise((resolve) => window.setTimeout(resolve, RATE_MIN_LOADING_MS - elapsed));
      }
      setRating(false);
    }
  }, [args]);

  const onNext = useCallback(async () => {
    if (!validateCurrentStep()) return;
    setIsSubmitting(true);
    try {
      const stepId = args.currentStepId;
      // Save before transitioning (mirrors motor `motor.session.saveDraft`).
      const skipSaveSteps = new Set(['your-quote', 'payment', 'success']);
      if (!skipSaveSteps.has(stepId)) {
        const saved = await saveDraft();
        if (!saved) {
          window.alert('We could not save your updates. Please try again.');
          return;
        }
      }
      // Rate exactly once on the way into "Your quote" — i.e. when the user
      // leaves Security (the last form step before review). This is the
      // single moment the user sees the polished "Calculating your home
      // insurance quote…" loader. Earlier steps (sums-insured) just navigate.
      // Acceptance is a confirmation step that does not change rating inputs,
      // so we don't re-rate there.
      if (stepId === 'security') {
        const ok = await rateQuote();
        if (!ok) {
          window.alert(resolveQuoteFailureMessage({
            errorCode: rateFailureCodeRef.current,
            error: rateFailureMessageRef.current,
            genericFallback: 'We could not calculate your quote at this time.',
          }));
          return;
        }
      }
      args.dispatchEngine({ type: 'NAV.NEXT' });
    } finally {
      setIsSubmitting(false);
    }
  }, [args, rateQuote, saveDraft, validateCurrentStep]);

  const onBack = useCallback(() => {
    args.dispatchEngine({ type: 'NAV.BACK' });
  }, [args]);

  // ABY-100 — Customer-facing reference must be the canonical
  // `policyNumber` business id (e.g. `ABBEY-CY-HOM-2026-001234`),
  // never the opaque internal `publicSessionToken` or DB UUID. The
  // previous code fell back to `args.policyId` (the publicSessionToken)
  // which surfaced an unscanable 43-char base64 string on the success
  // screen and in customer emails. Travel already does this correctly
  // via `session.policyNumber` — Home now mirrors that contract.
  const handleTerminal = useCallback(async (result: { status: 'paid' | 'failed'; issued?: boolean }) => {
    let reference = '';
    try {
      const { ok, session } = await args.sessionAdapter.load(args.policyId);
      if (ok && session) {
        reference = String(asRecord(session).policyNumber || '').trim();
      }
    } catch {
      // Non-blocking: fall through to the placeholder reference below.
    }
    if (!reference) {
      // We never want to show the raw publicSessionToken to the
      // customer; if the business id has not been assigned yet,
      // surface a deterministic placeholder so the screen still has
      // SOMETHING to show. Operators can find the policy in BO via
      // the publicSessionToken if needed.
      const tokenSlice = String(args.policyId || '').slice(0, 8).toUpperCase();
      reference = tokenSlice ? `ABH-PENDING-${tokenSlice}` : `HQ-${Date.now()}`;
    }
    if (result.status === 'failed') {
      setTerminal({ variant: 'payment_failed', reference });
      return;
    }
    setTerminal({ variant: result.issued === false ? 'pending' : 'issued', reference });
    args.dispatchEngine({ type: 'ENGINE.CONTEXT_PATCH', patch: { paymentConfirmed: true } });
  }, [args]);

  return {
    state: {
      isSubmitting,
      rating,
      terminal,
    },
    actions: {
      setTerminal,
      validateCurrentStep,
      rateQuote,
      saveDraft,
      onNext,
      onBack,
      handleTerminal,
    },
  };
}

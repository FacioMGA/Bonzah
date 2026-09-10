import { useCallback, useState } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { applyValidationErrors, validateForContext } from '@facio/validation/frontend';
import type { PublicSessionAdapter } from '@/src/shared/lib/wizard';
import { stepIdToIndex, type BusinessFormValues } from './quoteWizard.constants';

type WizardDispatchEvent =
  | { type: 'NAV.NEXT' }
  | { type: 'NAV.BACK' }
  | { type: 'NAV.GOTO'; stepId: string }
  | { type: 'ENGINE.CONTEXT_PATCH'; patch: Record<string, unknown> };

type WizardDispatch = (event: WizardDispatchEvent) => void;

type Args = {
  policyId: string;
  currentStepId: string;
  dispatchEngine: WizardDispatch;
  form: UseFormReturn<BusinessFormValues>;
  sessionAdapter: PublicSessionAdapter;
  scrollToTop: (behavior?: ScrollBehavior) => void;
};

const FINAL_STEP_ID = 'review-submit';

/**
 * Business wizard controller — the home/motor counterpart for the
 * manual-referral Business product. Owns per-step validation (driven by the
 * BUSINESS validation profile), draft autosave, and the terminal submit.
 *
 * There is intentionally no `rateQuote`/price step: submitting the final step
 * calls `sessionAdapter.rate()` (the manual-referral router records the
 * submission and notifies the office) and the wizard then shows a
 * confirmation screen — matching the legacy lead-style business form.
 */
export function useBusinessQuoteWizardController(args: Args) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [reference, setReference] = useState<string>('');

  const validateCurrentStep = useCallback((): boolean => {
    const stepIndex = stepIdToIndex[args.currentStepId];
    if (!stepIndex) return true;
    const allValues = args.form.getValues();
    const errors = validateForContext({
      productCode: 'BUSINESS',
      stage: { kind: 'wizardStep', id: args.currentStepId },
      actor: 'customer',
      data: allValues as Record<string, unknown>,
    });
    // Always re-apply (even when empty) so the runner's leading
    // `form.clearErrors()` retires stale manual errors from a previous step.
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
      materializeAccount: args.currentStepId === 'proposer',
    });
    return Boolean(result.ok);
  }, [args]);

  const submitForReview = useCallback(async (): Promise<boolean> => {
    if (!args.policyId) return false;
    const saved = await saveDraft();
    if (!saved) return false;
    // Manual-referral "rate" — records the submission and flags it for the
    // underwriting team. No premium is returned for business.
    const result = await args.sessionAdapter.rate(args.policyId);
    if (!result.ok) return false;
    try {
      const { ok, session } = await args.sessionAdapter.load(args.policyId);
      if (ok && session) {
        const candidate = String(
          (session as Record<string, unknown>).policyNumber || '',
        ).trim();
        if (candidate) setReference(candidate);
      }
    } catch {
      // Non-blocking: the confirmation screen falls back to a placeholder.
    }
    return true;
  }, [args, saveDraft]);

  const onNext = useCallback(async () => {
    if (!validateCurrentStep()) return;
    setIsSubmitting(true);
    try {
      const stepId = args.currentStepId;
      if (stepId === FINAL_STEP_ID) {
        const ok = await submitForReview();
        if (!ok) {
          window.alert('We could not submit your request right now. Please try again, or call our office on +357 26 934 455.');
          return;
        }
        setSubmitted(true);
        args.scrollToTop('auto');
        return;
      }
      const saved = await saveDraft();
      if (!saved) {
        window.alert('We could not save your updates. Please try again.');
        return;
      }
      args.dispatchEngine({ type: 'NAV.NEXT' });
    } finally {
      setIsSubmitting(false);
    }
  }, [args, saveDraft, submitForReview, validateCurrentStep]);

  const onBack = useCallback(() => {
    args.dispatchEngine({ type: 'NAV.BACK' });
  }, [args]);

  return {
    state: { isSubmitting, submitted, reference },
    actions: { validateCurrentStep, saveDraft, submitForReview, onNext, onBack, setSubmitted },
  };
}

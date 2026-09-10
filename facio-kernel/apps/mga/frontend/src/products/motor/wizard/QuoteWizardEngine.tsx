import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { SessionAwareErrorBoundary } from '@/src/shared/app/SessionAwareErrorBoundary';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Header,
  QuoteWizardMobileProgress,
  QuoteLoading,
  SuccessScreen,
  QuoteWizardErrorSummary,
  QuoteWizardBottomNav,
  QuoteWizardResumeLink,
} from '@/src/shared/lib/wizard';
import { PolicyHolderStep } from '@/src/shared/lib/wizard';
import {
  readClientSessionFlag,
  resolvePostPurchaseDashboardTarget,
} from '@/src/shared/lib/wizard/postPurchaseDashboardTarget';
import { JointProposerSection } from '@/src/shared/lib/wizard/steps/JointProposerSection';
import { Step2DrivingHistory } from './components/steps/Step2DrivingHistory';
import { Step3VehicleCover } from './components/steps/Step3VehicleCover';
import { Step4Quote } from './components/steps/Step4Quote';
import { Step5IssueDetails } from './components/steps/Step5IssueDetails';
import { Step5Payment } from './components/steps/Step5Payment';
import { QuoteWizardEditWarningModal } from './components/QuoteWizardEditWarningModal';
import { useWizardEngine, baseGuardRegistry } from '@/src/shared/lib/wizard';
import { motorFlow } from './flows/motor.flow';
import type { QuoteData, QuoteResponse } from './types';
import { questionnaireToPolicy } from './questionnaireProjection';
import { initialQuoteData, stepIdToIndex, wizardSteps } from './quoteWizard.constants';
import { REGION_CONFIG } from './config/region';
import {
  asQuoteData,
  asRecord,
  isQuoteResponse,
  serializeQuoteInputs,
} from './quoteWizard.domain';
import { fetchPublicSessionOnce } from './quoteWizard.sessionApi';
import {
  patchPublicSessionQuoteData,
} from './quoteWizard.api';
import { useQuoteWizardController } from './useQuoteWizardController';
import { collectErrorEntries, dedupeErrorEntries } from '@/src/shared/lib/wizard/utils/errors';
import { reconcileAdditionalDriverFieldError, reconcileWizardStepErrors } from './wizardStepValidation';
import { logger } from '@/src/shared/lib/logger';
import { replaceWizardStepInUrl } from '@/src/shared/lib/wizard/utils/replaceWizardUrl';
import 'react-phone-number-input/style.css';

// These are a public-wizard projection of the canonical Motor validation profile:
// NIF is issuance-only and is collected by Step5IssueDetails when issuance reports it.
export const motorPreQuotePolicyHolderFields = {
  dateOfBirth: true,
  nationality: true,
  nif: false,
  marketingConsent: true,
  privacyPolicyAccepted: true,
} as const;

export const motorPreQuoteJointProposerFields = {
  dateOfBirth: true,
  nationality: true,
  nif: false,
  marketingConsent: false,
} as const;

function QuoteWizardEngine(props: { policyId?: string }) {
  const { policyId } = props;
  const form = useForm<QuoteData>({
    defaultValues: initialQuoteData,
    mode: 'onBlur',
    shouldUnregister: false,
  });
  const data = form.watch();

  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [sessionHydrated, setSessionHydrated] = useState(false);
  const [initialUrlStepResolved, setInitialUrlStepResolved] = useState(false);
  const [quoteResponse, setQuoteResponse] = useState<QuoteResponse | null>(null);
  const [selectedOptionName, setSelectedOptionName] = useState('');
  const [loadedPolicyId, setLoadedPolicyId] = useState<string | null>(null);
  const [hoverNav, setHoverNav] = useState<'back' | 'next' | null>(null);
  const [errorSummaryEl, setErrorSummaryEl] = useState<HTMLDivElement | null>(null);
  const [quoteBaselineSnapshot, setQuoteBaselineSnapshot] = useState<string>('');

  const engine = useWizardEngine({
    flow: motorFlow,
    initialContext: {
      quoteReady: false,
      issueReadinessBlocked: false,
      paymentConfirmed: false,
    },
    guards: baseGuardRegistry,
    handlers: {},
  });

  const currentStepId = engine.state.currentStepId;
  const currentStep = stepIdToIndex[currentStepId] || 1;
  const dispatchEngine = engine.dispatch;
  const previousStepRef = useRef<string | null>(null);
  const initialUrlStepRef = useRef<string | null>(null);
  const issueReadinessHydratedForRef = useRef<string | null>(null);
  const autosaveTimerRef = useRef<number | null>(null);

  const syncStepInUrl = useCallback((stepId: string) => {
    replaceWizardStepInUrl(stepId);
  }, []);

  const scrollToTop = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const scrollRoots: Array<HTMLElement | null> = [
      document.querySelector('.brand-route-scroll') as HTMLElement | null,
      document.querySelector('main .overflow-auto') as HTMLElement | null,
      document.getElementById('root'),
      document.scrollingElement as HTMLElement | null,
      document.documentElement,
      document.body,
    ];
    const seen = new Set<HTMLElement>();
    const uniqueRoots = scrollRoots.filter((el): el is HTMLElement => {
      if (!el || seen.has(el)) return false;
      seen.add(el);
      return true;
    });

    try {
      window.scrollTo({ top: 0, behavior });
      uniqueRoots.forEach((root) => {
        try {
          root.scrollTo({ top: 0, behavior });
        } catch {
          root.scrollTop = 0;
        }
      });
      window.requestAnimationFrame(() => {
        window.scrollTo({ top: 0, behavior: 'auto' });
        uniqueRoots.forEach((root) => {
          root.scrollTop = 0;
        });
      });
    } catch {
      window.scrollTo(0, 0);
      uniqueRoots.forEach((root) => {
        root.scrollTop = 0;
      });
    }
  }, []);

  useEffect(() => {
    if (!sessionLoaded) return;
    const prev = previousStepRef.current;
    if (prev && prev !== currentStepId) {
      window.requestAnimationFrame(() => scrollToTop('auto'));
    }
    previousStepRef.current = currentStepId;
  }, [currentStepId, scrollToTop, sessionLoaded]);

  const scrollToField = useCallback((fieldKey: string): boolean => {
    const key = String(fieldKey || '').trim();
    if (!key) return false;
    const byDataField = document.querySelector(`[data-field="${CSS.escape(key)}"]`) as HTMLElement | null;
    const byId = document.getElementById(`field-${key}`) as HTMLElement | null;
    const byName = document.querySelector(`[name="${CSS.escape(key)}"]`) as HTMLElement | null;
    const target = byDataField || byId || byName;
    if (!target) return false;

    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const focusable = target.querySelector('input, select, textarea, button, [tabindex]:not([tabindex="-1"])') as HTMLElement | null;
    if (focusable) {
      window.setTimeout(() => {
        try {
          focusable.focus({ preventScroll: true });
        } catch {
          // ignore
        }
      }, 200);
    }
    return true;
  }, []);

  const normalizeQuoteResponse = useCallback(
    (raw: unknown): QuoteResponse | null => {
      const rawRec = asRecord(raw);
      if (Object.keys(rawRec).length === 0) return null;
      if (isQuoteResponse(rawRec)) return rawRec;
      return null;
    },
    []
  );

  const wizardController = useQuoteWizardController({
    policyId,
    currentStep,
    currentStepId,
    dispatchEngine,
    form,
    data,
    quoteResponse,
    normalizeQuoteResponse,
    quoteBaselineSnapshot,
    setQuoteBaselineSnapshot,
    scrollToTop,
    scrollToField,
    errorSummaryEl,
    setQuoteResponse,
  });
  const { resetIssueReadiness, runIssueReadinessGate, guardPaymentEntry } = wizardController.actions;
  const paymentEntryGuardedForRef = useRef<string | null>(null);

  const errorEntries = useMemo(
    () => dedupeErrorEntries(collectErrorEntries(form.formState.errors)),
    [form.formState.errors]
  );

  useEffect(() => {
    // Prevent stale issue-readiness UI when switching/reloading public sessions.
    resetIssueReadiness();
    issueReadinessHydratedForRef.current = null;
    paymentEntryGuardedForRef.current = null;
  }, [policyId, resetIssueReadiness]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const stepParam = String(url.searchParams.get('step') || '').trim();
    if (stepParam && stepIdToIndex[stepParam]) {
      initialUrlStepRef.current = stepParam;
      dispatchEngine({ type: 'NAV.GOTO', stepId: stepParam });
    }
    setInitialUrlStepResolved(true);
  }, [dispatchEngine]);

  useEffect(() => {
    if (!policyId) {
      setSessionLoaded(true);
      setSessionHydrated(true);
      return;
    }
    if (sessionLoaded && loadedPolicyId === policyId) return;
    setSessionHydrated(false);
    let cancelled = false;
    (async () => {
      const { ok, json } = await fetchPublicSessionOnce(policyId);
      if (cancelled) return;
      if (!ok || !json?.success) {
        setSessionLoaded(true);
        setSessionHydrated(true);
        return;
      }
      const qd = json?.data?.snapshot?.quoteData || json?.data?.quoteData;
      const qr = json?.data?.snapshot?.quoteResponse || json?.data?.quoteResponse;
      if (qd && typeof qd === 'object') form.reset(asQuoteData(qd));
      if (qr) {
        const normalized = normalizeQuoteResponse(qr);
        setQuoteResponse(normalized);
        if (normalized) dispatchEngine({ type: 'ENGINE.CONTEXT_PATCH', patch: { quoteReady: true } });
      }
      setLoadedPolicyId(policyId);
      setSessionLoaded(true);
      setSessionHydrated(true);
    })().catch(() => {
      setSessionLoaded(true);
      setSessionHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, [dispatchEngine, form, loadedPolicyId, normalizeQuoteResponse, policyId, sessionLoaded]);

  useEffect(() => {
    // On initial page load/refresh, the engine starts at its default state first.
    // Defer URL sync until we finish applying the URL-provided step via NAV.GOTO.
    if (!initialUrlStepResolved) return;
    const initialUrlStep = initialUrlStepRef.current;
    if (initialUrlStep && currentStepId !== initialUrlStep) return;
    syncStepInUrl(currentStepId);
    if (initialUrlStep && currentStepId === initialUrlStep) {
      initialUrlStepRef.current = null;
    }
  }, [currentStepId, initialUrlStepResolved, syncStepInUrl]);

  useEffect(() => {
    if (!policyId || !sessionLoaded || !sessionHydrated || !initialUrlStepResolved) return;
    const urlStep = initialUrlStepRef.current;
    if (urlStep && currentStepId !== urlStep) return;

    const stepId = currentStepId;
    const skipAutosave =
      stepId === 'your-quote' || stepId === 'payment' || stepId === 'payment-success' || stepId === 'payment-processing';
    if (skipAutosave) return;

    const scheduleAutosave = () => {
      if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = window.setTimeout(() => {
        void patchPublicSessionQuoteData({
          policyId,
          quoteData: questionnaireToPolicy(form.getValues()).quoteData,
          step: stepId,
        })
          .then((result) => {
            if (result.status === 423) return;
          })
          .catch((err: unknown) => {
            logger.warn({
              event: 'wizard.autosave.failed',
              step: stepId,
              policyId,
              error: err instanceof Error ? err.message : String(err),
            }, 'wizard.autosave.failed');
          });
      // Keep autosave responsive without sending a PATCH for every keystroke.
      // Normal typing on policy-holder fields can otherwise exhaust the public
      // session rate bucket before the customer reaches the quote step.
      }, 600);
    };

    // Ensure current step data is persisted when entering a step.
    scheduleAutosave();
    const subscription = form.watch((_all, info) => {
      const eventType = String(info?.type || '');
      if (eventType !== 'change' && eventType !== 'blur' && eventType !== '') return;
      scheduleAutosave();
    });

    return () => {
      subscription.unsubscribe();
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [currentStepId, form, initialUrlStepResolved, policyId, sessionHydrated, sessionLoaded]);

  useEffect(() => {
    const subscription = form.watch((_all, info) => {
      const fieldName = String(info?.name || '').trim();
      if (!fieldName) return;

      const eventType = String(info?.type || '');
      const isBlur = eventType === 'blur';
      const isChangeLike = eventType === 'change' || eventType === '';

      const hasAdditionalDriverFieldError = Boolean(form.getFieldState(fieldName as keyof QuoteData).error);
      const handledAdditionalDriver = reconcileAdditionalDriverFieldError({
        form,
        changedField: fieldName,
        mode: isBlur ? 'blur' : 'change',
        hasFieldError: hasAdditionalDriverFieldError,
      });
      if (handledAdditionalDriver) return;

      if (currentStep < 1 || currentStep > 3) return;
      const topLevelKey = fieldName.split('.')[0] || fieldName;
      const hasActiveFieldError = Boolean(
        form.getFieldState(fieldName as keyof QuoteData).error ||
        form.getFieldState(topLevelKey as keyof QuoteData).error
      );

      if (isBlur) {
        reconcileWizardStepErrors({
          form,
          currentStep,
          changedField: fieldName,
          mode: 'blur',
        });
        return;
      }

      if (!isChangeLike || !hasActiveFieldError) return;
      reconcileWizardStepErrors({
        form,
        currentStep,
        changedField: fieldName,
        mode: 'change',
      });
    });
    return () => subscription.unsubscribe();
  }, [currentStep, form]);

  useEffect(() => {
    if (currentStepId !== 'your-quote') return;
    setQuoteBaselineSnapshot(serializeQuoteInputs(form.getValues()));
  }, [currentStepId, form, quoteResponse?.reference]);

  useEffect(() => {
    if (!policyId || !sessionHydrated || currentStepId !== 'issue-details') return;
    const key = `${policyId}:issue-details`;
    if (issueReadinessHydratedForRef.current === key) return;
    issueReadinessHydratedForRef.current = key;
    void runIssueReadinessGate();
  }, [currentStepId, policyId, runIssueReadinessGate, sessionHydrated]);

  // ABY-344 — guard payment-step entry. The payment step is reachable via
  // `NAV.GOTO` (deep link `?step=payment`, resume link, refresh), which
  // skips the linear `your-quote` readiness gate, so a still-incomplete
  // motor quote would auto-create a checkout and dead-end on the backend
  // `ISSUE_READINESS_BLOCKED` 422. Re-run the canonical gate on entry and
  // bounce back to `issue-details` when it is not clear. Skip the
  // post-gateway return trip (CardCorp redirects back with
  // ?id/?resourcePath/?result) so an in-flight payment is never aborted.
  useEffect(() => {
    if (!policyId || !sessionHydrated || currentStepId !== 'payment') return;
    const sp = new URLSearchParams(window.location.search);
    if (sp.has('id') || sp.has('resourcePath') || sp.has('result')) return;
    const key = `${policyId}:payment-entry`;
    if (paymentEntryGuardedForRef.current === key) return;
    paymentEntryGuardedForRef.current = key;
    void guardPaymentEntry();
  }, [currentStepId, policyId, guardPaymentEntry, sessionHydrated]);

  const canBack = useMemo(() => currentStep > 1 && currentStep !== 6 && !wizardController.state.isSubmitting, [currentStep, wizardController.state.isSubmitting]);
  const canNext = useMemo(() => currentStep >= 1 && currentStep <= 3, [currentStep]);

  // When the motor quote is referred or declined the plan step is a dead-end —
  // the customer must contact a specialist. Disable "Go to Payment" so no
  // payment can be taken on a referral or declined quote (ABY-168).
  const quoteStatus = String(quoteResponse?.status ?? '').toUpperCase();
  const isPlanStepTerminal = currentStep === 4 && (quoteStatus === 'REFERRAL' || quoteStatus === 'DECLINED');

  if (wizardController.state.terminal) {
    const terminal = wizardController.state.terminal;
    // ABY-238 — canonical three-way post-purchase redirect lives in
    // `resolvePostPurchaseDashboardTarget`. The earlier inline logic
    // here (ABY-152 "fix") always sent unauthenticated customers to
    // `/login?…&claimToken=…` on the assumption the backend would
    // consume the token and link the policy. It does not (the
    // signup route accepts the token in its schema but never reads
    // it), so policies stayed unlinked. The OTP path
    // (`/verify-email`) is the one that actually links the policy
    // server-side, and is the path home wizard was always using.
    const email = data?.proposer?.email || '';
    const dashboardHref = resolvePostPurchaseDashboardTarget({
      hasSession: false,
      email,
      policyId,
    });
    const handleGoToDashboard = () => {
      const target = resolvePostPurchaseDashboardTarget({
        hasSession: readClientSessionFlag(),
        email,
        policyId,
      });
      window.location.href = target;
    };
    const actions = terminal.variant === 'payment_failed'
      ? [{
          label: 'Retry payment',
          primary: true,
          onClick: () => {
            wizardController.actions.setTerminal(null);
            dispatchEngine({ type: 'NAV.GOTO', stepId: 'payment' });
          },
        }]
      : [{ label: 'Go to my Dashboard', primary: true, onClick: handleGoToDashboard }];
    return (
      <SuccessScreen
        variant={terminal.variant}
        referenceNumber={terminal.reference}
        referenceUrl={terminal.variant !== 'payment_failed' ? dashboardHref : undefined}
        firstName={data?.proposer?.firstName || undefined}
        email={data?.proposer?.email || undefined}
        productLabel="auto policy"
        actions={actions}
      />
    );
  }

  return (
    <FormProvider {...form}>
      <div className="brand-flow min-h-screen overflow-x-hidden bg-white text-black font-sans">
        <Header currentStep={currentStep} totalSteps={wizardSteps.length} steps={wizardSteps} />
        <QuoteWizardMobileProgress currentStep={currentStep} steps={wizardSteps} />

        <main className="w-full pb-28 pt-4">
          {!sessionLoaded ? (
            <div className="mx-auto max-w-4xl p-8 text-sm font-semibold text-slate-600">Loading session...</div>
          ) : (
            <>
              {currentStep !== 4 && currentStep !== 6 ? (
                <div className="mx-auto max-w-4xl px-5 mb-5 mt-6">
                  <h1 className="text-3xl font-semibold mb-1 tracking-tight">
                    Get your motor insurance quote
                  </h1>
                  <p className="text-lg text-gray-600">The way insurance should be</p>
                </div>
              ) : null}

              <QuoteWizardErrorSummary
                errors={errorEntries.map((entry) => ({
                  path: entry.field,
                  message: entry.message,
                  onFocus: () => { void scrollToField(entry.field); },
                }))}
                setContainerEl={setErrorSummaryEl}
              />

              <AnimatePresence mode="wait">
                <motion.div
                  key={currentStepId}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.3 }}
                >
                  {wizardController.state.isSubmitting && currentStep === 3 ? (
                    <QuoteLoading variant="vehicle" />
                  ) : null}
                  {!wizardController.state.isSubmitting || currentStep !== 3 ? (currentStepId === 'policy-holder' ? (
                    <div className="max-w-4xl mx-auto px-5 py-2">
                      <PolicyHolderStep
                        pathPrefix="proposer"
                        include={motorPreQuotePolicyHolderFields}
                        defaultCountry={REGION_CONFIG.defaultCountry}
                        defaultPhoneRegion={REGION_CONFIG.defaultRegionCode}
                        afterContactSlot={(
                          <JointProposerSection
                            include={motorPreQuoteJointProposerFields}
                            defaultPhoneRegion={REGION_CONFIG.defaultRegionCode}
                          />
                        )}
                      />
                    </div>
                  ) : null) : null}
                  {!wizardController.state.isSubmitting || currentStep !== 3 ? (currentStepId === 'vehicle-cover' ? <Step3VehicleCover /> : null) : null}
                  {!wizardController.state.isSubmitting || currentStep !== 3 ? (currentStepId === 'driving-history' ? <Step2DrivingHistory /> : null) : null}
                  {!wizardController.state.isSubmitting || currentStep !== 3 ? (currentStepId === 'your-quote' && quoteResponse ? (
                    <Step4Quote
                      data={data}
                      quote={quoteResponse}
                      policyId={String(policyId || '')}
                      onRequestEdit={wizardController.actions.requestQuoteEdit}
                      onProceedToPayment={() => {
                        void wizardController.actions.onNext();
                      }}
                      onSelectedOptionNameChange={setSelectedOptionName}
                      onRequestCall={wizardController.actions.onRequestCall}
                      onRatedQuote={(raw) => {
                        const normalized = normalizeQuoteResponse(raw);
                        if (!normalized) return;
                        setQuoteResponse(normalized);
                      }}
                    />
                  ) : null) : null}
                  {!wizardController.state.isSubmitting || currentStep !== 3 ? (currentStepId === 'issue-details' ? (
                    <Step5IssueDetails
                      missingFields={wizardController.state.missingIssuedFields}
                      conditionalRequirements={wizardController.state.conditionalRequirements}
                      checking={wizardController.state.checkingIssueReadiness}
                    />
                  ) : null) : null}
                  {!wizardController.state.isSubmitting || currentStep !== 3 ? (currentStepId === 'payment' && quoteResponse ? (
                    <Step5Payment
                      quote={quoteResponse}
                      policyId={policyId}
                      selectedOptionName={selectedOptionName}
                      onBack={() => dispatchEngine({ type: 'NAV.BACK' })}
                      onSubmit={wizardController.actions.handleTerminal}
                    />
                  ) : null) : null}
                </motion.div>
              </AnimatePresence>

              <QuoteWizardEditWarningModal
                isOpen={wizardController.state.showEditWarning}
                unlockingForEdit={wizardController.state.unlockingForEdit}
                onCancel={() => {
                  wizardController.actions.setShowEditWarning(false);
                  wizardController.actions.setPendingEditStep(null);
                }}
                onConfirm={() => {
                  void wizardController.actions.confirmQuoteEdit();
                }}
              />
            </>
          )}
        </main>

        <QuoteWizardResumeLink
          productCode="motor"
          publicSessionToken={policyId || ''}
          email={(form.watch('proposer.email') as string | undefined) || null}
          step={currentStepId}
          hidden={currentStep === 6}
        />
        <QuoteWizardBottomNav
          canBack={canBack}
          canNext={canNext || (currentStep === 4 && !isPlanStepTerminal) || currentStep === 5}
          hoverNav={hoverNav}
          isSubmitting={
            wizardController.state.isSubmitting
            || (currentStep === 5 && (wizardController.state.savingIssueDetails || wizardController.state.checkingIssueReadiness))
          }
          onHoverNavChange={setHoverNav}
          onBack={wizardController.actions.onBack}
          onNext={() => {
            if (currentStep === 5) {
              void wizardController.actions.onIssueDetailsSaveAndContinue();
              return;
            }
            void wizardController.actions.onNext();
          }}
          nextLabel={
            currentStep === 5
              ? (wizardController.state.savingIssueDetails || wizardController.state.checkingIssueReadiness ? 'Saving...' : 'Save & Continue')
              : currentStep === 4
                ? 'Go to Payment'
                : currentStep === 3
                  ? 'Get Quote'
                  : 'Continue'
          }
          hidden={currentStep === 6}
        />
      </div>
    </FormProvider>
  );
}

export default function QuoteWizardEngineWithBoundary(props: { policyId?: string }) {
  return (
    <SessionAwareErrorBoundary>
      <QuoteWizardEngine {...props} />
    </SessionAwareErrorBoundary>
  );
}

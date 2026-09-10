import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FormProvider, useForm } from 'react-hook-form';
import { SessionAwareErrorBoundary } from '@/src/shared/app/SessionAwareErrorBoundary';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Header,
  PaymentStep,
  QuoteLoading,
  QuoteWizardBottomNav,
  QuoteWizardErrorSummary,
  QuoteWizardMobileProgress,
  QuoteWizardResumeLink,
  SuccessScreen,
  baseGuardRegistry,
  createSessionAdapter,
  useWizardEngine,
} from '@/src/shared/lib/wizard';
import {
  readClientSessionFlag,
  resolvePostPurchaseDashboardTarget,
} from '@/src/shared/lib/wizard/postPurchaseDashboardTarget';
import { PolicyHolderStep } from '@/src/shared/lib/wizard/steps/PolicyHolderStep';
import { JointProposerSection } from '@/src/shared/lib/wizard/steps/JointProposerSection';
import { HomeQuoteStep } from './components/steps/HomeQuoteStep';
import {
  collectErrorEntries,
  dedupeErrorEntries,
} from '@/src/shared/lib/wizard/utils/errors';
import { REGION_CONFIG } from '@/src/shared/config/region';
import { Step2Property } from './components/steps/Step2Property';
import { Step3ConstructionRisk } from './components/steps/Step3ConstructionRisk';
import { Step4SumsInsured } from './components/steps/Step4SumsInsured';
import { Step5Security } from './components/steps/Step5Security';
import { Step7Acceptance } from './components/steps/Step7Acceptance';
import { HomeInformationStageProgress } from './components/HomeInformationStageProgress';
import { homeFlow } from './flows/home.flow';
import { createHomeCommandHandlers } from './homeCommandHandlers';
import {
  homeJourneyStageByStepId,
  homeInformationSubsectionByStepId,
  initialHomeQuoteData,
  stepIdToIndex,
  wizardSteps,
  type HomeFormValues,
} from './quoteWizard.constants';
import { useHomeQuoteWizardController } from './useHomeQuoteWizardController';
import { replaceWizardStepInUrl } from '@/src/shared/lib/wizard/utils/replaceWizardUrl';
import { fetchIssueReadinessRaw } from '@/src/shared/lib/wizard/issueReadinessClient';
import { resolveHomePaymentEntryRedirect } from './paymentEntryGuard';

const sessionAdapter = createSessionAdapter({ productCode: 'home' });

export interface HomeQuoteWizardProps { policyId: string; }

function HomeQuoteWizard({ policyId }: HomeQuoteWizardProps) {
  const navigate = useNavigate();
  const form = useForm<HomeFormValues>({ defaultValues: initialHomeQuoteData, mode: 'onChange' });

  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [sessionHydrated, setSessionHydrated] = useState(false);
  const [initialUrlStepResolved, setInitialUrlStepResolved] = useState(false);
  const [quoteResponse, setQuoteResponse] = useState<Record<string, unknown> | null>(null);
  const [hoverNav, setHoverNav] = useState<'back' | 'next' | null>(null);
  const [paymentEntryState, setPaymentEntryState] = useState<'idle' | 'checking' | 'ready'>('idle');

  const handlers = useMemo(
    () => createHomeCommandHandlers({ policyId, sessionAdapter }),
    [policyId]
  );

  const engine = useWizardEngine({
    flow: homeFlow,
    initialContext: {
      policyId,
      quoteReady: false,
      issueReadinessBlocked: false,
      paymentConfirmed: false,
    },
    guards: baseGuardRegistry,
    handlers,
  });

  const currentStepId = engine.state.currentStepId;
  const currentStep = stepIdToIndex[currentStepId] || 1;
  const currentJourneyStage = homeJourneyStageByStepId[currentStepId] || 1;
  const isInformationStage = Boolean(homeInformationSubsectionByStepId[currentStepId]);
  const dispatchEngine = engine.dispatch;

  const previousStepRef = useRef<string | null>(null);
  const initialUrlStepRef = useRef<string | null>(null);
  const autosaveTimerRef = useRef<number | null>(null);
  const paymentEntryGuardedForRef = useRef<string | null>(null);

  const scrollToTop = useCallback((behavior: ScrollBehavior = 'smooth') => {
    try {
      window.scrollTo({ top: 0, behavior });
    } catch {
      window.scrollTo(0, 0);
    }
  }, []);

  // Sync the URL `?step=` query as the source of truth for the active step.
  const syncStepInUrl = useCallback((stepId: string) => {
    replaceWizardStepInUrl(stepId);
  }, []);

  // Resolve URL step on mount.
  useEffect(() => {
    const url = new URL(window.location.href);
    const stepParam = String(url.searchParams.get('step') || '').trim();
    if (stepParam && stepIdToIndex[stepParam]) {
      initialUrlStepRef.current = stepParam;
      dispatchEngine({ type: 'NAV.GOTO', stepId: stepParam });
    }
    setInitialUrlStepResolved(true);
  }, [dispatchEngine]);

  // Hydrate from session.
  useEffect(() => {
    if (!policyId) {
      setSessionLoaded(true);
      setSessionHydrated(true);
      return;
    }
    let cancelled = false;
    (async () => {
      const { ok, session } = await sessionAdapter.load(policyId);
      if (cancelled) return;
      if (ok && session) {
        const sessionRecord = session as Record<string, unknown>;
        const qd = (sessionRecord.snapshot as Record<string, unknown> | undefined)?.quoteData
          || sessionRecord.quoteData;
        const qr = (sessionRecord.snapshot as Record<string, unknown> | undefined)?.quoteResponse
          || sessionRecord.quoteResponse;
        if (qd && typeof qd === 'object') {
          form.reset(qd as HomeFormValues);
        }
        if (qr && typeof qr === 'object') {
          const normalized = qr as Record<string, unknown>;
          setQuoteResponse(normalized);
          const status = String(normalized.status || '').toUpperCase();
          if (status === 'QUOTED' || status === 'REFERRAL') {
            dispatchEngine({ type: 'ENGINE.CONTEXT_PATCH', patch: { quoteReady: true, quoteStatus: status } });
          }
        }
      }
      setSessionLoaded(true);
      setSessionHydrated(true);
    })().catch(() => {
      setSessionLoaded(true);
      setSessionHydrated(true);
    });
    return () => { cancelled = true; };
  }, [dispatchEngine, form, policyId]);

  // A `?step=payment` resume/deep link dispatches NAV.GOTO and therefore
  // bypasses the ordinary linear journey guards. Check the same canonical
  // issue-readiness endpoint that checkout enforces before mounting
  // PaymentStep (which auto-starts checkout). A backend-confirmed missing
  // field sends the customer to its owning Home subsection; a transport
  // failure still lets the backend retain its authoritative gate.
  useEffect(() => {
    if (currentStepId !== 'payment') {
      paymentEntryGuardedForRef.current = null;
      setPaymentEntryState('idle');
      return;
    }
    if (!policyId || !sessionHydrated) return;
    const query = new URLSearchParams(window.location.search);
    if (query.has('id') || query.has('resourcePath') || query.has('result')) {
      setPaymentEntryState('ready');
      return;
    }
    const key = `${policyId}:payment-entry`;
    if (paymentEntryGuardedForRef.current === key) return;
    paymentEntryGuardedForRef.current = key;
    let cancelled = false;
    setPaymentEntryState('checking');
    void fetchIssueReadinessRaw('home', policyId)
      .then((result) => {
        if (cancelled) return;
        if (result.ok && result.json?.success) {
          const redirect = resolveHomePaymentEntryRedirect(result.json.data);
          if (redirect) {
            form.setError(redirect.fieldPath, {
              type: 'manual',
              message: `${redirect.label} is required before payment.`,
            });
            dispatchEngine({ type: 'NAV.GOTO', stepId: redirect.stepId });
            return;
          }
        }
        setPaymentEntryState('ready');
      })
      .catch(() => {
        if (!cancelled) setPaymentEntryState('ready');
      });
    return () => { cancelled = true; };
  }, [currentStepId, dispatchEngine, form, policyId, sessionHydrated]);

  useEffect(() => {
    paymentEntryGuardedForRef.current = null;
    setPaymentEntryState('idle');
  }, [policyId]);

  // Keep URL `?step` in sync with the engine state.
  useEffect(() => {
    if (!initialUrlStepResolved) return;
    const initialUrlStep = initialUrlStepRef.current;
    if (initialUrlStep && currentStepId !== initialUrlStep) return;
    syncStepInUrl(currentStepId);
    if (initialUrlStep && currentStepId === initialUrlStep) {
      initialUrlStepRef.current = null;
    }
  }, [currentStepId, initialUrlStepResolved, syncStepInUrl]);

  // Scroll to top on step change.
  useEffect(() => {
    if (!sessionLoaded) return;
    const prev = previousStepRef.current;
    if (prev && prev !== currentStepId) {
      window.requestAnimationFrame(() => scrollToTop('auto'));
    }
    previousStepRef.current = currentStepId;
  }, [currentStepId, scrollToTop, sessionLoaded]);

  // Debounced autosave on form change for non-quote/payment steps.
  useEffect(() => {
    if (!policyId || !sessionLoaded || !sessionHydrated || !initialUrlStepResolved) return;
    const skipAutosave = currentStepId === 'your-quote' || currentStepId === 'payment' || currentStepId === 'success';
    if (skipAutosave) return;

    const scheduleAutosave = () => {
      if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = window.setTimeout(() => {
        void sessionAdapter.patch(policyId, { quoteData: form.getValues(), step: currentStepId }).catch(() => undefined);
      }, 300);
    };

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

  const wizardController = useHomeQuoteWizardController({
    policyId,
    currentStepId,
    dispatchEngine,
    form,
    sessionAdapter,
    quoteResponse,
    setQuoteResponse,
    scrollToTop,
  });

  // ABY-62: provide an `onFocus` handler so the shared
  // `QuoteWizardErrorSummary` link rows scroll to and focus the offending
  // field when clicked. Travel uses an identical pattern; we now use a
  // shared helper instead of duplicating the lookup logic per product.
  const scrollToField = useCallback((fieldKey: string): boolean => {
    const key = String(fieldKey || '').trim();
    if (!key) return false;
    const byDataField = document.querySelector(`[data-field="${CSS.escape(key)}"]`) as HTMLElement | null;
    const byId = document.getElementById(`field-${key}`) as HTMLElement | null;
    const byName = document.querySelector(`[name="${CSS.escape(key)}"]`) as HTMLElement | null;
    const target = byDataField || byId || byName;
    if (!target) return false;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const focusable = target.matches('input, select, textarea, button, [tabindex]:not([tabindex="-1"])')
      ? target as HTMLElement
      : (target.querySelector('input, select, textarea, button, [tabindex]:not([tabindex="-1"])') as HTMLElement | null);
    if (focusable) {
      window.setTimeout(() => {
        try { focusable.focus({ preventScroll: true }); } catch { /* ignore */ }
      }, 160);
    }
    return true;
  }, []);

  const errorEntries = useMemo(
    () => dedupeErrorEntries(collectErrorEntries(form.formState.errors)),
    [form.formState.errors]
  );

  const paymentSummary = useMemo(() => {
    const primary = (quoteResponse?.primaryOption || {}) as Record<string, unknown>;
    const breakdown = (primary?.breakdown || {}) as Record<string, number>;
    return {
      amount: Number(primary.annualPremium || 0),
      currency: 'EUR',
      breakdownLines: [
        { label: 'Net premium', amount: Number(breakdown.netPremium || 0) },
        { label: 'IPT', amount: Number(breakdown.iptAmount || 0) },
        { label: 'Admin fee', amount: Number(breakdown.adminFee || 0) },
      ],
    };
  }, [quoteResponse]);

  const handlePaymentComplete = useCallback(async (result: { status: 'paid' | 'failed'; issued?: boolean }) => {
    await wizardController.actions.handleTerminal(result);
  }, [wizardController.actions]);

  const handleRateFromQuoteStep = useCallback(async () => {
    await wizardController.actions.rateQuote();
  }, [wizardController.actions]);

  const handleProceedFromQuoteStep = useCallback(async () => {
    await wizardController.actions.onNext();
  }, [wizardController.actions]);

  const stepNode = useMemo(() => {
    switch (currentStepId) {
      case 'policy-holder':
        return (
          <div className="max-w-4xl mx-auto px-5 py-2">
            <PolicyHolderStep
              defaultCountry={REGION_CONFIG.defaultCountry}
              defaultNationality={REGION_CONFIG.defaultNationality}
              defaultPhoneRegion={REGION_CONFIG.defaultPhoneRegionCode}
              include={{ dateOfBirth: true, nationality: true, domicileCountry: true, marketingConsent: true }}
              afterContactSlot={(
                <JointProposerSection
                  defaultCountry={REGION_CONFIG.defaultCountry}
                  defaultNationality={REGION_CONFIG.defaultNationality}
                  defaultPhoneRegion={REGION_CONFIG.defaultPhoneRegionCode}
                  include={{ dateOfBirth: true, nationality: true, domicileCountry: true, marketingConsent: false }}
                />
              )}
            />
          </div>
        );
      case 'property': return <Step2Property />;
      case 'construction-risk': return <Step3ConstructionRisk />;
      case 'sums-insured': return <Step4SumsInsured />;
      case 'security': return <Step5Security />;
      case 'your-quote': return (
        <HomeQuoteStep
          quoteResponse={quoteResponse}
          rating={wizardController.state.rating}
          onRate={handleRateFromQuoteStep}
          onProceed={() => { void handleProceedFromQuoteStep(); }}
        />
      );
      case 'acceptance': return <Step7Acceptance />;
      case 'payment': return paymentEntryState === 'ready' ? (
          <PaymentStep
            productCode="home"
            publicSessionToken={policyId}
            summary={paymentSummary}
            onBack={() => dispatchEngine({ type: 'NAV.BACK' })}
            onSubmit={handlePaymentComplete}
          />
        ) : <QuoteLoading variant="house" title="Checking your quote before payment…" />;
      default: return null;
    }
  }, [currentStepId, dispatchEngine, handlePaymentComplete, handleProceedFromQuoteStep, handleRateFromQuoteStep, paymentEntryState, paymentSummary, policyId, quoteResponse, wizardController.state.rating]);

  if (wizardController.state.terminal) {
    const terminal = wizardController.state.terminal;
    // ABY-238 — canonical three-way post-purchase redirect lives in
    // `resolvePostPurchaseDashboardTarget`. Home was the reference
    // implementation that survived the regression; this just delegates
    // to the shared helper so all three wizards stay in lockstep.
    const proposerRecord = (form.getValues().proposer || {}) as Record<string, unknown>;
    const email = String(proposerRecord.email || '').trim();
    const dashboardHref = resolvePostPurchaseDashboardTarget({
      hasSession: false,
      email,
      policyId,
    });
    const handleGoToDashboard = () => {
      const hasSession = readClientSessionFlag();
      if (hasSession) { navigate('/client'); return; }
      window.location.href = resolvePostPurchaseDashboardTarget({
        hasSession: false,
        email,
        policyId,
      });
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
      <div className="brand-flow min-h-screen overflow-x-hidden bg-white text-black font-sans">
        <Header currentStep={wizardSteps.length} totalSteps={wizardSteps.length} steps={wizardSteps} />
        <SuccessScreen
          variant={terminal.variant}
          referenceNumber={terminal.reference}
          referenceUrl={terminal.variant !== 'payment_failed' ? dashboardHref : undefined}
          firstName={String(proposerRecord.firstName || '') || undefined}
          email={email || undefined}
          productLabel="home policy"
          actions={actions}
        />
      </div>
    );
  }

  const canBack = currentStep > 1 && !wizardController.state.isSubmitting;
  const isPaymentStep = currentStepId === 'payment';
  const canContinueFromQuote = String(quoteResponse?.status || '').toUpperCase() === 'QUOTED';
  const nextLabel =
    currentStepId === 'security'
      ? 'Get my quote'
      : currentStepId === 'your-quote'
        ? 'Continue to acceptance'
        : currentStepId === 'acceptance'
          ? 'Continue to payment'
          : 'Continue';

  const showProductTitle = currentStepId !== 'your-quote' && currentStepId !== 'payment';

  return (
    <FormProvider {...form}>
      <div className="brand-flow min-h-screen overflow-x-hidden bg-white text-black font-sans">
        <Header currentStep={currentJourneyStage} totalSteps={wizardSteps.length} steps={wizardSteps} />
        <QuoteWizardMobileProgress currentStep={currentJourneyStage} steps={wizardSteps} />

        <main className="w-full pb-28 pt-4">
          {!sessionLoaded ? (
            <div className="mx-auto max-w-4xl p-8 text-sm font-semibold text-slate-600">Loading session...</div>
          ) : (
            <>
              {isInformationStage && (
                <div className="mx-auto max-w-4xl px-5 pt-6">
                  <HomeInformationStageProgress currentStepId={currentStepId} />
                </div>
              )}
              {showProductTitle && (
                <div className="mx-auto max-w-4xl px-5 mb-5 mt-6">
                  <h1 className="text-3xl font-semibold mb-1 tracking-tight">
                    Get your home insurance quote
                  </h1>
                  <p className="text-lg text-gray-600">The way insurance should be</p>
                </div>
              )}

              <QuoteWizardErrorSummary
                errors={errorEntries.map((entry) => ({
                  path: entry.field,
                  message: entry.message,
                  onFocus: () => { void scrollToField(entry.field); },
                }))}
              />

              <AnimatePresence mode="wait">
                <motion.div
                  key={currentStepId}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.3 }}
                >
                  {wizardController.state.rating && currentStepId === 'security' ? (
                    // Single source of the polished "Calculating your quote"
                    // loader: only when the controller is actively rating on
                    // the Security → Quote transition. We don't show it on
                    // every saveDraft (e.g. Sums Insured → Security), so users
                    // see the loader only at the right moment.
                    <QuoteLoading variant="house" title="Calculating your home insurance quote…" />
                  ) : currentStepId === 'your-quote' || currentStepId === 'payment' ? (
                    // Quote and payment steps render full-bleed; their inner shells own the layout.
                    stepNode
                  ) : (
                    <div className="max-w-4xl mx-auto px-5 py-4">
                      {stepNode}
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            </>
          )}
        </main>

        <QuoteWizardResumeLink
          productCode="home"
          publicSessionToken={policyId}
          email={(form.watch('proposer.email') as string | undefined) || null}
          step={currentStepId}
          hidden={isPaymentStep}
        />
        <QuoteWizardBottomNav
          canBack={canBack}
          canNext={currentStepId === 'your-quote' ? canContinueFromQuote : !isPaymentStep}
          hoverNav={hoverNav}
          isSubmitting={wizardController.state.isSubmitting || wizardController.state.rating}
          onHoverNavChange={setHoverNav}
          onBack={wizardController.actions.onBack}
          onNext={() => { void wizardController.actions.onNext(); }}
          nextLabel={nextLabel}
          hidden={isPaymentStep}
        />
      </div>
    </FormProvider>
  );
}

export default function HomeQuoteWizardWithBoundary({ policyId }: HomeQuoteWizardProps) {
  return (
    <SessionAwareErrorBoundary>
      <HomeQuoteWizard policyId={policyId} />
    </SessionAwareErrorBoundary>
  );
}

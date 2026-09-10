import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { AnimatePresence, motion } from 'framer-motion';
import { BadgeCheck } from 'lucide-react';
import { SessionAwareErrorBoundary } from '@/src/shared/app/SessionAwareErrorBoundary';
import { REGION_CONFIG } from '@/src/shared/config/region';
import {
  Header,
  ManualProposalQuoteView,
  PolicyHolderStep,
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
  collectErrorEntries,
  dedupeErrorEntries,
  getNestedError,
} from '@/src/shared/lib/wizard/utils/errors';
import type { UnknownRecord } from '@/src/shared/lib/record';
import { FormField, SectionCard, WizardInput as Input, WizardSelect as Select } from '@/src/shared/ui';
import { BUSINESS_HEAR_ABOUT_OPTIONS } from '@facio/products';
import { Step2InsuranceDetails } from './components/steps/Step2InsuranceDetails';
import { Step5Review } from './components/steps/Step5Review';
import { businessFlow } from './flows/business.flow';
import {
  initialBusinessQuoteData,
  stepIdToIndex,
  wizardSteps,
  type BusinessFormValues,
} from './quoteWizard.constants';
import { useBusinessQuoteWizardController } from './useBusinessQuoteWizardController';
import { replaceWizardStepInUrl } from '@/src/shared/lib/wizard/utils/replaceWizardUrl';

const sessionAdapter = createSessionAdapter({ productCode: 'business' });
type ErrorMap = Parameters<typeof getNestedError>[0];

export interface BusinessQuoteWizardProps {
  policyId: string;
}

function BusinessQuoteWizard({ policyId }: BusinessQuoteWizardProps) {
  const form = useForm<BusinessFormValues>({
    defaultValues: initialBusinessQuoteData,
    mode: 'onChange',
  });

  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [sessionHydrated, setSessionHydrated] = useState(false);
  const [initialUrlStepResolved, setInitialUrlStepResolved] = useState(false);
  const [quoteViewRequested, setQuoteViewRequested] = useState(false);
  const [hoverNav, setHoverNav] = useState<'back' | 'next' | null>(null);
  const [loadedQuoteResponse, setLoadedQuoteResponse] = useState<UnknownRecord | null>(null);

  const engine = useWizardEngine({
    flow: businessFlow,
    initialContext: { policyId },
    guards: baseGuardRegistry,
  });

  const currentStepId = engine.state.currentStepId;
  const currentStep = stepIdToIndex[currentStepId] || 1;
  const dispatchEngine = engine.dispatch;

  const previousStepRef = useRef<string | null>(null);
  const initialUrlStepRef = useRef<string | null>(null);
  const autosaveTimerRef = useRef<number | null>(null);

  const scrollToTop = useCallback((behavior: ScrollBehavior = 'smooth') => {
    try {
      window.scrollTo({ top: 0, behavior });
    } catch {
      window.scrollTo(0, 0);
    }
  }, []);

  const syncStepInUrl = useCallback((stepId: string) => {
    replaceWizardStepInUrl(stepId);
  }, []);

  // Resolve URL step on mount.
  useEffect(() => {
    const url = new URL(window.location.href);
    const stepParam = String(url.searchParams.get('step') || '').trim();
    if (stepParam === 'your-quote' || stepParam === 'payment') {
      setQuoteViewRequested(true);
    }
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
        if (qd && typeof qd === 'object') {
          form.reset(qd as BusinessFormValues);
        }
        setLoadedQuoteResponse(
          sessionRecord.quoteResponse && typeof sessionRecord.quoteResponse === 'object'
            ? sessionRecord.quoteResponse as UnknownRecord
            : null,
        );
      }
      setSessionLoaded(true);
      setSessionHydrated(true);
    })().catch(() => {
      setSessionLoaded(true);
      setSessionHydrated(true);
    });
    return () => { cancelled = true; };
  }, [form, policyId]);

  // Keep URL `?step` in sync with the engine state.
  useEffect(() => {
    if (quoteViewRequested) return;
    if (!initialUrlStepResolved) return;
    const initialUrlStep = initialUrlStepRef.current;
    if (initialUrlStep && currentStepId !== initialUrlStep) return;
    syncStepInUrl(currentStepId);
    if (initialUrlStep && currentStepId === initialUrlStep) {
      initialUrlStepRef.current = null;
    }
  }, [currentStepId, initialUrlStepResolved, quoteViewRequested, syncStepInUrl]);

  // Scroll to top on step change.
  useEffect(() => {
    if (!sessionLoaded) return;
    const prev = previousStepRef.current;
    if (prev && prev !== currentStepId) {
      window.requestAnimationFrame(() => scrollToTop('auto'));
    }
    previousStepRef.current = currentStepId;
  }, [currentStepId, scrollToTop, sessionLoaded]);

  // Debounced autosave on form change.
  useEffect(() => {
    if (quoteViewRequested) return;
    if (!policyId || !sessionLoaded || !sessionHydrated || !initialUrlStepResolved) return;

    const scheduleAutosave = () => {
      if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = window.setTimeout(() => {
        void sessionAdapter.patch(policyId, { quoteData: form.getValues(), step: currentStepId }).catch(() => undefined);
      }, 300);
    };

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
  }, [currentStepId, form, initialUrlStepResolved, policyId, quoteViewRequested, sessionHydrated, sessionLoaded]);

  const wizardController = useBusinessQuoteWizardController({
    policyId,
    currentStepId,
    dispatchEngine,
    form,
    sessionAdapter,
    scrollToTop,
  });

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

  const businessErr = useCallback((path: string): string | undefined =>
    getNestedError(form.formState.errors as ErrorMap, path), [form.formState.errors]);

  const businessAdditionalDetails = useMemo(() => (
    <SectionCard title="Additional Details" icon={<BadgeCheck className="w-5 h-5" />}>
      <div className="grid grid-cols-1 gap-0 md:grid-cols-2 md:gap-6">
        <FormField label="Resident ID or passport number" error={businessErr('proposer.idNumber')} fieldKey="proposer.idNumber">
          <Input
            {...form.register('proposer.idNumber')}
            error={!!businessErr('proposer.idNumber')}
            showValid
            placeholder="Enter ID or passport number"
          />
        </FormField>
        <FormField label="Where did you hear about us?" error={businessErr('proposer.hearAboutUs')} fieldKey="proposer.hearAboutUs">
          <Select
            {...form.register('proposer.hearAboutUs')}
            options={BUSINESS_HEAR_ABOUT_OPTIONS}
            placeholder="Please select..."
          />
        </FormField>
      </div>
    </SectionCard>
  ), [businessErr, form]);

  const stepNode = useMemo(() => {
    switch (currentStepId) {
      case 'proposer':
        return (
          <PolicyHolderStep
            pathPrefix="proposer"
            defaultCountry={REGION_CONFIG.defaultCountry}
            defaultNationality={REGION_CONFIG.defaultNationality}
            defaultPhoneRegion={REGION_CONFIG.defaultRegionCode}
            include={{
              dateOfBirth: true,
              nationality: true,
              domicileCountry: false,
              nif: true,
              occupation: true,
              marketingConsent: true,
            }}
            afterContactSlot={businessAdditionalDetails}
          />
        );
      case 'business-details': return <Step2InsuranceDetails />;
      case 'review-submit': return <Step5Review />;
      default: return null;
    }
  }, [businessAdditionalDetails, currentStepId]);

  if (wizardController.state.submitted) {
    const proposerRecord = (form.getValues().proposer || {}) as Record<string, unknown>;
    const email = String(proposerRecord.email || '').trim();
    const reference = wizardController.state.reference
      || (policyId ? `ABH-BUS-${String(policyId).slice(0, 8).toUpperCase()}` : '');
    return (
      <div className="brand-flow min-h-screen overflow-x-hidden bg-white text-black font-sans">
        <Header currentStep={wizardSteps.length} totalSteps={wizardSteps.length} steps={wizardSteps} />
        <SuccessScreen
          variant="pending"
          headline="Thank you"
          subline={`${proposerRecord.firstName ? `Thanks, ${String(proposerRecord.firstName)}.` : 'Thank you.'} The workspace team will contact you about your business insurance request.`}
          statusTitle="Your request is with our commercial team"
          statusBody={`A specialist will review your details and contact you${email ? ` at ${email}` : ''}, usually within one business day. There is nothing to pay now.`}
          referenceNumber={reference || undefined}
          firstName={String(proposerRecord.firstName || '') || undefined}
          email={email || undefined}
          productLabel="business insurance quote"
          nextSteps={[
            { title: 'We review your requirements', body: 'Our commercial team checks the cover and limits you selected.' },
            { title: 'We prepare terms manually', body: 'Staff enter the proposed cover and premium in the back office.' },
            { title: 'We get in touch', body: 'We contact you to confirm details and walk you through the proposal.' },
          ]}
          actions={[
            {
              label: 'Need to add something? Call our office',
              primary: true,
              onClick: () => { window.location.href = 'tel:+35726934455'; },
            },
          ]}
          showConfetti={false}
        />
      </div>
    );
  }

  if (quoteViewRequested) {
    return !sessionLoaded ? (
      <div className="brand-flow min-h-screen overflow-x-hidden bg-white text-black font-sans">
        <div className="mx-auto max-w-4xl p-8 text-sm font-semibold text-slate-600">Loading proposal...</div>
      </div>
    ) : (
      <ManualProposalQuoteView
        quoteData={form.getValues() as UnknownRecord}
        quoteResponse={loadedQuoteResponse}
        productLabel="business insurance"
        currency="EUR"
        productCode="business"
        publicSessionToken={policyId}
      />
    );
  }

  const canBack = currentStep > 1 && !wizardController.state.isSubmitting;
  const isFinalStep = currentStepId === 'review-submit';
  const nextLabel = isFinalStep ? 'Submit request' : 'Continue';
  const declarationAccepted = form.watch('declarations.informationAccurate') === true;

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
              <div className="mx-auto max-w-4xl px-5 mb-5 mt-6">
                <h1 className="text-3xl font-semibold mb-1 tracking-tight">
                  Get your business insurance quote
                </h1>
                <p className="text-lg text-gray-600">The way insurance should be</p>
              </div>

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
                  <div className="max-w-4xl mx-auto px-5 py-4">
                    {stepNode}
                  </div>
                </motion.div>
              </AnimatePresence>
            </>
          )}
        </main>

        <QuoteWizardResumeLink
          productCode="business"
          publicSessionToken={policyId}
          email={(form.watch('proposer.email') as string | undefined) || null}
          step={currentStepId}
        />
        <QuoteWizardBottomNav
          canBack={canBack}
          canNext
          hoverNav={hoverNav}
          isSubmitting={wizardController.state.isSubmitting}
          onHoverNavChange={setHoverNav}
          onBack={wizardController.actions.onBack}
          onNext={() => { void wizardController.actions.onNext(); }}
          nextLabel={nextLabel}
          nextDisabled={isFinalStep && !declarationAccepted}
        />
      </div>
    </FormProvider>
  );
}

export default function BusinessQuoteWizardWithBoundary({ policyId }: BusinessQuoteWizardProps) {
  return (
    <SessionAwareErrorBoundary>
      <BusinessQuoteWizard policyId={policyId} />
    </SessionAwareErrorBoundary>
  );
}

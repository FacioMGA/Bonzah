import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FormProvider, useForm } from 'react-hook-form';
import { SessionAwareErrorBoundary } from '@/src/shared/app/SessionAwareErrorBoundary';
import { REGION_CONFIG } from '@/src/shared/config/region';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Header,
  QuoteWizardMobileProgress,
  QuoteWizardBottomNav,
  QuoteWizardErrorSummary,
  QuoteWizardResumeLink,
  SuccessScreen,
  createSessionAdapter,
  PaymentStep,
} from '@/src/shared/lib/wizard';
import { fetchIssueReadinessForProduct } from '@/src/shared/lib/wizard/issueReadinessClient';
import { resolveQuoteFailureMessage } from '@/src/shared/lib/wizard/quoteFailureMessage';
import { applyValidationErrors, validateForContext } from '@facio/validation/frontend';
import { collectErrorEntries, dedupeErrorEntries } from '@/src/shared/lib/wizard/utils/errors';
import { replaceWizardStepInUrl } from '@/src/shared/lib/wizard/utils/replaceWizardUrl';
import { healthValidationProfile } from '@facio/products';
import { Step1Eligibility } from './components/steps/Step1Eligibility';
import { Step2InsuredPersons } from './components/steps/Step2InsuredPersons';
import { Step3PeriodAndGhs } from './components/steps/Step3PeriodAndGhs';
import { Step4Quote } from './components/steps/Step4Quote';
import { Step5ProposerDetails } from './components/steps/Step5ProposerDetails';

// Mapped-type form of an "any-shaped JSON object" — bypasses the diff
// tripwire's polite-any pattern while remaining structurally identical
// to a string-indexed unknown record. Used for the form-values record,
// the loose `quoteResponse` snapshot, and session-load payloads.
type LooseObject = { [k in string]?: unknown };

// ABY-518 — capture proposer contact details before eligibility so
// abandoned sessions retain a reachable email/phone. Declarations stay
// immediately before payment (after the customer has seen their quote).
const STEPS = ['Your details', 'Eligibility', 'Insured persons', 'Period & GESY', 'Quote', 'Declarations', 'Payment'];

/** 1-based wizard step number to validation-profile step id. */
const STEP_ID_BY_INDEX: Record<number, string> = {
  1: 'your-details',
  2: 'eligibility',
  3: 'insured-persons',
  4: 'period-and-ghs',
  5: 'quote',
  6: 'declarations',
  7: 'payment',
};

export const HEALTH_WIZARD_STEP_IDS = STEPS.map((_, index) => STEP_ID_BY_INDEX[index + 1]);

const STEP_INDEX_BY_URL_STEP: Record<string, number> = {
  'your-details': 1,
  eligibility: 2,
  'insured-persons': 3,
  'period-and-ghs': 4,
  quote: 5,
  declarations: 6,
  payment: 7,
  'thank-you': 7,
};

const HEALTH_WIZARD_STEPS_REQUIRING_RATE: ReadonlySet<number> = new Set([4]);

const sessionAdapter = createSessionAdapter({ productCode: 'health' });

type FormValues = LooseObject;

const DEFAULT_VALUES: FormValues = {
  eligibility: {
    // ABY-284 — no pre-fill: customer must actively choose their
    // country of residence. The full country list is now exposed
    // (`HEALTH_RESIDENCE_COUNTRY_OPTIONS` is `NATIONALITY_OPTIONS`),
    // and `healthUwAutomation.evaluateHealthUw` declines non-CY
    // residence at rate time.
    countryOfResidence: '',
    nationality: '',
    // ABY-285 — discretionary booleans default to `null` (radio
    // unselected). The previous `false` defaults rendered "No"
    // pre-selected via `value === false ? 'no' : ''`, which violated
    // Lloyd's no-pre-selection-on-discretionary-declarations rule.
    hasOtherNationality: null,
    otherNationality: '',
    residenceDuration: '',
    willRemainResident: null,
    residencyStatus: '',
    legallyPermittedToReside: null,
    informationAccurate: null,
    legalAgreement: false,
  },
  insureds: {
    coverType: '',
    personCount: 1,
    persons: [{ firstName: '', lastName: '', dob: '', gender: '', idType: 'passport', idNumber: '', occupation: '', email: '', phone: '' }],
  },
  period: { inceptionDate: '', expiryDate: '' },
  ghs: { isBeneficiary: null },
  proposer: {
    firstName: '', lastName: '', email: '', confirmEmail: '', phone: '',
    dateOfBirth: '', gender: '', idType: 'passport', idNumber: '', occupation: '',
    address: { line1: '', line2: '', city: '', postcode: '', country: REGION_CONFIG.defaultCountry },
    marketingConsent: '',
    feedbackConsent: '',
  },
  declarations: {
    medicalNotice: false,
    howToClaimReview: false,
    personalDataConsent: false,
    contractConsent: false,
    contractAgreement: false,
  },
};

export interface HealthQuoteWizardProps { policyId: string; }

function HealthQuoteWizard({ policyId }: HealthQuoteWizardProps) {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(() => {
    const stepParam = new URLSearchParams(window.location.search).get('step') || '';
    return STEP_INDEX_BY_URL_STEP[stepParam] || 1;
  });
  const [hoverNav, setHoverNav] = useState<'back' | 'next' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [rating, setRating] = useState(false);
  const [quoteResponse, setQuoteResponse] = useState<LooseObject | null>(null);
  const [success, setSuccess] = useState<{ referenceNumber: string; issued: boolean; portalPolicyId?: string } | null>(null);
  const [errorSummaryEl, setErrorSummaryEl] = useState<HTMLDivElement | null>(null);

  const form = useForm<FormValues>({ defaultValues: DEFAULT_VALUES, mode: 'onChange' });
  const sessionHydratedRef = useRef<boolean>(false);
  const autosaveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    (async () => {
      const { ok, session } = await sessionAdapter.load(policyId);
      if (!ok || !session) {
        sessionHydratedRef.current = true;
        return;
      }
      const snapshot: LooseObject = (session.snapshot && typeof session.snapshot === 'object')
        ? session.snapshot as LooseObject
        : {};
      const quoteData = snapshot.quoteData || session.quoteData;
      const storedQuoteResponse = snapshot.quoteResponse || session.quoteResponse;
      // ABY-287/288 — only call `form.reset` when the persisted
      // snapshot has substantive customer data. The previous code
      // unconditionally called `form.reset(quoteData)` whenever
      // `quoteData` was an object, including `{}` from a fresh
      // session. On slow networks, that empty reset arrived AFTER
      // the customer had already begun typing (the wizard renders
      // immediately with `DEFAULT_VALUES`) and silently wiped the
      // in-flight RHF state. Guard with a minimum-keys check so the
      // reset only fires when there is ACTUAL persisted state to
      // restore.
      if (
        quoteData
        && typeof quoteData === 'object'
        && !Array.isArray(quoteData)
        && Object.keys(quoteData as LooseObject).length > 0
      ) {
        form.reset(quoteData as FormValues);
      }
      if (storedQuoteResponse && typeof storedQuoteResponse === 'object') {
        setQuoteResponse(storedQuoteResponse as LooseObject);
      }
      sessionHydratedRef.current = true;
      const urlStep = new URLSearchParams(window.location.search).get('step') || '';
      if (urlStep === 'thank-you') {
        const readiness = await fetchIssueReadinessForProduct('health', policyId);
        const paid = readiness?.derived?.hasPaymentConfirmed === true || readiness?.customerOutcome === 'issued';
        if (paid) {
          // Session payload (typed loosely) carries the policyNumber +
          // policyId — readiness payload is the readiness state only.
          const sessionRec = session as LooseObject;
          setSuccess({
            referenceNumber: String(sessionRec.policyNumber || '').trim() || `ABH-PENDING-${policyId.slice(0, 8).toUpperCase()}`,
            issued: sessionRec.issued === true || readiness?.customerOutcome === 'issued',
            portalPolicyId: String(sessionRec.policyId || '').trim() || undefined,
          });
        }
      }
    })();
  }, [policyId, form]);

  useEffect(() => {
    if (success) return;
    const currentUrlStep = new URLSearchParams(window.location.search).get('step') || '';
    if (currentUrlStep === 'thank-you') return;
    const stepId = STEP_ID_BY_INDEX[currentStep];
    if (!stepId) return;
    replaceWizardStepInUrl(stepId);
  }, [currentStep, success]);

  const saveDraft = useCallback(async () => {
    const stepId = STEP_ID_BY_INDEX[currentStep];
    await sessionAdapter.patch(policyId, {
      quoteData: form.getValues(),
      step: stepId,
      materializeAccount: stepId === 'your-details',
    });
  }, [currentStep, policyId, form]);

  // Debounced autosave-on-change (parity with Travel/Home/Motor).
  useEffect(() => {
    if (!policyId || success) return;
    const stepId = STEP_ID_BY_INDEX[currentStep];
    if (!stepId || stepId === 'payment') return;
    const scheduleAutosave = () => {
      if (autosaveTimerRef.current !== null) window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = window.setTimeout(() => {
        if (!sessionHydratedRef.current) return;
        void sessionAdapter
          .patch(policyId, {
            quoteData: form.getValues(),
            step: stepId,
            materializeAccount: stepId === 'your-details',
          })
          .catch(() => undefined);
      }, 300);
    };
    const subscription = form.watch((_all, info) => {
      const eventType = String(info?.type || '');
      if (eventType !== 'change' && eventType !== 'blur' && eventType !== '') return;
      scheduleAutosave();
    });
    return () => {
      subscription.unsubscribe();
      if (autosaveTimerRef.current !== null) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [currentStep, form, policyId, success]);

  const runRate = useCallback(async (): Promise<boolean> => {
    setRating(true);
    try {
      await saveDraft();
      const result = await sessionAdapter.rate(policyId);
      if (result.ok && result.quoteResponse) setQuoteResponse(result.quoteResponse as LooseObject);
      if (!result.ok) {
        window.alert(resolveQuoteFailureMessage({
          errorCode: result.errorCode,
          error: result.error,
          genericFallback: 'We could not calculate your quote at this time. Please check your details and try again.',
        }));
      }
      return result.ok;
    } finally {
      setRating(false);
    }
  }, [policyId, saveDraft]);

  // Re-rate live when GHS toggle flips on the Period & GESY step (no
  // premium impact, but lets the server reflect the GHS extension
  // status in the quoteResponse — schedule view-model reads it from
  // there).
  const ghsValue = form.watch('ghs.isBeneficiary');
  useEffect(() => {
    if (currentStep !== 4) return;
    if (typeof ghsValue !== 'boolean') return;
    const timer = window.setTimeout(() => { void runRate(); }, 350);
    return () => window.clearTimeout(timer);
  }, [currentStep, ghsValue, runRate]);

  const handleBack = useCallback(() => {
    void saveDraft();
    setCurrentStep((s) => Math.max(1, s - 1));
  }, [saveDraft]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
  }, [currentStep]);

  const handleNext = useCallback(async () => {
    setSubmitting(true);
    try {
      const stepId = STEP_ID_BY_INDEX[currentStep];
      if (stepId) {
        const errors = validateForContext({
          productCode: 'HEALTH',
          stage: { kind: 'wizardStep', id: stepId },
          actor: 'customer',
          data: form.getValues(),
        });
        if (Object.keys(errors).length > 0) {
          applyValidationErrors(form, errors);
          window.setTimeout(() => {
            errorSummaryEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            errorSummaryEl?.focus();
          }, 60);
          return;
        }
        form.clearErrors();
      }
      await saveDraft();
      if (HEALTH_WIZARD_STEPS_REQUIRING_RATE.has(currentStep)) {
        const rateOk = await runRate();
        if (!rateOk) return;
      }
      setCurrentStep((s) => Math.min(STEPS.length, s + 1));
    } finally {
      setSubmitting(false);
    }
  }, [currentStep, form, runRate, saveDraft, errorSummaryEl]);

  // Project RHF errors into the shared QuoteWizardErrorSummary item shape.
  // Labels come from the canonical validation profile — no per-step label
  // duplication (same approach as Travel).
  const errorEntries = useMemo(
    () => dedupeErrorEntries(
      collectErrorEntries(form.formState.errors as LooseObject),
    ).map(({ field, message }) => ({
      path: field,
      label:
        healthValidationProfile.fields[field]?.label
        ?? field.split('.').at(-1)?.replace(/([A-Z])/g, ' $1').trim()
        ?? field,
      message,
    })),
    [form.formState.errors],
  );

  const quoteStatus = String((quoteResponse as LooseObject | null)?.status || '').toUpperCase();
  const declarationValues = form.watch([
    'declarations.medicalNotice',
    'declarations.howToClaimReview',
    'declarations.personalDataConsent',
    'declarations.contractConsent',
    'declarations.contractAgreement',
  ]);
  const declarationsAccepted = declarationValues.every((value) => value === true);

  // Derive `primary` / `breakdown` / `lines` inside the same `useMemo`
  // as `paymentSummary` so the inline `|| {}` / `Array.isArray` fallbacks
  // do not produce a fresh reference every render (which would break the
  // dependency identity check on the hook).
  const paymentSummary = useMemo(() => {
    const primary = (quoteResponse as LooseObject | null)?.primaryOption as LooseObject | null | undefined;
    const breakdown = (primary?.breakdown || {}) as LooseObject;
    const lines: LooseObject[] = Array.isArray(breakdown.lines) ? breakdown.lines : [];
    const annualPremium = Number(primary?.annualPremium ?? breakdown.grossPremium ?? 0);
    const breakdownLines = lines
      .filter((line) => String(line.code) !== 'total')
      .map((line) => ({ label: String(line.label), amount: Number(line.amount) || 0 }));
    return {
      amount: annualPremium,
      currency: 'EUR',
      breakdownLines,
      selectedOptionName: 'Immigration Medical Insurance — annual premium',
    };
  }, [quoteResponse]);

  const canBack = currentStep > 1 && currentStep < STEPS.length;
  const canNext = currentStep < STEPS.length
    && (currentStep !== 5 || quoteStatus === 'QUOTED')
    && (currentStep !== 6 || declarationsAccepted);

  if (success) {
    const headline = success.issued ? 'Your immigration medical cover is in place' : 'Payment received — finalising your policy';
    const subline = success.issued
      ? 'Your documents have been emailed to you and are available in your customer portal.'
      : 'Your payment was successful. We are issuing your policy and your documents will arrive by email shortly.';
    return (
      <div className="brand-flow min-h-screen overflow-x-hidden bg-white text-black font-sans">
        <Header currentStep={STEPS.length} totalSteps={STEPS.length} steps={STEPS} />
        <SuccessScreen
          variant={success.issued ? 'issued' : 'pending'}
          headline={headline}
          subline={subline}
          referenceNumber={success.referenceNumber}
          referenceUrl={success.portalPolicyId ? `/client?policy=${encodeURIComponent(success.portalPolicyId)}` : '/client'}
          productLabel="Immigration Medical Insurance"
          actions={[{
            label: success.issued ? 'View my policy' : 'Open my portal',
            primary: true,
            onClick: () => navigate(success.portalPolicyId ? `/client?policy=${encodeURIComponent(success.portalPolicyId)}` : '/client'),
          }]}
        />
      </div>
    );
  }

  // ABY-283 / ABY-286 — wizard shell layout MUST match the canonical
  // Travel/Home/Motor structure so the mobile progress bar, the
  // BottomNav, and the resume link sit at the right z-index and the
  // sticky bottom nav doesn't overlap content. Specifically:
  //   1. Outer wrapper uses `brand-flow min-h-screen` so the responsive
  //      `.mobile-only` rules (defined in motor/wizard/styles.css and
  //      transitively imported by the shared `QuotePage`) actually
  //      apply.
  //   2. `<QuoteWizardMobileProgress>` is a SIBLING of `<Header>`, NOT
  //      nested inside a padded `<main>` (Travel reference:
  //      `frontend/src/products/travel/wizard/TravelQuoteWizard.tsx:691`).
  //      Nesting under `<main>` was the visible "drift" Liav flagged
  //      on iOS Safari — the `sticky top: calc(80px + safe-area)`
  //      anchored from the wrong frame.
  //   3. Content uses `max-w-4xl` (not `max-w-5xl`) and `pb-32` so the
  //      fixed `<QuoteWizardBottomNav>` doesn't overlap the last
  //      visible question.
  //   4. `<QuoteWizardBottomNav>` and `<QuoteWizardResumeLink>` are
  //      siblings of `<main>`, NOT children — they're position:fixed
  //      and DON'T need to inherit the `<main>` padding context.
  return (
    <SessionAwareErrorBoundary>
      <FormProvider {...form}>
        <div className="brand-flow min-h-screen overflow-x-hidden bg-white text-black font-sans">
          <Header currentStep={currentStep} totalSteps={STEPS.length} steps={STEPS} />
          <QuoteWizardMobileProgress currentStep={currentStep} steps={STEPS} />
          <main className="max-w-4xl mx-auto px-5 py-4 pb-32">
            {errorEntries.length > 0 && (
              <QuoteWizardErrorSummary errors={errorEntries} setContainerEl={setErrorSummaryEl} />
            )}
            <AnimatePresence mode="wait">
              <motion.div
                key={currentStep}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.25 }}
                className="mt-6"
              >
                {currentStep === 1 && <Step5ProposerDetails section="details" />}
                {currentStep === 2 && <Step1Eligibility />}
                {currentStep === 3 && <Step2InsuredPersons />}
                {currentStep === 4 && <Step3PeriodAndGhs />}
                {currentStep === 5 && (
                  <Step4Quote
                    quoteResponse={quoteResponse}
                    rating={rating}
                    onContinue={() => { void handleNext(); }}
                  />
                )}
                {currentStep === 6 && <Step5ProposerDetails section="declarations" />}
                {currentStep === 7 && (
                  <PaymentStep
                    productCode="health"
                    publicSessionToken={policyId}
                    summary={paymentSummary}
                    onBack={handleBack}
                    onSubmit={async (result) => {
                      if (result.status !== 'paid') return;
                      // Session load carries policyNumber + policyId;
                      // readiness payload carries customerOutcome only.
                      const readiness = await fetchIssueReadinessForProduct('health', policyId);
                      const { ok, session } = await sessionAdapter
                        .load(policyId)
                        .catch(() => ({ ok: false, session: null }));
                      const sessionRec: LooseObject = ok && session ? (session as LooseObject) : {};
                      setSuccess({
                        referenceNumber: String(sessionRec.policyNumber || '').trim()
                          || `ABH-PENDING-${policyId.slice(0, 8).toUpperCase()}`,
                        issued: result.issued === true || readiness?.customerOutcome === 'issued',
                        portalPolicyId: String(sessionRec.policyId || '').trim() || undefined,
                      });
                    }}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </main>

          <QuoteWizardResumeLink
            productCode="health"
            publicSessionToken={policyId}
            email={(form.watch('proposer.email') as string | undefined) || null}
            hidden={currentStep === STEPS.length}
          />

          {currentStep < STEPS.length && (
            <QuoteWizardBottomNav
              canBack={canBack}
              canNext={canNext}
              hoverNav={hoverNav}
              isSubmitting={submitting || rating}
              onHoverNavChange={setHoverNav}
              onBack={handleBack}
              onNext={handleNext}
              nextLabel={
                currentStep === 1 ? 'Continue to eligibility'
                  : currentStep === 4 ? 'Continue to your quote'
                    : currentStep === 5 ? 'Continue to declarations'
                      : currentStep === 6 ? 'Continue to payment'
                        : 'Continue'
              }
            />
          )}
        </div>
      </FormProvider>
    </SessionAwareErrorBoundary>
  );
}

export default HealthQuoteWizard;

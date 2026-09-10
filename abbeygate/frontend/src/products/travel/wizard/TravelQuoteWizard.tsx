import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FormProvider, useForm } from 'react-hook-form';
import { SessionAwareErrorBoundary } from '@/src/shared/app/SessionAwareErrorBoundary';
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
import {
  readClientSessionFlag,
  resolvePostPurchaseDashboardTarget,
} from '@/src/shared/lib/wizard/postPurchaseDashboardTarget';
import { fetchIssueReadinessForProduct } from '@/src/shared/lib/wizard/issueReadinessClient';
import { resolveQuoteFailureMessage } from '@/src/shared/lib/wizard/quoteFailureMessage';
import { applyValidationErrors, type FieldErrors, validateForContext } from '@facio/validation/frontend';
import { collectErrorEntries, dedupeErrorEntries } from '@/src/shared/lib/wizard/utils/errors';
import { replaceWizardStepInUrl } from '@/src/shared/lib/wizard/utils/replaceWizardUrl';
import { travelValidationProfile } from '@facio/products';
import { REGION_CONFIG } from '@/src/shared/config/region';
import { Step1YourTrip } from './components/steps/Step1YourTrip';
import { Step3TripDetails } from './components/steps/Step3TripDetails';
import { Step4PlanPicker } from './components/steps/Step4PlanPicker';
import { Step5Options } from './components/steps/Step5Options';
import { Step6DetailsAndDeclarations } from './components/steps/Step6DetailsAndDeclarations';
import { useTravelAddonAutoRate } from './useTravelAddonAutoRate';
import { readSelectedAddons } from './travelAddons';
import { asRecord } from '@/src/shared/lib/record';

// Steps 6 (Your details) and 7 (Declarations) are merged into a single
// Lloyd's-approved flow that includes Demands & Needs, Very Important Notice,
// personal details, contact preferences, Declaration, and pre-existing
// medical conditions notice.
// ABY-519 — eligibility + travellers share step 1 ("Your Trip") to match
// the legacy abbeygatetravel.com first-page journey layout.
const STEPS = ['Your Trip', 'Trip', 'Plans', 'Options', 'Your details', 'Payment'];

export const TRAVEL_QUOTE_CONTACT_FIELDS = [
  'proposer.firstName',
  'proposer.lastName',
  'proposer.email',
  'proposer.phone',
] as const;

/** 1-based wizard step number to validation-profile step id(s). */
const STEP_ID_BY_INDEX: Record<number, string> = {
  1: 'eligibility',
  2: 'trip',
  3: 'plans',
  4: 'options',
  5: 'your-details',
  6: 'payment',
};

/** Validation profile step ids validated when the customer clicks Continue. */
const VALIDATION_STEP_IDS_BY_WIZARD_STEP: Record<number, readonly string[]> = {
  1: ['eligibility', 'travellers'],
  2: ['trip'],
  3: ['plans'],
  4: ['options'],
  5: ['your-details'],
  6: ['payment'],
};

const sessionAdapter = createSessionAdapter({ productCode: 'travel' });

type FormValues = Record<string, unknown>;

function shouldMaterializeTravelContact(stepId: string | undefined): boolean {
  return stepId === 'trip' || stepId === 'your-details';
}

export function hasTravelQuoteContactErrors(errors: FieldErrors): boolean {
  return TRAVEL_QUOTE_CONTACT_FIELDS.some((path) => Boolean(errors[path]));
}

export function buildTravelRateInputFingerprint(values: FormValues): string {
  const eligibility = asRecord(values.eligibility);
  const travellers = asRecord(values.travellers);
  const trip = asRecord(values.trip);
  const risk = asRecord(values.risk);
  const quote = asRecord(values.quote);
  return JSON.stringify({
    eligibility: {
      countryOfResidence: eligibility.countryOfResidence,
      nationality: eligibility.nationality,
      hasOtherNationality: eligibility.hasOtherNationality,
      otherNationality: eligibility.otherNationality,
      willRemainResident: eligibility.willRemainResident,
      legallyPermittedToReside: eligibility.legallyPermittedToReside,
      informationAccurate: eligibility.informationAccurate,
    },
    travellers: {
      coverType: travellers.coverType,
      travellerCount: travellers.travellerCount,
      leadTravellerDOB: travellers.leadTravellerDOB,
      additionalTravellerDOBs: travellers.additionalTravellerDOBs,
    },
    trip: {
      planType: trip.planType,
      destinations: trip.destinations,
      startDate: trip.startDate,
      endDate: trip.endDate,
    },
    quote: {
      maxTripDays: quote.maxTripDays,
    },
    risk: {
      hasPreviousTravelClaim: risk.hasPreviousTravelClaim,
      previousTravelClaimBand: risk.previousTravelClaimBand,
    },
  });
}

export function isTravelRateResponseCurrent(submittedFingerprint: string, values: FormValues): boolean {
  return submittedFingerprint === buildTravelRateInputFingerprint(values);
}

const STEP_INDEX_BY_URL_STEP: Record<string, number> = {
  eligibility: 1,
  travellers: 1,
  trip: 2,
  plans: 3,
  options: 4,
  'your-details': 5,
  payment: 6,
  'thank-you': 6,
};

const DEFAULT_VALUES: FormValues = {
  // Lloyd's rules require no pre-selection on discretionary choices — the
  // applicant must make each selection deliberately. countryOfResidence is
  // pre-filled from the region config (it is a factual, not discretionary,
  // field and the operator has already scoped the product to that region).
  //
  // ADR-0025: `isExpat` is no longer asked of the customer — it is a
  // derived UW outcome. The wizard collects the seven objective answers
  // (nationality, hasOtherNationality, otherNationality, residenceDuration,
  // willRemainResident, residencyStatus, legallyPermittedToReside,
  // informationAccurate) and the server derives expat status from them.
  eligibility: {
    countryOfResidence: REGION_CONFIG.defaultCountry,
    nationality: '',
    hasOtherNationality: null,
    otherNationality: '',
    residenceDuration: '',
    willRemainResident: null,
    residencyStatus: '',
    legallyPermittedToReside: null,
    informationAccurate: false,
    legalAgreement: false,
  },
  travellers: { coverType: '', travellerCount: 1, leadTravellerDOB: '', additionalTravellerDOBs: [], additionalTravellers: [] },
  trip: { planType: '', destinations: [], startDate: '', endDate: '' },
  quote: { selectedPlan: '' },
  addons: { winterSports: false, businessCover: false, golfCover: false, terrorism: false, sportsEquipment: false, wedding: false, gadget: false },
  proposer: {
    firstName: '', lastName: '', email: '', confirmEmail: '', phone: '',
    idType: 'passport', idNumber: '',
    address: { line1: '', line2: '', city: '', province: '', postcode: '', country: REGION_CONFIG.defaultCountry },
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

export interface TravelQuoteWizardProps { policyId: string; }

/**
 * ABY-261 — payment-summary addon row label.
 *
 * The canonical addon catalogue in `travelAddons.ts` mixes labels that
 * already contain "Cover" (`Business Cover`, `Golf Cover`) with labels
 * that do not (`Gadget`, `Wedding`, `Winter Sports`, `Terrorism`,
 * `Sports / Cycle Equipment`). The payment summary wants every row to
 * read like "X cover" — so we only append " cover" when the source
 * label doesn't already carry the word, case-insensitively. The
 * previous unconditional template literal produced "Business Cover
 * cover" / "Golf Cover cover" on the customer-facing summary.
 */
export function formatTravelAddonCoverLabel(label: string): string {
  const base = String(label || '').trim();
  if (!base) return 'cover';
  return /\bcover\b/i.test(base) ? base : `${base} cover`;
}

/**
 * ABY-261 — wizard steps that require a re-rate before advancing.
 *
 * Re-rating on 3→4 and 4→5 handles initial plan comparison and plan-tier
 * confirmation. We deliberately do NOT re-rate on 5→6 or 6→7 here even
 * though Step 5 is where the customer toggles addons — wiring "rate when
 * the customer clicks Continue" was the wrong shape (the user has to
 * stare at a stale sidebar total the whole time they're on Step 5, then
 * see the number jump only after navigation). Addon-driven re-rates are
 * triggered by a dedicated `useEffect` watcher inside `TravelQuoteWizard`
 * that fires whenever `form.watch('addons')` changes (debounced ~300ms),
 * so the Step 5 sidebar always reflects the truth in real time.
 *
 * Billing-integrity safety net lives at the CardCorp boundary
 * (`backend/modules/payments/app/cardcorpCheckoutService.ts` →
 * `ratePolicyAndPersist`) which ALWAYS re-rates immediately before
 * creating the checkout, so even a wizard race can never charge the
 * customer a different number than they last saw.
 */
export const TRAVEL_WIZARD_STEPS_REQUIRING_RATE: ReadonlySet<number> = new Set([2, 3]);

export function canContinueTravelWizardStep(args: {
  currentStep: number;
  quoteStatus: string;
  selectedPlan: string;
}): boolean {
  const quoteStatus = String(args.quoteStatus || '').toUpperCase();
  if (args.currentStep === 6) return false;
  if (args.currentStep === 3) {
    if (quoteStatus === 'REFERRAL' || quoteStatus === 'DECLINED') return false;
    return quoteStatus === 'QUOTED' && Boolean(String(args.selectedPlan || '').trim());
  }
  return true;
}

function TravelQuoteWizard({ policyId }: TravelQuoteWizardProps) {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(() => {
    const stepParam = new URLSearchParams(window.location.search).get('step') || '';
    return STEP_INDEX_BY_URL_STEP[stepParam] || 1;
  });
  const [hoverNav, setHoverNav] = useState<'back' | 'next' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [rating, setRating] = useState(false);
  const [quoteResponse, setQuoteResponse] = useState<Record<string, unknown> | null>(null);
  const [success, setSuccess] = useState<{
    referenceNumber: string;
    issued: boolean;
    portalPolicyId?: string;
  } | null>(null);
  const errorSummaryRef = useRef<HTMLDivElement | null>(null);

  const form = useForm<FormValues>({ defaultValues: DEFAULT_VALUES, mode: 'onChange' });

  // ABY-261 follow-up — autosave-on-change parity with Home/Motor.
  //
  // Two preconditions guarded by these refs:
  //   1. `sessionHydratedRef` — autosave MUST NOT race the initial
  //      `form.reset(quoteData)` from the session-load effect. Without
  //      the gate the wizard would PATCH the server with the empty
  //      defaults the instant the form mounts, blowing away any
  //      already-persisted draft. We only flip the ref true after the
  //      load effect has reset the form with the loaded snapshot.
  //   2. `autosaveTimerRef` — the trailing-edge debounce handle. Always
  //      cleared on subsequent changes (so rapid typing collapses into
  //      one PATCH) and on unmount.
  const sessionHydratedRef = useRef<boolean>(false);
  const autosaveTimerRef = useRef<number | null>(null);
  const lastRatedInputFingerprintRef = useRef<string>('');

  useEffect(() => {
    (async () => {
      const { ok, session } = await sessionAdapter.load(policyId);
      if (!ok || !session) {
        // Even on load failure we mark the session as "hydrated" so a
        // fresh wizard (no server-side draft) can still autosave the
        // user's typing — the alternative is silently dropping their
        // input until they click Continue, which is the bug we're
        // fixing in the first place.
        sessionHydratedRef.current = true;
        return;
      }
      const snapshot = (session.snapshot && typeof session.snapshot === 'object')
        ? session.snapshot as Record<string, unknown>
        : {};
      const quoteData = snapshot.quoteData || session.quoteData;
      const storedQuoteResponse = snapshot.quoteResponse || session.quoteResponse;
      if (quoteData && typeof quoteData === 'object') form.reset(quoteData as FormValues);
      if (storedQuoteResponse && typeof storedQuoteResponse === 'object') {
        setQuoteResponse(asRecord(storedQuoteResponse));
        lastRatedInputFingerprintRef.current = buildTravelRateInputFingerprint(form.getValues());
      }
      // Open the autosave gate AFTER reset so the very first form.watch
      // emit caused by `form.reset` cannot trigger a PATCH back with the
      // values we just loaded.
      sessionHydratedRef.current = true;
      const urlStep = new URLSearchParams(window.location.search).get('step') || '';
      if (urlStep === 'thank-you') {
        const readiness = await fetchIssueReadinessForProduct('travel', policyId);
        const paid = readiness?.derived?.hasPaymentConfirmed === true || readiness?.customerOutcome === 'issued';
        if (paid) {
          setSuccess({
            referenceNumber: String(session.policyNumber || '').trim() || `ABV-PENDING-${policyId.slice(0, 8).toUpperCase()}`,
            issued: session.issued === true || readiness?.customerOutcome === 'issued',
            portalPolicyId: String(session.policyId || '').trim() || undefined,
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

  useEffect(() => {
    if (!success) return;
    const keepThankYouUrl = () => {
      replaceWizardStepInUrl('thank-you', { deleteParams: ['ref'], state: window.history.state });
    };
    keepThankYouUrl();
    window.addEventListener('popstate', keepThankYouUrl);
    return () => window.removeEventListener('popstate', keepThankYouUrl);
  }, [success]);

  const saveDraft = useCallback(async () => {
    const stepId = STEP_ID_BY_INDEX[currentStep];
    await sessionAdapter.patch(policyId, {
      quoteData: form.getValues(),
      step: stepId,
      materializeAccount: shouldMaterializeTravelContact(stepId),
    });
  }, [currentStep, policyId, form]);

  // ABY-261 follow-up — debounced autosave-on-change.
  //
  // Until now the wizard only persisted via Continue / Back / runRate.
  // A page refresh between Continues lost every keystroke since the
  // last button click, which Home and Motor already mitigate with a
  // 300ms autosave-on-change. This brings Travel to parity using the
  // SAME shape (`form.watch((all, info) => …)` + trailing-edge
  // debounce + PATCH-only — no re-rate from this path), so the three
  // wizards now have one persistence contract.
  //
  // Skipped on the payment step (id 7) and on the post-success state:
  //   - Step 7 is locked once CardCorp checkout is created; PATCHing
  //     `quoteData` after lock is rejected by the server and is a UX
  //     dead-end ("our changes aren't saving").
  //   - After `success` is set, the wizard is rendering the thank-you
  //     screen; the form is no longer authoritative.
  //
  // We always PATCH, never rate, from here. The Continue path still
  // owns rating decisions, and the addon-watcher hook above still owns
  // live re-rates on Step 5. This effect's only job is to make sure
  // typed/selected data survives a refresh.
  useEffect(() => {
    if (!policyId) return;
    if (success) return;
    const stepId = STEP_ID_BY_INDEX[currentStep];
    if (!stepId || stepId === 'payment') return;

    const scheduleAutosave = () => {
      if (autosaveTimerRef.current !== null) {
        window.clearTimeout(autosaveTimerRef.current);
      }
      autosaveTimerRef.current = window.setTimeout(() => {
        if (!sessionHydratedRef.current) return;
        void sessionAdapter
          .patch(policyId, {
            quoteData: form.getValues(),
            step: stepId,
            materializeAccount: shouldMaterializeTravelContact(stepId),
          })
          .catch(() => undefined);
      }, 300);
    };

    const subscription = form.watch((_all, info) => {
      const eventType = String(info?.type || '');
      if (eventType !== 'change' && eventType !== 'blur' && eventType !== '') return;
      const nextFingerprint = buildTravelRateInputFingerprint(form.getValues());
      if (
        quoteResponse &&
        lastRatedInputFingerprintRef.current &&
        nextFingerprint !== lastRatedInputFingerprintRef.current
      ) {
        setQuoteResponse(null);
        lastRatedInputFingerprintRef.current = '';
      }
      scheduleAutosave();
    });

    return () => {
      subscription.unsubscribe();
      if (autosaveTimerRef.current !== null) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [currentStep, form, policyId, quoteResponse, success]);

  const runRate = useCallback(async (): Promise<boolean> => {
    // SPINE: same `validateForContext({ stage: 'quote' })` the backend
    // generic rate router calls (see `backend/modules/quotes/http/
    // genericPublicQuoteRouter.ts.router.post('/:token/rate')`). Per
    // validation.md the per-product `ValidationProfile.stages.quote`
    // is the single source of truth for "is this rateable" — the
    // wizard runs the SAME canonical contract before the API call.
    const rateReadyErrors = validateForContext({
      productCode: 'TRAVEL',
      stage: { kind: 'stage', id: 'quote' },
      actor: 'customer',
      data: form.getValues() as Record<string, unknown>,
    });
    if (Object.keys(rateReadyErrors).length > 0) {
      applyValidationErrors(form as never, rateReadyErrors);
      if (hasTravelQuoteContactErrors(rateReadyErrors)) {
        setCurrentStep(STEP_INDEX_BY_URL_STEP.trip);
      }
      try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch { /* ignore */ }
      return false;
    }

    setRating(true);
    const submittedFingerprint = buildTravelRateInputFingerprint(form.getValues());
    try {
      await saveDraft();
      const result = await sessionAdapter.rate(policyId);
      if (result.ok && result.quoteResponse) {
        if (!isTravelRateResponseCurrent(submittedFingerprint, form.getValues())) {
          setQuoteResponse(null);
          lastRatedInputFingerprintRef.current = '';
          return false;
        }
        lastRatedInputFingerprintRef.current = submittedFingerprint;
        setQuoteResponse(asRecord(result.quoteResponse));
      }
      if (!result.ok) {
        window.alert(resolveQuoteFailureMessage({
          errorCode: result.errorCode,
          error: result.error,
          genericFallback: 'We could not calculate your quote at this time. Please check your details and try again.',
        }));
      }
      return result.ok;
    } finally { setRating(false); }
  }, [policyId, saveDraft, form]);

  // ABY-261 — addon toggles re-rate live (debounced 300ms). The hook
  // is dedicated so the contract — and the RHF ref-stability foot-gun
  // that caused the first attempt to silently no-op — can be locked
  // by a focused regression test (`useTravelAddonAutoRate.test.tsx`).
  // The wizard owns the RHF subscription (`form.watch('addons')` here);
  // `readSelectedAddons` projects that loosely-typed value into the
  // canonical `TravelAddonSelection` shape so the hook gets real types
  // (and any historic snapshot that's missing a newly-added addon key
  // gets defaulted to `false`, no schema migration needed).
  const addonsForRate = readSelectedAddons(form.watch('addons'));
  useTravelAddonAutoRate({ addons: addonsForRate, quoteResponse, runRate });

  // ABY-166 — always fire-and-forget saveDraft on back so the server
  // always holds the latest form values before the user navigates away.
  // Without this a page reload after clicking Back could restore stale
  // server data (e.g. missing trip or traveller fields).
  const handleBack = useCallback(() => {
    void saveDraft();
    setCurrentStep((s) => Math.max(1, s - 1));
  }, [saveDraft]);

  // ABY-40: scroll the page to the top whenever the user transitions
  // between wizard steps. Without this the new step rendered with
  // the previous step's bottom in view, leaving the user staring at
  // the bottom of the new form rather than its first field.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
  }, [currentStep]);

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
        try {
          focusable.focus({ preventScroll: true });
        } catch {
          // ignore
        }
      }, 160);
    }
    return true;
  }, []);

  const handleNext = useCallback(async () => {
    setSubmitting(true);
    try {
      const validationStepIds = VALIDATION_STEP_IDS_BY_WIZARD_STEP[currentStep] || [];
      if (validationStepIds.length > 0) {
        const errors = validationStepIds.reduce<Record<string, string>>((acc, stepId) => {
          const stepErrors = validateForContext({
            productCode: 'TRAVEL',
            stage: { kind: 'wizardStep', id: stepId },
            actor: 'customer',
            data: form.getValues(),
          });
          return { ...acc, ...stepErrors };
        }, {});
        if (Object.keys(errors).length > 0) {
          applyValidationErrors(form, errors);
          // Scroll the error summary into view so the user sees what's wrong.
          window.setTimeout(() => {
            errorSummaryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            errorSummaryRef.current?.focus();
          }, 60);
          return;
        }
        // Validation passed — clear any stale errors left from a previous
        // failed "Continue" attempt (e.g. the "Plan required" banner after
        // a user clicks "Continue" before selecting a plan, then selects one).
        form.clearErrors();
      }
      await saveDraft();
      // Rate on step 3→4 (initial plan comparison) and 4→5 (plan confirmed;
      // re-rate so `addonPrices` (ABY-272) reflect the selected plan tier).
      // ABY-166 — do NOT advance if rate failed; runRate now returns false
      // on error so the user stays on the current step rather than landing
      // on the plans page with no plans showing.
      //
      // Addon-driven rates are handled by the dedicated `addonsKey`
      // useEffect above so the Step 5 sidebar updates live as the
      // customer toggles, not when they click Continue. CardCorp billing
      // integrity is enforced at the checkout boundary, not here.
      if (TRAVEL_WIZARD_STEPS_REQUIRING_RATE.has(currentStep)) {
        const rateOk = await runRate();
        if (!rateOk) return;
      }
      setCurrentStep((s) => Math.min(STEPS.length, s + 1));
    } finally { setSubmitting(false); }
  }, [currentStep, form, runRate, saveDraft]);

  // Keep the watched value subscribed so RHF re-renders the wizard when
  // the customer toggles an addon on Step 5 (otherwise the Step 5 sidebar
  // total wouldn't update). The actual read inside `paymentSummary`
  // intentionally goes through `form.getValues('addons')` — see ABY-250
  // note below.
  const addonFormValues = form.watch('addons');

  const paymentSummary = useMemo(() => {
    const primary = (quoteResponse?.primaryOption || {}) as Record<string, unknown>;
    const breakdown = (primary?.breakdown || {}) as Record<string, unknown>;

    // ABY-264 — consume the canonical `breakdown.lines` produced by the
    // travel calculator (`TravelBreakdown.lines`) as the single source
    // of truth for every premium-breakdown surface (wizard sidebar,
    // payment-step summary, BO Premium tab, PDF schedule). The lines
    // are pre-ordered base → addons (catalogue order) → tax → admin
    // fee → total, with zero-amount lines already omitted. Labels are
    // canonical (no per-surface formatting), so the customer sees the
    // same words and the same admin-fee line on every step the way
    // the client requested.
    //
    // The previous shape reconstructed the breakdown locally from
    // `breakdown.addonBreakdown` + `breakdown.basePremium/iptAmount/
    // adminFee`, which is the drift surface that produced ABY-264 (the
    // admin fee surfaced on the payment step only — every other step
    // saw the "Plan price" baked-in number and customers misread it).
    // `addonFormValues` and `currentStep` stay in the memo deps so the
    // summary refreshes when the customer toggles addons or navigates
    // between steps (RHF watch wiring is preserved by the `void`s).
    void addonFormValues;
    void currentStep;
    void form;

    const totalAmount = Number(primary.annualPremium || 0);
    // The `total` line is rendered separately as the summary's `amount`.
    // Narrow each line through the shared `asRecord` helper rather
    // than casting the array to a broad map at the boundary (the
    // `no-new-any` diff ratchet enforces narrowing through
    // `@/src/shared/lib/record`).
    const rawLines = Array.isArray(breakdown.lines) ? breakdown.lines : [];
    const displayLines = rawLines
      .map((line) => asRecord(line))
      .filter((line) => String(line.code || '') !== 'total')
      .map((line) => ({
        label: String(line.label || ''),
        amount: Number(line.amount || 0),
      }));

    return {
      amount: totalAmount,
      currency: 'EUR',
      breakdownLines: displayLines,
    };
  }, [quoteResponse, addonFormValues, form, currentStep]);

  const handlePaymentComplete = useCallback(async (result: { status: 'paid' | 'failed'; issued?: boolean }) => {
    if (result.status !== 'paid') return;
    // ABY-42: fetch the canonical post-payment session summary so we
    // can show the customer-facing `policyNumber` (ABOLV-/ABQ-XXXX)
    // instead of the opaque `publicSessionToken`, and gate the
    // "issued / docs emailed" copy on the actual server-side issuance
    // flag rather than payment alone.
    let referenceNumber = '';
    let issued = result.issued === true;
    try {
      const { ok, session } = await sessionAdapter.load(policyId);
      if (ok && session) {
        referenceNumber = String((session as Record<string, unknown>).policyNumber || '').trim();
        if (typeof (session as Record<string, unknown>).issued === 'boolean') {
          issued = Boolean((session as Record<string, unknown>).issued);
        }
      }
    } catch {
      // ignore — fallback below ensures we still surface SOMETHING
    }
    if (!referenceNumber) {
      // We never want to show the raw publicSessionToken to the
      // customer; if no business id is available yet, surface a
      // truncated, prefixed pseudo-reference until the worker
      // assigns the canonical one. Operators can find the policy
      // in BO via the publicSessionToken if needed.
      referenceNumber = `ABV-PENDING-${policyId.slice(0, 8).toUpperCase()}`;
    }
    // ABY-43: replace the history entry so hitting Back from the
    // "thank you" page does NOT bring the user back to the payment
    // step's intermediate loading state. The wizard route is the
    // same; we only swap the query so the wizard re-mounts to a
    // fresh state if the user navigates back.
    try {
      replaceWizardStepInUrl('thank-you', { deleteParams: ['ref'], state: window.history.state });
    } catch {
      // ignore — non-blocking UX nicety
    }
    const { ok, session } = await sessionAdapter.load(policyId).catch(() => ({ ok: false, session: null }));
    setSuccess({
      referenceNumber,
      issued,
      portalPolicyId: ok && session ? String(session.policyId || '').trim() || undefined : undefined,
    });
  }, [policyId]);

  const stepNode = useMemo(() => {
    switch (currentStep) {
      case 1: return <Step1YourTrip />;
      case 2: return <Step3TripDetails />;
      case 3: return (
        <Step4PlanPicker
          loading={rating}
          quoteResponse={quoteResponse}
          onRate={runRate}
          onSelectPlan={() => { void handleNext(); }}
        />
      );
      case 4: return <Step5Options quoteResponse={quoteResponse} />;
      case 5: return (
        <Step6DetailsAndDeclarations
          quoteResponse={quoteResponse}
          onSave={saveDraft}
        />
      );
      case 6: return (
        <PaymentStep
          productCode="travel"
          publicSessionToken={policyId}
          summary={paymentSummary}
          onBack={() => setCurrentStep(5)}
          onSubmit={handlePaymentComplete}
        />
      );
      default: return null;
    }
  }, [currentStep, rating, quoteResponse, runRate, policyId, paymentSummary, handlePaymentComplete, handleNext, saveDraft]);

  const quoteStatus = String((quoteResponse?.status ?? '')).toUpperCase();
  const selectedPlan = String(form.watch('quote.selectedPlan') || '').trim();

  // When the quote is referred or declined the plan picker has nothing to
  // select — clear any stale 'quote.selectedPlan' validation error so the
  // error summary banner does not confuse users with an unactionable message.
  useEffect(() => {
    if (quoteStatus === 'REFERRAL' || quoteStatus === 'DECLINED') {
      form.clearErrors('quote.selectedPlan');
    }
  }, [quoteStatus, form]);

  if (success) {
    // ABY-42: when issuance is still in flight, do NOT claim the docs
    // were emailed (the worker has not finished). Surface a pending
    // state so the customer knows the policy is being prepared and
    // the email is on its way, instead of the previous "your
    // documents have been emailed" claim that was a lie when the
    // worker was still running (or had failed silently).
    const headline = success.issued ? 'Your trip is covered' : 'Payment received \u2014 finalising your policy';
    const subline = success.issued
      ? 'Your documents have been emailed to you and are available in your customer portal.'
      : 'Your payment was successful. We are issuing your policy and your documents will arrive by email shortly. You can also track them in your customer portal.';
    return (
      <div className="brand-flow min-h-screen overflow-x-hidden bg-white text-black font-sans">
        <Header currentStep={STEPS.length} totalSteps={STEPS.length} steps={STEPS} />
        <SuccessScreen
          variant={success.issued ? 'issued' : 'pending'}
          headline={headline}
          subline={subline}
          referenceNumber={success.referenceNumber}
          referenceUrl={success.portalPolicyId ? `/client?policy=${encodeURIComponent(success.portalPolicyId)}` : '/client'}
          productLabel="trip"
          actions={[{
            label: 'Go to my portal',
            primary: true,
            onClick: () => {
              // ABY-238 — canonical three-way redirect via shared
              // helper. Travel previously skipped the OTP branch and
              // sent unauthenticated customers straight to signup,
              // which left the policy unlinked because the backend
              // signup route never consumed the claimToken.
              const proposerEmail = String(
                ((form.getValues().proposer || {}) as Record<string, unknown>).email || '',
              ).trim();
              const clientPath = success.portalPolicyId
                ? `/client?policy=${encodeURIComponent(success.portalPolicyId)}`
                : '/client';
              const hasSession = readClientSessionFlag();
              if (hasSession) { navigate(clientPath); return; }
              window.location.href = resolvePostPurchaseDashboardTarget({
                hasSession: false,
                email: proposerEmail,
                policyId,
                clientPath,
              });
            },
          }]}
        />
      </div>
    );
  }

  const canBack = currentStep > 1;
  const canNext = canContinueTravelWizardStep({ currentStep, quoteStatus, selectedPlan });
  const nextLabel = currentStep === 2 ? 'See my plans' : currentStep === 5 ? 'Continue to payment' : 'Continue';

  const showProductTitle = currentStep !== 3 && currentStep !== 6;

  // Derive a flat, deduplicated list of errors from RHF state so the shared
  // QuoteWizardErrorSummary banner can display them. Labels come from the
  // centralized travel validation profile — no per-step label duplication.
  const errorEntries = dedupeErrorEntries(
    collectErrorEntries(form.formState.errors as Record<string, unknown>),
  ).map(({ field, message }) => ({
    path: field,
    label:
      travelValidationProfile.fields[field]?.label ??
      field.split('.').at(-1)?.replace(/([A-Z])/g, ' $1').trim() ??
      field,
    message,
    onFocus: () => {
      void scrollToField(field);
    },
  }));

  return (
    <FormProvider {...form}>
      <div className="brand-flow min-h-screen overflow-x-hidden bg-white text-black font-sans">
        <Header currentStep={currentStep} totalSteps={STEPS.length} steps={STEPS} />
        <QuoteWizardMobileProgress currentStep={currentStep} steps={STEPS} />
        {showProductTitle && (
          <div className="mx-auto max-w-4xl px-5 mb-5 mt-6">
            <h1 className="text-3xl font-semibold mb-1 tracking-tight">
              Get your travel insurance quote
            </h1>
            <p className="text-lg text-gray-600">The way insurance should be</p>
          </div>
        )}
        <div className="max-w-4xl mx-auto px-5 py-4 pb-32">
          {/* Error summary — shown after "Continue" is clicked with missing fields.
              Centrally rendered here so no step component needs to repeat this logic. */}
          <div ref={errorSummaryRef} tabIndex={-1} className="outline-none mb-4">
            <QuoteWizardErrorSummary errors={errorEntries} />
          </div>
          <AnimatePresence mode="wait">
            <motion.div
              key={currentStep}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
            >
              {stepNode}
            </motion.div>
          </AnimatePresence>
        </div>
        <QuoteWizardResumeLink
          productCode="travel"
          publicSessionToken={policyId}
          email={(form.watch('proposer.email') as string | undefined) || null}
          step={currentStep}
          hidden={currentStep === 6}
        />
        <QuoteWizardBottomNav
          canBack={canBack}
          canNext={canNext}
          hoverNav={hoverNav}
          isSubmitting={submitting || rating}
          onHoverNavChange={setHoverNav}
          onBack={handleBack}
          onNext={handleNext}
          nextLabel={nextLabel}
          hidden={currentStep === 6}
        />
      </div>
    </FormProvider>
  );
}

export default function TravelQuoteWizardWithBoundary({ policyId }: TravelQuoteWizardProps) {
  return (
    <SessionAwareErrorBoundary>
      <TravelQuoteWizard policyId={policyId} />
    </SessionAwareErrorBoundary>
  );
}

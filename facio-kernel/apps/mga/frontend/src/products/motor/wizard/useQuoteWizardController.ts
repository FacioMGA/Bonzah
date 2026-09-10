import { useCallback, useRef, useState } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import type { QuoteData, QuoteResponse } from './types';
import { ageFromDateOfBirth, issueFieldKeyFromSlug, validateDriverDraft } from './validation/driverValidation';
import { questionnaireToPolicy, questionnaireToRating } from './questionnaireProjection';
import { indexToStepId } from './quoteWizard.constants';
import { asRecord, extractConditionalRequirements, extractMissingIssuedFields, serializeQuoteInputs, type ConditionalRequirement, type MissingIssuedField } from './quoteWizard.domain';
import { forkPublicSession, getPublicSessionSummary, MOTOR_PUBLIC_PRODUCT_CODE, patchPublicSessionQuoteData, rateQuote as callRateQuoteApi, requestPublicQuoteCallback, unlockPublicSession } from './quoteWizard.api';
import { fetchIssueReadinessRaw } from '@/src/shared/lib/wizard/issueReadinessClient';
import { applyWizardStepErrors, validateWizardStep } from './wizardStepValidation';
import { QUOTE_LOADER_MIN_DELAY_MS } from '@/src/shared/lib/wizard/quote/QuoteLoadingGate';
import { applyValidationErrors, validateForContext } from '@facio/validation/frontend';
import { resolveQuoteFailureMessage } from '@/src/shared/lib/wizard/quoteFailureMessage';

type WizardDispatchEvent =
  | { type: 'NAV.NEXT' }
  | { type: 'NAV.BACK' }
  | { type: 'NAV.GOTO'; stepId: string }
  | { type: 'ENGINE.CONTEXT_PATCH'; patch: Record<string, unknown> };

type WizardDispatch = (event: WizardDispatchEvent) => void;

type Args = {
  policyId?: string;
  currentStep: number;
  currentStepId: string;
  dispatchEngine: WizardDispatch;
  form: UseFormReturn<QuoteData>;
  data: QuoteData;
  quoteResponse: QuoteResponse | null;
  normalizeQuoteResponse: (raw: unknown) => QuoteResponse | null;
  quoteBaselineSnapshot: string;
  setQuoteBaselineSnapshot: (next: string) => void;
  scrollToTop: (behavior?: ScrollBehavior) => void;
  scrollToField: (fieldKey: string) => boolean;
  errorSummaryEl: HTMLDivElement | null;
  setQuoteResponse: (next: QuoteResponse | null) => void;
};

export function useQuoteWizardController(args: Args) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [missingIssuedFields, setMissingIssuedFields] = useState<MissingIssuedField[]>([]);
  const [conditionalRequirements, setConditionalRequirements] = useState<ConditionalRequirement[]>([]);
  const [checkingIssueReadiness, setCheckingIssueReadiness] = useState(false);
  const [savingIssueDetails, setSavingIssueDetails] = useState(false);
  // ABY-237 — synchronous in-flight latch. The `savingIssueDetails`
  // state is what disables the bottom-nav button, but React state
  // updates aren't synchronous: two rapid clicks can both observe
  // `savingIssueDetails === false` from their closures and both
  // proceed to fire network. This ref flips synchronously inside
  // the handler so the second click no-ops immediately.
  const savingIssueDetailsRef = useRef(false);
  // Capture structured rate failures so onNext can render a customer-safe
  // referral message for compliance codes (e.g. SANCTION_SCREENING_BLOCKED)
  // rather than the generic "we could not calculate your quote" alert.
  // Refs because they're written and read in the same call without rerender.
  const rateFailureCodeRef = useRef<string | null>(null);
  const rateFailureMessageRef = useRef<string | null>(null);
  const [terminal, setTerminal] = useState<{ variant: 'issued' | 'pending' | 'payment_failed'; reference: string } | null>(null);
  const [showEditWarning, setShowEditWarning] = useState(false);
  const [pendingEditStep, setPendingEditStep] = useState<number | null>(null);
  const [editQuoteFlowActive, setEditQuoteFlowActive] = useState(false);
  const [unlockingForEdit, setUnlockingForEdit] = useState(false);

  const validateCurrentStep = useCallback(() => {
    const stepErrors = validateWizardStep(args.currentStep, args.form.getValues());
    applyWizardStepErrors(args.form, stepErrors);
    const entries = Object.entries(stepErrors).map(([field, message]) => ({ field, message }));
    if (entries.length === 0) return true;
    // ABY-50: ALWAYS try to scroll to the first errored field (even
    // when many fail). Previously we only scrolled when exactly one
    // error existed, so a multi-error step left the user staring at
    // the bottom of the page with a generic "Invalid input" toast and
    // no visible field highlight in the viewport.
    const firstField = entries[0].field;
    const scrolled = args.scrollToField(firstField);
    if (entries.length > 1 || !scrolled) {
      // Surface the inline error summary at the top of the form so
      // the user can see all failures at once. If a field was
      // successfully scrolled to we still focus the summary for
      // screen-reader announcement on the next tick.
      if (!scrolled) args.scrollToTop();
      window.setTimeout(() => {
        try {
          args.errorSummaryEl?.focus();
        } catch {
          // ignore
        }
      }, 120);
    }
    return false;
  }, [args]);

  const rateQuote = useCallback(async () => {
    if (!args.policyId) return false;
    const data = args.form.getValues();

    // SPINE: same `validateForContext({ stage: 'quote' })` the backend
    // rate API calls (see `backend/modules/quotes/app/validatorImpl.ts`).
    // No parallel zod tree, no banner: every missing-field surfaces as
    // a per-field RHF error at the SAME path the rate API would have
    // rejected. The existing `QuoteWizardErrorSummary` is the only
    // display channel — clicking a row scrolls to and focuses the
    // offending field. Drift between the wizard's "ready" state and the
    // rate-API contract is impossible by construction (the contract
    // test in `packages/products/src/motor/__tests__/quote-readiness.
    // contract.test.ts` proves it).
    const rateReadyErrors = validateForContext({
      productCode: 'MOTOR',
      stage: { kind: 'stage', id: 'quote' },
      actor: 'customer',
      // QuoteData is a discriminated motor-specific shape; the runner
      // only needs an open-shape record for path traversal. The shared
      // `asRecord` helper widens at runtime without weakening the local
      // QuoteData type.
      data: asRecord(data),
    });
    if (Object.keys(rateReadyErrors).length > 0) {
      applyValidationErrors(args.form as never, rateReadyErrors);
      const firstField = Object.keys(rateReadyErrors)[0];
      if (firstField) {
        const scrolled = args.scrollToField(firstField);
        if (!scrolled) args.scrollToTop();
      } else {
        args.scrollToTop();
      }
      return false;
    }

    const result = await callRateQuoteApi(args.policyId, questionnaireToRating(data).quoteData);
    const json = result.json;
    if (!result.ok || !json?.success) {
      // Capture the structured error so onNext can render a customer-safe
      // message for compliance codes (SANCTION_SCREENING_BLOCKED) instead
      // of the generic "we could not calculate your quote" alert.
      const errRecord = asRecord(asRecord(json).error);
      rateFailureCodeRef.current = typeof errRecord.code === 'string' ? errRecord.code : null;
      rateFailureMessageRef.current = typeof errRecord.message === 'string' ? errRecord.message : null;
      return false;
    }
    rateFailureCodeRef.current = null;
    rateFailureMessageRef.current = null;
    const normalized = args.normalizeQuoteResponse(json.data);
    if (!normalized) return false;
    args.setQuoteResponse(normalized);
    args.dispatchEngine({ type: 'ENGINE.CONTEXT_PATCH', patch: { quoteReady: true } });
    return true;
  }, [args]);

  // Returns `{ ok, status }` so callers can detect specific failures
  // (e.g. 429 throttling on the issue-details save loop — ABY-237).
  // The boolean union of `ok && json.success` matches the previous
  // contract; callers that don't care about status keep using `.ok`.
  const saveDraft = useCallback(async (): Promise<{ ok: boolean; status: number }> => {
    if (!args.policyId) return { ok: false, status: 0 };
    let result = await patchPublicSessionQuoteData({
      policyId: args.policyId,
      quoteData: questionnaireToPolicy(args.form.getValues()).quoteData,
      step: args.currentStepId,
    });
    if (result.status === 423) {
      const unlockResult = await unlockPublicSession(args.policyId);
      if (unlockResult.ok && unlockResult.json?.success) {
        result = await patchPublicSessionQuoteData({
          policyId: args.policyId,
          quoteData: questionnaireToPolicy(args.form.getValues()).quoteData,
          step: args.currentStepId,
        });
      }
    }
    const ok = Boolean(result.ok && result.json?.success);
    return { ok, status: result.status };
  }, [args]);

  const forkAndRateToNewSession = useCallback(async () => {
    if (!args.policyId) return false;
    const draftSaved = await saveDraft();
    if (!draftSaved.ok) return false;

    const forkResult = await forkPublicSession(args.policyId);
    const forkJson = asRecord(forkResult.json);
    if (!forkResult.ok || !forkJson.success) {
      if (forkResult.status === 429) {
        window.alert(
          'You have reached the maximum number of quote variations (5 in 24 hours). ' +
          'Please use your existing quote or contact us to continue.'
        );
      }
      return false;
    }
    const forkData = asRecord(forkJson.data);
    const nextPublicId = String(
      forkData.publicSessionToken || forkData.reference || forkData.policyId || ''
    ).trim();
    if (!nextPublicId) return false;

    const rateResult = await callRateQuoteApi(nextPublicId, questionnaireToRating(args.form.getValues()).quoteData);
    if (!rateResult.ok || !rateResult.json?.success) return false;

    const url = new URL(window.location.href);
    const params = new URLSearchParams(url.search);
    params.set('step', 'your-quote');
    window.location.href = `/quote/${encodeURIComponent(nextPublicId)}?${params.toString()}`;
    return true;
  }, [args, saveDraft]);

  const runIssueReadinessGate = useCallback(async () => {
    if (!args.policyId) return true;
    setCheckingIssueReadiness(true);
    try {
      // Canonical issue-readiness fetch (canonical-ownership.md
      // "Issue-readiness HTTP" row). Motor extracts missing fields +
      // conditional requirements from the raw envelope; PaymentStep
      // consumes the normalised payload via the same module.
      const result = await fetchIssueReadinessRaw(MOTOR_PUBLIC_PRODUCT_CODE, args.policyId);
      const json = result.json;
      if (!result.ok || !json?.success) return true;
      const missing = extractMissingIssuedFields(json?.data);
      const conditional = extractConditionalRequirements(json?.data);
      setMissingIssuedFields(missing);
      setConditionalRequirements(conditional);
      args.dispatchEngine({
        type: 'ENGINE.CONTEXT_PATCH',
        patch: { issueReadinessBlocked: missing.length > 0 || conditional.length > 0 },
      });
      return missing.length === 0 && conditional.length === 0;
    } finally {
      setCheckingIssueReadiness(false);
    }
  }, [args]);

  // Payment-step entry guard (ABY-344). The linear `your-quote` gate in
  // `onNext` already routes a not-ready quote to `issue-details`, but the
  // payment step can be reached WITHOUT passing through it: a
  // `?step=payment` deep link / resume link / page refresh dispatches
  // `NAV.GOTO` (which bypasses the flow guards), and the `your-quote`
  // gate itself fails open when the readiness probe errors (e.g. a 429
  // under rapid retries). In either case the customer lands on payment,
  // auto-creates a checkout, and dead-ends on the backend
  // `ISSUE_READINESS_BLOCKED` 422 — the "small hiccup" with no way
  // forward. Re-run the SAME canonical issue-readiness gate on payment
  // entry and bounce back to `issue-details` (with the missing fields
  // already populated for Step5IssueDetails) when it is not clear, so the
  // customer can finish the outstanding fields instead of hitting an
  // unrecoverable checkout error. Fails open exactly like the gate it
  // reuses, so a flaky probe never traps a ready customer off payment.
  const guardPaymentEntry = useCallback(async (): Promise<boolean> => {
    const clear = await runIssueReadinessGate();
    if (!clear) {
      args.dispatchEngine({ type: 'NAV.GOTO', stepId: 'issue-details' });
      return false;
    }
    return true;
  }, [args, runIssueReadinessGate]);

  const onNext = useCallback(async () => {
    if (!validateCurrentStep()) return;
    if (args.currentStep === 3) {
      setIsSubmitting(true);
      const startedAt = Date.now();
      const saved = await saveDraft();
      if (!saved.ok) {
        setIsSubmitting(false);
        window.alert('We could not save your updates. Please try again.');
        return;
      }
      const currentSnapshot = serializeQuoteInputs(args.form.getValues());
      const dataChangedAfterEdit = Boolean(editQuoteFlowActive && args.quoteBaselineSnapshot && currentSnapshot !== args.quoteBaselineSnapshot);
      // Fork path: forkAndRateToNewSession handles its own specific error messages
      // (e.g. rate-limit 429). Rate path: generic error alert on failure.
      const ok = dataChangedAfterEdit ? await forkAndRateToNewSession() : await rateQuote();
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs < QUOTE_LOADER_MIN_DELAY_MS) {
        await new Promise((resolve) => window.setTimeout(resolve, QUOTE_LOADER_MIN_DELAY_MS - elapsedMs));
      }
      setIsSubmitting(false);
      if (!ok) {
        // Fork failures already show a specific message inside forkAndRateToNewSession.
        if (!dataChangedAfterEdit) {
          window.alert(resolveQuoteFailureMessage({
            errorCode: rateFailureCodeRef.current,
            error: rateFailureMessageRef.current,
            genericFallback: 'We could not calculate your quote at this time.',
          }));
        }
        return;
      }
      if (dataChangedAfterEdit) return;
      setEditQuoteFlowActive(false);
      args.dispatchEngine({ type: 'NAV.NEXT' });
      return;
    }
    if (args.currentStep === 4) {
      const readinessClear = await runIssueReadinessGate();
      if (!readinessClear) {
        args.dispatchEngine({ type: 'NAV.GOTO', stepId: 'issue-details' });
        return;
      }
      const values = args.form.getValues();
      // ABY-232: named-drivers collection is only meaningful when the
      // coverage restriction is NAMED_DRIVERS. For POLICYHOLDER_ONLY
      // and the two open modes the named-drivers list must stay empty
      // and we must not detour into the issue-details collection step.
      const inNamedMode =
        values.driverRestriction === 'NAMED_DRIVERS' ||
        values.driverRestriction === undefined ||
        values.driverRestriction === null;
      const hasAdditionalDrivers =
        inNamedMode && (
          values.hasAdditionalDrivers === true ||
          (Array.isArray(values.additionalDrivers) && values.additionalDrivers.length > 0)
        );
      if (hasAdditionalDrivers) {
        args.dispatchEngine({ type: 'NAV.GOTO', stepId: 'issue-details' });
        return;
      }
      args.dispatchEngine({ type: 'NAV.NEXT' });
      return;
    }
    if (args.currentStep === 1 || args.currentStep === 2) {
      const saved = await saveDraft();
      if (!saved.ok) {
        window.alert('We could not save your updates. Please try again.');
        return;
      }
    }
    args.dispatchEngine({ type: 'NAV.NEXT' });
  }, [args, editQuoteFlowActive, forkAndRateToNewSession, rateQuote, runIssueReadinessGate, saveDraft, validateCurrentStep]);

  const onIssueDetailsSaveAndContinue = useCallback(async () => {
    // ABY-237 — synchronous re-entry guard. The bottom-nav button is
    // disabled while `savingIssueDetails` is true, but React state
    // updates aren't synchronous, so a fast second click can land
    // before the disabled state paints. The state-based check
    // doesn't catch that race (both calls read the same stale
    // closure value); the ref-based latch does, because we flip it
    // synchronously below before awaiting anything.
    if (savingIssueDetailsRef.current) return;

    const issueFieldErrors: Array<{ field: string; message: string }> = [];
    const currentData = args.form.getValues();
    const missingMappedKeys = missingIssuedFields
      .map((f) => issueFieldKeyFromSlug(f.slug))
      .filter((k): k is string => Boolean(k));

    args.form.clearErrors();
    // Dotted-path resolver — many canonical issuance keys are nested
    // (`proposer.firstName`, `proposer.address.postcode`,
    // `additionalDrivers.0.licenseYears`). Reading them via
    // `dataRecord[key]` always returned undefined and falsely flagged
    // every nested field as missing (ABY-30).
    const readDottedPath = (root: Record<string, unknown>, path: string): unknown => {
      return path.split('.').reduce<unknown>((current, part) => {
        if (current === null || current === undefined) return undefined;
        if (Array.isArray(current)) {
          const idx = Number(part);
          return Number.isInteger(idx) ? current[idx] : undefined;
        }
        if (typeof current !== 'object') return undefined;
        return (current as Record<string, unknown>)[part];
      }, root);
    };
    const dataRecord: Record<string, unknown> = { ...currentData };
    const valueIsEmpty = (value: unknown): boolean =>
      value === undefined || value === null
      || (typeof value === 'string' && value.trim() === '')
      || (typeof value === 'number' && !Number.isFinite(value))
      || (Array.isArray(value) && value.length === 0);
    // ABY-352 — `registrationNumber` and `vin` are an either-or pair at
    // the issuance stage (validateMotorIssuanceStage per ABY-104): only
    // ONE is required to issue. The server lists BOTH in
    // `missingIssuedFields` so the UI can render the Registration/VIN
    // switch, but this pre-save check must honour the either-or.
    // Without this, filling Registration still falsely flagged the
    // (empty) VIN as "required" and blocked Save & Continue even though
    // the canonical validator (pass below) and the server gate accept
    // the quote.
    const vehicleIdentifierSatisfied =
      !valueIsEmpty(readDottedPath(dataRecord, 'registrationNumber'))
      || !valueIsEmpty(readDottedPath(dataRecord, 'vin'));
    missingMappedKeys.forEach((key) => {
      if ((key === 'registrationNumber' || key === 'vin') && vehicleIdentifierSatisfied) {
        return;
      }
      const value = readDottedPath(dataRecord, key);
      const isEmpty = valueIsEmpty(value);
      if (isEmpty) {
        const label = missingIssuedFields.find((f) => issueFieldKeyFromSlug(f.slug) === key)?.label || key;
        const message = `${label} is required.`;
        // RHF accepts dotted paths for nested setError targets; the
        // QuoteData cast survives at runtime because RHF treats
        // string paths uniformly.
        args.form.setError(key as keyof QuoteData, { type: 'manual', message });
        issueFieldErrors.push({ field: key, message });
      }
    });

    // ABY-236 — also run the SAME canonical issuance-stage validator
    // the server applies (`validateMotorIssuanceStage` per ABY-104),
    // so format errors (invalid VIN regex, registration too short)
    // are caught here instead of round-tripping to the server and
    // coming back as a re-asked missing field. Without this, a user
    // who typed both Reg + an invalid VIN would `saveDraft` happily,
    // then `runIssueReadinessGate` would re-list VIN as still
    // outstanding, producing the "duplicated VIN step" the marker.io
    // report describes.
    const issuanceErrors = validateForContext({
      productCode: 'MOTOR',
      stage: { kind: 'stage', id: 'issuance' },
      actor: 'customer',
      // Same widening rationale as the rate-quote stage above — the
      // runner needs an open-shape record for path traversal only, and
      // asRecord widens at runtime without weakening the typed
      // QuoteData snapshot.
      data: asRecord(currentData),
    });
    if (Object.keys(issuanceErrors).length > 0) {
      applyValidationErrors(args.form as never, issuanceErrors);
      Object.entries(issuanceErrors).forEach(([field, message]) => {
        if (!issueFieldErrors.some((e) => e.field === field)) {
          issueFieldErrors.push({ field, message });
        }
      });
    }

    // ABY-232: only validate the named-drivers list when the coverage
    // basis is NAMED_DRIVERS (or unset, for legacy quotes mid-flow).
    const namedModeForValidation =
      currentData.driverRestriction === 'NAMED_DRIVERS' ||
      currentData.driverRestriction === undefined ||
      currentData.driverRestriction === null;
    if (namedModeForValidation && currentData.hasAdditionalDrivers === true) {
      const rows = Array.isArray(currentData.additionalDrivers) ? currentData.additionalDrivers : [];
      const declaredYoungestAge = Number(currentData.youngestDriverAge);
      if (rows.length === 0) {
        const message = 'At least one additional driver is required.';
        args.form.setError('additionalDrivers', { type: 'manual', message });
        issueFieldErrors.push({ field: 'additionalDrivers', message });
      }
      rows.forEach((driver, idx) => {
        const v = validateDriverDraft(driver || {}, { requireCore: true });
        (Object.entries(v) as Array<[keyof typeof v, string | undefined]>).forEach(([fieldName, message]) => {
          if (!message) return;
          const path = `additionalDrivers.${idx}.${fieldName}` as const;
          args.form.setError(path, { type: 'manual', message });
          issueFieldErrors.push({ field: path, message });
        });
        if (Number.isFinite(declaredYoungestAge) && declaredYoungestAge > 0) {
          const driverDob =
            typeof driver === 'object' && driver && 'dateOfBirth' in driver
              ? (driver as { dateOfBirth?: unknown }).dateOfBirth
              : '';
          const driverAge = ageFromDateOfBirth(String(driverDob || ''));
          if (driverAge !== null && driverAge < declaredYoungestAge) {
            const message =
              `Driver age (${driverAge}) is younger than your declared youngest driver age (${declaredYoungestAge}). ` +
              'Please update the youngest driver age in Driving History or correct the date of birth.';
            const path = `additionalDrivers.${idx}.dateOfBirth` as const;
            args.form.setError(path, { type: 'manual', message });
            issueFieldErrors.push({ field: path, message });
          }
        }
      });
    }

    if (issueFieldErrors.length > 0) {
      // Scroll the first errored field into view, then fall back to
      // scrolling to top so the error summary is visible.
      const firstField = issueFieldErrors[0]?.field;
      const scrolled = firstField ? args.scrollToField(firstField) : false;
      if (!scrolled) args.scrollToTop();
      return;
    }

    savingIssueDetailsRef.current = true;
    setSavingIssueDetails(true);
    try {
      const saved = await saveDraft();
      if (!saved.ok) {
        // ABY-237 — surface the specific 429 throttling case so the
        // user understands why save & continue is suddenly failing
        // after a burst of clicks, and waits instead of clicking more.
        if (saved.status === 429) {
          window.alert(
            'You\u2019re saving a little too quickly. Please wait a few seconds, then try again.',
          );
        } else {
          window.alert('We could not save your updates. Please try again.');
        }
        return;
      }
      const clear = await runIssueReadinessGate();
      if (!clear) {
        // ABY-236 — the save succeeded but the canonical issue-readiness
        // check still reports outstanding fields (e.g. the user
        // entered a syntactically invalid VIN that passes "not empty"
        // but fails `validateMotorIssuanceStage`). Without an explicit
        // alert here the UI silently re-renders the same form with
        // the offending field still highlighted, which reads as
        // "the same question is asking me again". Tell them what
        // happened and scroll back so the highlighted fields are
        // obvious.
        window.alert(
          'Some of the details still need attention. We\u2019ve highlighted them above.',
        );
        args.scrollToTop();
        return;
      }
      const rated = await rateQuote();
      if (!rated) {
        window.alert('We saved your updates, but could not refresh your quote. Please try again.');
        return;
      }
      args.dispatchEngine({ type: 'NAV.NEXT' });
    } finally {
      savingIssueDetailsRef.current = false;
      setSavingIssueDetails(false);
    }
  }, [args, missingIssuedFields, rateQuote, runIssueReadinessGate, saveDraft]);

  const onBack = useCallback(async () => {
    if (args.currentStep === 4) {
      setPendingEditStep(3);
      setShowEditWarning(true);
      return;
    }
    // Save driving-history data before navigating away so it is persisted
    // on the server even if the user navigated to this step quickly (before
    // the 300ms autosave debounce fired). Navigation happens regardless of
    // whether the save succeeds — the form memory is the canonical source
    // while the session is active; the server copy is needed for fork/reload.
    if (args.currentStep === 3) {
      void saveDraft();
    }
    args.dispatchEngine({ type: 'NAV.BACK' });
  }, [args, saveDraft]);

  const requestQuoteEdit = useCallback((step: number) => {
    setPendingEditStep(step);
    setShowEditWarning(true);
  }, []);

  const confirmQuoteEdit = useCallback(async () => {
    const target = pendingEditStep ?? 3;
    const targetStepId = indexToStepId[target] || 'driving-history';
    setUnlockingForEdit(true);
    try {
      if (args.policyId) {
        const unlockResult = await unlockPublicSession(args.policyId);
        if (!unlockResult.ok || !unlockResult.json?.success) {
          const forkResult = await forkPublicSession(args.policyId);
          const forkJson = asRecord(forkResult.json);
          const forkData = asRecord(forkJson.data);
          const nextPublicId = String(
            forkData.publicSessionToken || forkData.reference || forkData.policyId || ''
          ).trim();
          if (!forkResult.ok || !forkJson.success || !nextPublicId) {
            window.alert('We could not unlock this quote for editing. Please refresh and try again.');
            return;
          }
          const url = new URL(window.location.href);
          const params = new URLSearchParams(url.search);
          params.set('step', targetStepId);
          window.location.href = `/quote/${encodeURIComponent(nextPublicId)}?${params.toString()}`;
          return;
        }
      }
      setShowEditWarning(false);
      setEditQuoteFlowActive(true);
      args.dispatchEngine({ type: 'NAV.GOTO', stepId: targetStepId });
    } finally {
      setUnlockingForEdit(false);
    }
  }, [args, pendingEditStep]);

  const onRequestCall = useCallback(async () => {
    if (!args.policyId) throw new Error('Missing reference');
    const proposer = args.data.proposer || {};
    const payload = {
      name: `${String(proposer.firstName || '').trim()} ${String(proposer.lastName || '').trim()}`.trim() || undefined,
      email: String(proposer.email || '').trim() || undefined,
      phone: String(proposer.phone || '').trim() || undefined,
      bestTimeToCall: String(proposer.bestTimeToCall || '').trim() || undefined,
      reference: String(args.quoteResponse?.reference || '').trim() || undefined,
    };
    const result = await requestPublicQuoteCallback({ policyId: args.policyId, payload });
    if (!result.ok || !result.json?.success) {
      const json = asRecord(result.json);
      const error = asRecord(json.error);
      throw new Error(String(error.message || 'Request failed'));
    }
  }, [args]);

  const handleTerminal = useCallback(async (result: { status: 'paid' | 'failed'; issued?: boolean; reference?: string }) => {
    let resolvedReference = String(result.reference || '').trim();
    if (!resolvedReference && args.policyId) {
      try {
        const session = await getPublicSessionSummary(args.policyId);
        const sessionJson = asRecord(session.json);
        const sessionData = asRecord(sessionJson.data);
        resolvedReference = String(sessionData.policyNumber || '').trim();
      } catch {
        resolvedReference = '';
      }
    }
    // ABY-100 — never fall back to `args.policyId`; that is the
    // opaque public session token (43-char base64), not a customer
    // reference. Prefer the rater's quote `reference` (e.g.
    // `ABQ-...`) which is already a printable business id, otherwise
    // surface a deterministic placeholder so customer-facing copy
    // never displays an internal token.
    let reference = resolvedReference;
    if (!reference) {
      const quoteRef = String(args.quoteResponse?.reference || '').trim();
      reference = quoteRef;
    }
    if (!reference) {
      const tokenSlice = String(args.policyId || '').slice(0, 8).toUpperCase();
      reference = tokenSlice ? `ABM-PENDING-${tokenSlice}` : `AQ-${Date.now()}`;
    }
    if (result.status === 'failed') {
      setTerminal({ variant: 'payment_failed', reference });
      return;
    }
    setTerminal({ variant: result.issued === false ? 'pending' : 'issued', reference });
    args.dispatchEngine({ type: 'ENGINE.CONTEXT_PATCH', patch: { paymentConfirmed: true } });
  }, [args]);

  const resetIssueReadiness = useCallback(() => {
    setMissingIssuedFields([]);
    setConditionalRequirements([]);
    setCheckingIssueReadiness(false);
  }, []);

  return {
    state: {
      isSubmitting,
      missingIssuedFields,
      conditionalRequirements,
      checkingIssueReadiness,
      savingIssueDetails,
      terminal,
      showEditWarning,
      pendingEditStep,
      editQuoteFlowActive,
      unlockingForEdit,
    },
    actions: {
      setTerminal,
      setShowEditWarning,
      setPendingEditStep,
      setEditQuoteFlowActive,
      validateCurrentStep,
      rateQuote,
      saveDraft,
      forkAndRateToNewSession,
      runIssueReadinessGate,
      guardPaymentEntry,
      onNext,
      onIssueDetailsSaveAndContinue,
      onBack,
      requestQuoteEdit,
      confirmQuoteEdit,
      onRequestCall,
      handleTerminal,
      resetIssueReadiness,
    },
  };
}

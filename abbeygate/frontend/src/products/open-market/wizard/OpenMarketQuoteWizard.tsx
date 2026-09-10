import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Controller, FormProvider, useForm } from 'react-hook-form';
import { AnimatePresence, motion } from 'framer-motion';
import { FilePenLine, ShieldCheck } from 'lucide-react';
import { applyValidationErrors, validateForContext } from '@facio/validation/frontend';
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
  createSessionAdapter,
} from '@/src/shared/lib/wizard';
import { collectErrorEntries, dedupeErrorEntries, getNestedError } from '@/src/shared/lib/wizard/utils/errors';
import { replaceWizardStepInUrl } from '@/src/shared/lib/wizard/utils/replaceWizardUrl';
import {
  Button,
  Checkbox,
  FormField,
  SectionCard,
  WizardInput as Input,
  WizardSelect as Select,
  WizardTextarea as Textarea,
} from '@/src/shared/ui';
import {
  OPEN_MARKET_LINE_OF_BUSINESS_OPTIONS,
  OPEN_MARKET_PROPOSAL_STATUS_OPTIONS,
} from '@facio/products';

type UnknownRecord = Record<string, unknown>;
type CoverageRow = {
  coverage?: string;
  limit?: string | number;
  excess?: string | number;
  premium?: number | string;
  notes?: string;
};
type OpenMarketFormValues = {
  proposer?: UnknownRecord;
  risk?: UnknownRecord;
  proposal?: UnknownRecord & { coverageRows?: CoverageRow[] };
  declarations?: UnknownRecord;
};
type ValidationFormBridge = {
  clearErrors: (path?: string | string[] | undefined) => void;
  setError: (path: string, error: { type?: string; message: string }) => void;
};

const STEPS = ['Your Details', 'Risk', 'Manual Proposal', 'Review'];
const STEP_IDS = ['intake', 'risk-details', 'manual-proposal', 'review'] as const;
const stepIdToIndex: Record<string, number> = {
  intake: 1,
  'risk-details': 2,
  'manual-proposal': 3,
  review: 4,
};
const sessionAdapter = createSessionAdapter({ productCode: 'open-market' });

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function proposerName(proposer: unknown): string {
  const record = asRecord(proposer);
  const explicit = String(record.name || '').trim();
  if (explicit) return explicit;
  return [record.firstName, record.lastName].map((part) => String(part || '').trim()).filter(Boolean).join(' ');
}

function normalizeQuoteData(values: OpenMarketFormValues): OpenMarketFormValues {
  const proposer = asRecord(values.proposer);
  return {
    ...values,
    proposer: {
      ...proposer,
      name: proposerName(proposer),
    },
  };
}

function coverageRows(value: unknown): CoverageRow[] {
  return Array.isArray(value) ? value.map((row) => asRecord(row) as CoverageRow) : [];
}

export interface OpenMarketQuoteWizardProps {
  policyId?: string;
}

export default function OpenMarketQuoteWizard({ policyId = '' }: OpenMarketQuoteWizardProps) {
  const form = useForm<OpenMarketFormValues>({
    defaultValues: {
      proposer: { address: { country: REGION_CONFIG.defaultCountry } },
      proposal: { status: 'draft', coverageRows: [] },
      declarations: { operatorReviewed: false },
    },
    mode: 'onChange',
  });
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [currentStepId, setCurrentStepId] = useState<string>('intake');
  const [quoteViewRequested, setQuoteViewRequested] = useState(false);
  const [loadedQuoteResponse, setLoadedQuoteResponse] = useState<UnknownRecord | null>(null);
  const [hoverNav, setHoverNav] = useState<'back' | 'next' | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const autosaveTimerRef = useRef<number | null>(null);

  const currentStep = stepIdToIndex[currentStepId] || 1;

  const scrollToTop = useCallback((behavior: ScrollBehavior = 'smooth') => {
    try {
      window.scrollTo({ top: 0, behavior });
    } catch {
      window.scrollTo(0, 0);
    }
  }, []);

  useEffect(() => {
    if (!policyId) {
      setSessionLoaded(true);
      return;
    }
    let cancelled = false;
    sessionAdapter.load(policyId).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        const sessionRecord = asRecord(result.session);
        const snapshot = asRecord(sessionRecord.snapshot);
        const quoteData = asRecord(snapshot.quoteData || sessionRecord.quoteData);
        form.reset(normalizeQuoteData(quoteData));
        setLoadedQuoteResponse(asRecord(sessionRecord.quoteResponse));
      }
      setSessionLoaded(true);
    }).catch(() => setSessionLoaded(true));
    return () => { cancelled = true; };
  }, [form, policyId]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const stepParam = String(url.searchParams.get('step') || '').trim();
    if (stepParam === 'your-quote' || stepParam === 'payment') {
      setQuoteViewRequested(true);
      return;
    }
    if (stepParam && stepIdToIndex[stepParam]) setCurrentStepId(stepParam);
  }, []);

  useEffect(() => {
    if (quoteViewRequested) return;
    replaceWizardStepInUrl(currentStepId);
  }, [currentStepId, quoteViewRequested]);

  useEffect(() => {
    if (quoteViewRequested) return;
    if (!policyId || !sessionLoaded) return;
    const subscription = form.watch((_all, info) => {
      const eventType = String(info?.type || '');
      if (eventType !== 'change' && eventType !== 'blur' && eventType !== '') return;
      if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = window.setTimeout(() => {
        void sessionAdapter.patch(policyId, {
          quoteData: normalizeQuoteData(form.getValues()),
          step: currentStepId,
          materializeAccount: currentStepId === 'intake',
        }).catch(() => undefined);
      }, 300);
    });
    return () => {
      subscription.unsubscribe();
      if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
    };
  }, [currentStepId, form, policyId, quoteViewRequested, sessionLoaded]);

  const err = useCallback((path: string): string | undefined =>
    getNestedError(form.formState.errors as Record<string, unknown>, path), [form.formState.errors]);

  const saveDraft = useCallback(async () => {
    if (!policyId) return false;
    const result = await sessionAdapter.patch(policyId, {
      quoteData: normalizeQuoteData(form.getValues()),
      step: currentStepId,
      materializeAccount: currentStepId === 'intake',
    });
    return Boolean(result.ok);
  }, [currentStepId, form, policyId]);

  const validateCurrentStep = useCallback(() => {
    const errors = validateForContext({
      productCode: 'OPEN_MARKET',
      stage: { kind: 'wizardStep', id: currentStepId },
      actor: 'customer',
      data: normalizeQuoteData(form.getValues()) as Record<string, unknown>,
    });
    applyValidationErrors(form as unknown as ValidationFormBridge, errors);
    if (Object.keys(errors).length > 0) {
      scrollToTop();
      return false;
    }
    return true;
  }, [currentStepId, form, scrollToTop]);

  const goBack = useCallback(() => {
    setCurrentStepId((step) => STEP_IDS[Math.max((stepIdToIndex[step] || 1) - 2, 0)]);
    scrollToTop('auto');
  }, [scrollToTop]);

  const goNext = useCallback(async () => {
    setSubmitError(null);
    if (!validateCurrentStep()) return;
    setIsSubmitting(true);
    try {
      const saved = await saveDraft();
      if (!saved) {
        setSubmitError('We could not save your updates. Please try again.');
        return;
      }
      if (currentStepId === 'review') {
        const rated = await sessionAdapter.rate(policyId);
        if (!rated.ok) {
          setSubmitError(rated.error || 'Unable to submit this open market request.');
          return;
        }
        setSubmitted(true);
        scrollToTop('auto');
        return;
      }
      setCurrentStepId((step) => STEP_IDS[Math.min(stepIdToIndex[step] || 1, STEP_IDS.length - 1)]);
      scrollToTop('auto');
    } finally {
      setIsSubmitting(false);
    }
  }, [currentStepId, policyId, saveDraft, scrollToTop, validateCurrentStep]);

  const updateCoverageRow = useCallback((index: number, key: keyof CoverageRow, value: unknown) => {
    const rows = coverageRows(form.getValues('proposal.coverageRows'));
    rows[index] = { ...rows[index], [key]: value };
    form.setValue('proposal.coverageRows', rows, { shouldDirty: true, shouldValidate: true });
  }, [form]);

  const addCoverageRow = useCallback(() => {
    const rows = coverageRows(form.getValues('proposal.coverageRows'));
    form.setValue('proposal.coverageRows', [...rows, { coverage: '', limit: '', excess: '', premium: 0, notes: '' }], { shouldDirty: true, shouldValidate: true });
  }, [form]);

  const removeCoverageRow = useCallback((index: number) => {
    const rows = coverageRows(form.getValues('proposal.coverageRows'));
    form.setValue('proposal.coverageRows', rows.filter((_, rowIndex) => rowIndex !== index), { shouldDirty: true, shouldValidate: true });
  }, [form]);

  const watchedRows = coverageRows(form.watch('proposal.coverageRows'));

  const errorEntries = useMemo(
    () => dedupeErrorEntries(collectErrorEntries(form.formState.errors)),
    [form.formState.errors],
  );

  const stepNode = useMemo(() => {
    if (currentStepId === 'intake') {
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
        />
      );
    }

    if (currentStepId === 'risk-details') {
      return (
        <SectionCard title="Open Market Risk" icon={<FilePenLine className="w-5 h-5" />}>
          <div className="grid grid-cols-1 gap-0 md:grid-cols-2 md:gap-6">
            <FormField label="Line of business" required error={err('risk.lineOfBusiness')} fieldKey="risk.lineOfBusiness">
              <Select {...form.register('risk.lineOfBusiness')} options={OPEN_MARKET_LINE_OF_BUSINESS_OPTIONS} placeholder="Please select..." />
            </FormField>
            <FormField label="Target inception date" error={err('risk.targetInceptionDate')} fieldKey="risk.targetInceptionDate">
              <Input type="date" {...form.register('risk.targetInceptionDate')} error={!!err('risk.targetInceptionDate')} />
            </FormField>
          </div>
          <FormField label="Risk description" required error={err('risk.description')} fieldKey="risk.description">
            <Textarea {...form.register('risk.description')} error={!!err('risk.description')} placeholder="Describe the risk and what needs to be placed." />
          </FormField>
        </SectionCard>
      );
    }

    if (currentStepId === 'manual-proposal') {
      return (
        <SectionCard title="Manual Proposal" icon={<FilePenLine className="w-5 h-5" />}>
          <div className="grid grid-cols-1 gap-0 md:grid-cols-2 md:gap-6">
            <FormField label="Market / insurer" error={err('proposal.marketName')} fieldKey="proposal.marketName">
              <Input {...form.register('proposal.marketName')} error={!!err('proposal.marketName')} placeholder="Market / insurer" />
            </FormField>
            <FormField label="Proposal status" required error={err('proposal.status')} fieldKey="proposal.status">
              <Select {...form.register('proposal.status')} options={OPEN_MARKET_PROPOSAL_STATUS_OPTIONS} placeholder="Please select..." />
            </FormField>
          </div>

          <FormField label="Coverage and pricing rows" required error={err('proposal.coverageRows')} fieldKey="proposal.coverageRows">
            <div className="space-y-3">
              {watchedRows.map((row, index) => (
                <div key={index} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="grid gap-3 md:grid-cols-4">
                    <Input placeholder="Coverage" value={String(row.coverage ?? '')} onChange={(event) => updateCoverageRow(index, 'coverage', event.target.value)} />
                    <Input placeholder="Limit" value={String(row.limit ?? '')} onChange={(event) => updateCoverageRow(index, 'limit', event.target.value)} />
                    <Input placeholder="Excess" value={String(row.excess ?? '')} onChange={(event) => updateCoverageRow(index, 'excess', event.target.value)} />
                    <Input type="number" placeholder="Premium" value={String(row.premium ?? '')} onChange={(event) => updateCoverageRow(index, 'premium', event.target.value === '' ? '' : Number(event.target.value))} />
                  </div>
                  <Textarea className="mt-3" placeholder="Notes" value={String(row.notes ?? '')} onChange={(event) => updateCoverageRow(index, 'notes', event.target.value)} />
                  <Button type="button" variant="ghost" className="mt-3 text-red-600" onClick={() => removeCoverageRow(index)}>
                    Remove row
                  </Button>
                </div>
              ))}
              <Button type="button" variant="secondary" onClick={addCoverageRow}>
                Add coverage row
              </Button>
            </div>
          </FormField>

          <FormField label="Terms notes" error={err('proposal.termsNotes')} fieldKey="proposal.termsNotes">
            <Textarea {...form.register('proposal.termsNotes')} error={!!err('proposal.termsNotes')} />
          </FormField>
          <FormField label="Subjectivities" error={err('proposal.subjectivities')} fieldKey="proposal.subjectivities">
            <Textarea {...form.register('proposal.subjectivities')} error={!!err('proposal.subjectivities')} />
          </FormField>
        </SectionCard>
      );
    }

    return (
      <SectionCard title="Review" icon={<ShieldCheck className="w-5 h-5" />}>
        <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm font-semibold text-slate-700">
          Review the open market request and submit it for manual handling in the back office.
        </div>
        <FormField label="" error={err('declarations.operatorReviewed')} fieldKey="declarations.operatorReviewed">
          <Controller
            name="declarations.operatorReviewed"
            control={form.control}
            render={({ field }) => (
              <Checkbox
                checked={field.value === true}
                onChange={(event) => field.onChange(event.target.checked)}
                label="I have reviewed the manually assembled proposal."
              />
            )}
          />
        </FormField>
      </SectionCard>
    );
  }, [addCoverageRow, currentStepId, err, form, removeCoverageRow, updateCoverageRow, watchedRows]);

  if (!policyId) {
    return <div className="min-h-screen flex items-center justify-center text-slate-500">Starting your quote...</div>;
  }

  if (submitted) {
    const values = normalizeQuoteData(form.getValues());
    const proposer = asRecord(values.proposer);
    const email = String(proposer.email || '').trim();
    return (
      <div className="brand-flow min-h-screen overflow-x-hidden bg-white text-black font-sans">
        <Header currentStep={STEPS.length} totalSteps={STEPS.length} steps={STEPS} />
        <SuccessScreen
          variant="pending"
          headline="Thank you"
          subline="Someone from Abbeygate will contact you about this open market request."
          statusTitle="Your request is with the team"
          statusBody={`A specialist will review the details and contact you${email ? ` at ${email}` : ''}.`}
          firstName={String(proposer.firstName || '') || undefined}
          email={email || undefined}
          productLabel="open market request"
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
        quoteData={normalizeQuoteData(form.getValues()) as UnknownRecord}
        quoteResponse={loadedQuoteResponse}
        productLabel="open market"
        currency="EUR"
        productCode="open-market"
        publicSessionToken={policyId}
      />
    );
  }

  return (
    <FormProvider {...form}>
      <div className="brand-flow min-h-screen overflow-x-hidden bg-white text-black font-sans">
        <Header currentStep={currentStep} totalSteps={STEPS.length} steps={STEPS} />
        <QuoteWizardMobileProgress currentStep={currentStep} steps={STEPS} />
        <main className="w-full pb-28 pt-4">
          {!sessionLoaded ? (
            <div className="mx-auto max-w-4xl p-8 text-sm font-semibold text-slate-600">Loading session...</div>
          ) : (
            <>
              <div className="mx-auto max-w-4xl px-5 mb-5 mt-6">
                <h1 className="text-3xl font-semibold mb-1 tracking-tight">Get your open market insurance quote</h1>
                <p className="text-lg text-gray-600">The way insurance should be</p>
              </div>

              <QuoteWizardErrorSummary
                errors={errorEntries.map((entry) => ({
                  path: entry.field,
                  message: entry.message,
                  onFocus: () => {
                    const target = document.querySelector(`[data-field="${CSS.escape(entry.field)}"]`) as HTMLElement | null;
                    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  },
                }))}
              />

              {submitError && <div className="mx-auto max-w-4xl px-5 pb-3 text-sm font-bold text-red-700">{submitError}</div>}

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
          productCode="open-market"
          publicSessionToken={policyId}
          email={(form.watch('proposer.email') as string | undefined) || null}
          step={currentStepId}
        />
        <QuoteWizardBottomNav
          canBack={currentStep > 1 && !isSubmitting}
          canNext
          hoverNav={hoverNav}
          isSubmitting={isSubmitting}
          onHoverNavChange={setHoverNav}
          onBack={goBack}
          onNext={() => { void goNext(); }}
          nextLabel={currentStepId === 'review' ? 'Submit request' : 'Continue'}
        />
      </div>
    </FormProvider>
  );
}

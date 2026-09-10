import React from 'react';
import { Button } from '@/src/shared/ui';
import type { FnolForm } from '../model/clientFnol.types';

export function FnolSubmissionSuccess(props: {
  publicClaimNumber: string;
  copiedReference: boolean;
  setCopiedReference: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const { publicClaimNumber, copiedReference, setCopiedReference } = props;
  return (
    <section className="rounded-3xl border border-emerald-200 bg-white shadow-sm p-8 md:p-10">
      <div className="mx-auto max-w-2xl text-center space-y-5">
        <div className="mx-auto h-14 w-14 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
          <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight">Thank you for submitting your incident report</h2>
        <p className="text-sm md:text-base font-semibold text-slate-600">
          Your FNOL was received successfully. Our claims team will review the details and contact you if any clarification is required.
        </p>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left text-sm font-semibold text-slate-700">
          {publicClaimNumber ? (
            <div className="mb-3 rounded-xl border border-slate-200 bg-white px-3 py-2 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-wider font-black text-slate-500">Claim reference</div>
                <div className="text-sm md:text-base font-black text-slate-900 truncate">{publicClaimNumber}</div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  void navigator.clipboard?.writeText(publicClaimNumber);
                  setCopiedReference(true);
                  setTimeout(() => setCopiedReference(false), 1500);
                }}
                className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-black text-slate-700 hover:bg-slate-100 transition bg-transparent"
              >
                {copiedReference ? 'Copied' : 'Copy'}
              </Button>
            </div>
          ) : null}
          <div className="font-black text-slate-900 mb-1">What happens next</div>
          <div>1. We review your report.</div>
          <div>2. If needed, we contact you for additional details.</div>
          <div>3. Your handler confirms the intake and proceeds with claim assessment.</div>
        </div>
        <p className="text-xs font-semibold text-slate-500">You can now close this page.</p>
      </div>
    </section>
  );
}

export function FnolStepProgress(props: { step: number; totalSteps: number }) {
  const { step, totalSteps } = props;
  return (
    <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6">
      <div className="text-xs font-black uppercase tracking-widest text-slate-400">Step {step} of {totalSteps}</div>
      <div className="mt-2 w-full h-2 rounded-full bg-slate-100 overflow-hidden">
        <div className="h-full bg-brand-primary transition-all" style={{ width: `${(step / totalSteps) * 100}%` }} />
      </div>
    </div>
  );
}

export function FnolIncidentTypeStep(props: {
  incidentCards: Array<{ id: FnolForm['incidentType']; label: string; icon: React.ReactNode; blurb: string }>;
  selectedIncidentType: FnolForm['incidentType'];
  onSelect: (incidentType: FnolForm['incidentType']) => void;
}) {
  const { incidentCards, selectedIncidentType, onSelect } = props;
  return (
    <section className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 space-y-4">
      <h3 className="text-xl font-black text-slate-900">What happened?</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {incidentCards.map((t) => (
          <Button
            key={t.id}
            type="button"
            variant="ghost"
            size="md"
            onClick={() => onSelect(t.id)}
            className={`group relative rounded-2xl border p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${selectedIncidentType === t.id ? 'border-brand-primary bg-brand-primary/5 shadow-sm' : 'border-slate-200'}`}
            aria-label={`${t.label}. ${t.blurb}`}
          >
            <div className="flex items-center gap-2 font-black text-slate-900">
              {t.icon}
              {t.label}
            </div>
            <span
              role="tooltip"
              className="brand-radio-tooltip pointer-events-none hidden group-hover:block absolute left-1/2 top-0 -translate-x-1/2 -translate-y-[110%] bg-slate-900 text-white text-xs rounded-lg px-3 py-2 z-20 shadow-lg max-w-[min(320px,calc(100vw-2rem))] whitespace-normal text-center"
            >
              {t.blurb}
            </span>
          </Button>
        ))}
      </div>
    </section>
  );
}

export function FnolStepFooter(props: {
  step: number;
  totalSteps: number;
  canContinueStep1: boolean;
  canContinueStep2: boolean;
  canContinueStep3: boolean;
  canContinueStep4: boolean;
  canContinueStep5: boolean;
  canSubmit: boolean;
  saving: boolean;
  showSaveAndContinueLater?: boolean;
  onSaveAndContinueLater?: () => void;
  disableSaveAndContinueLater?: boolean;
  onBack: () => void;
  onContinue: () => void;
  onSubmit: () => void;
}) {
  const {
    step,
    totalSteps,
    canContinueStep1,
    canContinueStep2,
    canContinueStep3,
    canContinueStep4,
    canContinueStep5,
    canSubmit,
    saving,
    showSaveAndContinueLater,
    onSaveAndContinueLater,
    disableSaveAndContinueLater,
    onBack,
    onContinue,
    onSubmit,
  } = props;
  return (
    <div className="sticky bottom-4 z-30">
      <div className="rounded-3xl border border-slate-200 bg-white shadow-sm p-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-4">
          {showSaveAndContinueLater ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="px-0 py-0 font-semibold text-brand-primary underline underline-offset-2 hover:bg-transparent hover:text-brand-primary-600"
              onClick={onSaveAndContinueLater}
              disabled={disableSaveAndContinueLater}
            >
              Save and continue later
            </Button>
          ) : null}
          <div className="text-xs font-semibold text-slate-600">
          {step < totalSteps ? 'Complete this step to continue.' : (canSubmit ? 'Ready to submit.' : 'Please confirm declaration before submitting.')}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {step > 1 && <Button variant="secondary" onClick={onBack}>Back</Button>}
          {step < totalSteps ? (
            <Button
              onClick={onContinue}
              disabled={
                (step === 1 && !canContinueStep1) ||
                (step === 2 && !canContinueStep2) ||
                (step === 3 && !canContinueStep3) ||
                (step === 4 && !canContinueStep4) ||
                (step === 5 && !canContinueStep5)
              }
            >
              Continue
            </Button>
          ) : (
            <Button onClick={onSubmit} disabled={!canSubmit || saving}>
              {saving ? 'Submitting…' : 'Submit claim'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

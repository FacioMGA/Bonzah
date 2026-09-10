/**
 * ClientFnolPage — CHAMPS Thin Shell
 *
 * Zero domain logic. Zero useState. Zero useEffect.
 * Delegates orchestration to controller, rendering to step components.
 */
import React from 'react';
import { PageHeader, Toast } from '@/src/shared/ui';

import { useClientFnolController } from '../hooks/useClientFnolController';
import { FnolIncidentTypeStep, FnolStepFooter, FnolStepProgress, FnolSubmissionSuccess } from './clientFnol.chrome';
import { StepFourThirdPartyServices, StepSixDescriptionEvidence, StepReviewSection } from '../views/clientFnol.sections';
import { StepWhenWhere } from './clientFnol.stepWhenWhere';
import { StepDriver } from './clientFnol.stepDriver';

export default function ClientFnolPage() {
  const c = useClientFnolController();

  return (
    <div className={c.pageContainerClass}>
      <Toast
        message={c.toastMessage}
        isVisible={c.showToast}
        onClose={() => c.setShowToast(false)}
        type="success"
        duration={2200}
      />
      <PageHeader
        breadcrumb={c.isPublicFnolFlow ? undefined : { label: 'Back to policy', onClick: c.backToPolicy }}
        title={c.pageTitle}
        subtitle={c.pageSubtitle}
      />

      {c.loading ? (
        <div className="text-slate-400 font-medium">Loading…</div>
      ) : (
        <>
          {c.submitError && (
            <div className="p-4 rounded-2xl border border-rose-200 bg-rose-50 text-rose-900 text-sm font-semibold">
              {c.submitError}
            </div>
          )}
          {c.publicSubmitted ? (
            <FnolSubmissionSuccess
              publicClaimNumber={c.publicClaimNumber}
              copiedReference={c.copiedReference}
              setCopiedReference={c.setCopiedReference}
            />
          ) : null}

          {!c.publicSubmitted ? <FnolStepProgress step={c.step} totalSteps={c.totalSteps} /> : null}

          {!c.publicSubmitted && c.step === 1 && (
            <FnolIncidentTypeStep
              incidentCards={c.incidentCards}
              selectedIncidentType={c.form.incidentType}
              onSelect={(incidentType) => c.setForm((p) => ({ ...p, incidentType }))}
            />
          )}

          {!c.publicSubmitted && c.step === 2 && (
            <StepWhenWhere form={c.form} setForm={c.setForm} fieldErrors={c.fieldErrors} />
          )}

          {!c.publicSubmitted && c.step === 3 && (
            <StepDriver
              form={c.form}
              setForm={c.setForm}
              fieldErrors={c.fieldErrors}
              policyId={c.policyId}
              namedDrivers={c.namedDrivers}
              selectedDriver={c.selectedDriver}
              driverStepTitle={c.driverStepTitle}
              defaultPhoneCountry={c.defaultPhoneCountry}
              phoneInputFlags={c.phoneInputFlags}
              phoneInputClass={c.phoneInputClass}
            />
          )}

          {!c.publicSubmitted && c.step === 4 && (
            <StepFourThirdPartyServices
              form={c.form}
              setForm={c.setForm}
              fieldErrors={c.fieldErrors}
              defaultPhoneCountry={c.defaultPhoneCountry}
              thirdPartyKinds={c.claimsContract?.fnol?.thirdPartyKinds}
              requiresThirdParty={c.showThirdPartyStep}
              requiresPoliceRef={c.requiresPoliceRef}
              title={c.showThirdPartyStep ? 'Third party & services' : 'Services'}
            />
          )}

          {!c.publicSubmitted && c.step === c.descriptionEvidenceStep && (
            <StepSixDescriptionEvidence
              form={c.form}
              setForm={c.setForm}
              fieldErrors={c.fieldErrors}
              uploads={c.uploads}
              onUpload={c.uploadMany}
              onRemoveUpload={c.removeUpload}
            />
          )}

          {!c.publicSubmitted && c.step === c.reviewStep && (
            <StepReviewSection
              form={c.form}
              selectedPolicyLabel={c.selectedPolicyLabel}
              selectedDriverName={c.selectedDriver?.name || '—'}
              anotherDriverName={c.anotherDriverName}
              anotherDriverId={c.ANOTHER_DRIVER_ID}
              canSubmit={c.canSubmit}
              onToggleDeclaration={(checked) => c.setForm((p) => ({ ...p, declarationAccepted: checked }))}
            />
          )}

          {!c.publicSubmitted ? (
            <FnolStepFooter
              step={c.step}
              totalSteps={c.totalSteps}
              canContinueStep1={c.canContinueStep1}
              canContinueStep2={c.canContinueStep2}
              canContinueStep3={c.canContinueStep3}
              canContinueStep4={c.canContinueStep4}
              canContinueStep5={c.canContinueStep5}
              canSubmit={c.canSubmit}
              saving={c.saving}
              showSaveAndContinueLater={!c.isPublicFnolFlow}
              onSaveAndContinueLater={c.saveAndContinueLater}
              disableSaveAndContinueLater={c.saving}
              onBack={c.prevStep}
              onContinue={c.nextStep}
              onSubmit={() => void c.submit()}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

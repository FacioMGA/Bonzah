import React from 'react';
import { ClaimsDeskCaseInfoModal } from '@/src/modules/claims/desk/components/ClaimsDeskCaseInfoModal';
import { ClaimsDeskIntakePathModal } from '@/src/modules/claims/desk/components/ClaimsDeskIntakePathModal';
import { ClaimsDeskCreateCaseModal } from '@/src/modules/claims/desk/components/ClaimsDeskCreateCaseModal';
import { LinkPolicyModal } from '@/src/modules/claims/case/views/LinkPolicyModal';
import { FnolAmendDrawer } from '@/src/modules/claims/intake/views/FnolAmendDrawer';
import { FnolClarificationDrawer } from '@/src/modules/claims/intake/views/FnolClarificationDrawer';
import { FnolReviewDrawer } from '@/src/modules/claims/intake/views/FnolReviewDrawer';
import { useClaimsDeskCtrl } from '@/src/modules/claims/desk/views/ClaimsDeskControllerContext';

export function ClaimsDeskModalsView() {
  const ctrl = useClaimsDeskCtrl();
  const { state, derived, local, mutators, actions } = ctrl;

  return (
    <>
      {state.worksheet ? (
        <>
          <FnolReviewDrawer
            isOpen={local.showFnolReviewDrawer}
            onClose={() => mutators.setShowFnolReviewDrawer(false)}
            worksheet={state.worksheet}
            busy={local.busy}
            onOpenEdit={() => {
              mutators.setShowFnolReviewDrawer(false);
              mutators.setShowFnolAmendDrawer(true);
            }}
          />
          <FnolAmendDrawer
            isOpen={local.showFnolAmendDrawer}
            onClose={() => {
              mutators.setShowFnolAmendDrawer(false);
              mutators.setForceGuidedManualResponse(false);
            }}
            worksheet={state.worksheet}
            fallbackSnapshot={{}}
            busy={local.busy}
            forceGuidedManual={local.forceGuidedManualResponse}
            onSubmitAmend={actions.saveIntakeDetails}
          />
          <FnolClarificationDrawer
            isOpen={local.showFnolClarificationDrawer}
            onClose={() => mutators.setShowFnolClarificationDrawer(false)}
            worksheet={state.worksheet}
            busy={local.busy}
            onRequest={actions.requestFnolClarification}
          />
        </>
      ) : null}

      <LinkPolicyModal
        isOpen={local.showLinkPolicyModal}
        onClose={() => mutators.setShowLinkPolicyModal(false)}
        busy={local.busy}
        policies={state.policies}
        onConfirm={(policyId) => void actions.linkPolicyToCase(policyId)}
      />

      <ClaimsDeskCaseInfoModal
        isOpen={local.showCaseRequestInfoModal}
        busy={local.busy}
        caseInfoMessage={local.caseInfoMessage}
        onClose={() => mutators.setShowCaseRequestInfoModal(false)}
        onChangeMessage={mutators.setCaseInfoMessage}
        onSend={() => void actions.requestCaseInfo()}
      />

      <ClaimsDeskCreateCaseModal
        isOpen={local.showCreateModal}
        busy={local.busy}
        newCaseStep={local.newCaseStep}
        newCaseMode={local.newCaseMode}
        createDraft={local.createDraft}
        createDraftErrors={derived.createDraftErrors}
        createPolicyOptions={derived.createPolicyOptions}
        disableCreateCasePrimary={derived.disableCreateCasePrimary}
        onClose={() => {
          mutators.setShowCreateModal(false);
          mutators.setNewCaseStep(1);
        }}
        onCancel={() => {
          if (local.newCaseStep === 1) {
            mutators.setShowCreateModal(false);
            return;
          }
          mutators.setNewCaseStep(1);
        }}
        onPrimary={() => {
          if (local.newCaseStep === 1) {
            mutators.setNewCaseStep(2);
            return;
          }
          void actions.createCase();
        }}
        onSetNewCaseMode={mutators.setNewCaseMode}
        onSetCreateDraft={mutators.setCreateDraft}
      />

      <ClaimsDeskIntakePathModal
        isOpen={local.showIntakePathModal}
        busy={local.busy}
        onClose={() => {
          if (local.busy) return;
          mutators.setShowIntakePathModal(false);
        }}
        onChooseRequest={() => void actions.chooseIntakePath('REQUEST_FROM_CUSTOMER')}
        onChooseManual={() => void actions.chooseIntakePath('HANDLER_ENTERS_NOW')}
      />
    </>
  );
}

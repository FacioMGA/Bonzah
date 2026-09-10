import React from 'react';
import { ClaimSummaryTab } from '@/src/modules/claims/case/views/ClaimSummaryTab';
import { useClaimsDeskCtrl } from '@/src/modules/claims/desk/views/ClaimsDeskControllerContext';
import { SegurnetClaimsActionsPanel } from '@/src/modules/claims/desk/views/SegurnetClaimsActionsPanel';

export function ClaimsDeskOverviewPanel() {
  const ctrl = useClaimsDeskCtrl();
  const { state, derived, local, mutators, actions } = ctrl;

  if (!state.worksheet) return null;

  return (
    <div className="space-y-6">
      <ClaimSummaryTab
        worksheet={state.worksheet}
        onOpenIntakeEditor={() => {
          if (derived.caseMode) return;
          mutators.setForceGuidedManualResponse(derived.awaitingFnolResponse || !derived.hasMeaningfulIntakeData);
          mutators.setShowFnolAmendDrawer(true);
        }}
        onOpenIntakeDetails={() => {
          if (derived.caseMode) return;
          mutators.setShowFnolReviewDrawer(true);
        }}
        onConfirmIntake={() => {
          if (derived.caseMode) return;
          void actions.confirmFnol();
        }}
        onOpenClarification={() => {
          if (derived.caseMode) return;
          mutators.setShowFnolClarificationDrawer(true);
        }}
        onResendFnolLink={() => {
          if (derived.caseMode) return;
          void actions.resendFnolLink();
        }}
        onOpenLinkPolicy={() => mutators.setShowLinkPolicyModal(true)}
        onOpenCaseRequestInfo={() => mutators.setShowCaseRequestInfoModal(true)}
        onOpenActivity={actions.openActivityFromOverview}
        onOpenPolicy={actions.openPolicyFromOverview}
        coverageRows={state.detailPolicy?.coverageRows}
        busy={local.busy}
      />
      <SegurnetClaimsActionsPanel worksheet={state.worksheet} disabled={local.busy} />
    </div>
  );
}

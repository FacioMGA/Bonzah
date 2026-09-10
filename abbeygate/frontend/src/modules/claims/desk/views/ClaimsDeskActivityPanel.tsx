import React from 'react';
import { ClaimTimelineTab } from '@/src/modules/claims/case/views/ClaimTimelineTab';
import { renderDevelopmentForm } from '@/src/modules/claims/desk/renderers/renderDevelopmentForm';
import { useClaimsDeskCtrl } from '@/src/modules/claims/desk/views/ClaimsDeskControllerContext';

export function ClaimsDeskActivityPanel() {
  const ctrl = useClaimsDeskCtrl();
  const { state, derived, local, mutators, actions } = ctrl;

  if (!state.worksheet) return null;

  return (
    <ClaimTimelineTab
      worksheet={state.worksheet}
      commandType={local.commandType}
      setCommandType={mutators.setCommandType}
      renderDevelopmentForm={() => renderDevelopmentForm({ worksheet: state.worksheet, local, mutators })}
      applyDevelopment={actions.applyDevelopment}
      busy={local.busy}
      applyLoadingLabel={local.applyLoadingLabel}
      applySuccessMessage={local.applySuccessMessage}
      onDismissApplySuccess={actions.dismissApplySuccess}
      lastApplyTick={local.lastApplyTick}
      showDevelopmentComposer={local.showDevelopmentComposer}
      setShowDevelopmentComposer={mutators.setShowDevelopmentComposer}
      developmentTypes={derived.availableDevelopmentTypes}
      paymentInlineError={local.paymentInlineError}
    />
  );
}

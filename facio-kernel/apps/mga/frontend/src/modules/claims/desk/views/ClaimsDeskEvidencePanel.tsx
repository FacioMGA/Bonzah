import React from 'react';
import { ClaimDocumentsTab } from '@/src/modules/claims/case/views/ClaimDocumentsTab';
import { useClaimsDeskCtrl } from '@/src/modules/claims/desk/views/ClaimsDeskControllerContext';

export function ClaimsDeskEvidencePanel() {
  const ctrl = useClaimsDeskCtrl();
  const { state, actions } = ctrl;

  if (!state.worksheet) return null;

  return <ClaimDocumentsTab worksheet={state.worksheet} onRefresh={actions.reloadWorksheet} />;
}

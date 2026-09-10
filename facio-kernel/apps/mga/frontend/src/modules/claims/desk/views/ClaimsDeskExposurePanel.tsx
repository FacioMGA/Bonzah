import React from 'react';
import { ClaimFinancialsTab } from '@/src/modules/claims/case/views/ClaimFinancialsTab';
import { useClaimsDeskCtrl } from '@/src/modules/claims/desk/views/ClaimsDeskControllerContext';

export function ClaimsDeskExposurePanel() {
  const ctrl = useClaimsDeskCtrl();
  const { state } = ctrl;

  if (!state.worksheet) return null;

  return <ClaimFinancialsTab worksheet={state.worksheet} />;
}

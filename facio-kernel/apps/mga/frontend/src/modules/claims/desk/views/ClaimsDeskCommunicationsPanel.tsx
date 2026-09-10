import React from 'react';
import { CommunicationsTab } from '@/src/modules/communications/views/CommunicationsTab';
import { useClaimsDeskCtrl } from '@/src/modules/claims/desk/views/ClaimsDeskControllerContext';

export function ClaimsDeskCommunicationsPanel() {
  const ctrl = useClaimsDeskCtrl();
  const { state } = ctrl;

  if (!state.worksheet) return null;

  return (
    <div className="h-[min(72vh,820px)] min-h-[560px]">
      <CommunicationsTab
        entityType={state.worksheet.comms?.entityType || 'CLAIM'}
        entityId={state.worksheet.comms?.entityId || state.worksheet.claimId}
      />
    </div>
  );
}

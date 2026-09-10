import React from 'react';
import { ClaimsDeskOverviewPanel } from '@/src/modules/claims/desk/views/ClaimsDeskOverviewPanel';
import { ClaimsDeskActivityPanel } from '@/src/modules/claims/desk/views/ClaimsDeskActivityPanel';
import { ClaimsDeskExposurePanel } from '@/src/modules/claims/desk/views/ClaimsDeskExposurePanel';
import { ClaimsDeskEvidencePanel } from '@/src/modules/claims/desk/views/ClaimsDeskEvidencePanel';
import { ClaimsDeskCommunicationsPanel } from '@/src/modules/claims/desk/views/ClaimsDeskCommunicationsPanel';
import { ClaimsDeskDeadlinesPanel } from '@/src/modules/claims/desk/views/ClaimsDeskDeadlinesPanel';
import { useClaimsDeskCtrl } from '@/src/modules/claims/desk/views/ClaimsDeskControllerContext';

export function ClaimsDeskTabSwitch() {
  const ctrl = useClaimsDeskCtrl();
  const { local, derived } = ctrl;

  switch (local.activeTab) {
    case 'overview':
      return <ClaimsDeskOverviewPanel />;
    case 'exposure':
      return derived.caseMode ? null : <ClaimsDeskExposurePanel />;
    case 'activity':
      return <ClaimsDeskActivityPanel />;
    case 'deadlines':
      return <ClaimsDeskDeadlinesPanel />;
    case 'evidence':
      return <ClaimsDeskEvidencePanel />;
    case 'communications':
      return <ClaimsDeskCommunicationsPanel />;
    default:
      return null;
  }
}

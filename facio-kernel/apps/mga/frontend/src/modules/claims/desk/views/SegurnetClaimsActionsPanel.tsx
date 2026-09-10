import React, { useState } from 'react';
import { boApiClient } from '@/src/shared/api/boApiClient';
import { Button } from '@/src/shared/ui';
import type { Worksheet } from '@/src/modules/claims/model/worksheetTypes';

type Props = {
  worksheet: Worksheet;
  disabled?: boolean;
};

export function SegurnetClaimsActionsPanel({ worksheet, disabled }: Props) {
  const [message, setMessage] = useState('');
  const [busyAction, setBusyAction] = useState('');

  const run = async (action: 'e-segurnet' | 'ids-cids') => {
    setBusyAction(action);
    setMessage('');
    const response = action === 'e-segurnet'
      ? await boApiClient.prepareESegurnetClaimSubmission(worksheet.claimId)
      : await boApiClient.prepareIdsCidsClaimSubmission(worksheet.claimId);
    setBusyAction('');
    setMessage(response.success
      ? 'Tracked submission prepared. Live Segurnet transmission remains blocked until APS/insurer specs are confirmed.'
      : response.error?.message || 'Could not prepare Segurnet submission.');
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-widest text-slate-500">Portugal claims actions</div>
          <h3 className="mt-1 text-lg font-black text-slate-900">Segurnet readiness</h3>
          <p className="mt-1 max-w-2xl text-sm font-medium text-slate-600">
            Customer FNOL links use the existing claim email flow. These actions create tracked insurer-notification records for e SEGURNET and IDS/CIDS while live external transmission is spec-gated.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={disabled || busyAction === 'e-segurnet'}
            onClick={() => void run('e-segurnet')}
          >
            {busyAction === 'e-segurnet' ? 'Preparing...' : 'Prepare insurer FNOL'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={disabled || busyAction === 'ids-cids'}
            onClick={() => void run('ids-cids')}
          >
            {busyAction === 'ids-cids' ? 'Preparing...' : 'Prepare IDS/CIDS'}
          </Button>
        </div>
      </div>
      <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-3 text-xs font-semibold text-slate-500">
        Claim form package: pending product-specific form and insurer recipient mapping from APS/insurer onboarding.
      </div>
      {message && <p className="mt-3 text-sm font-bold text-slate-700">{message}</p>}
    </section>
  );
}

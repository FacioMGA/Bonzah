import React from 'react';
import { PageHeader } from '@/src/shared/ui';
import { Button } from '@/src/shared/ui';
import { Input } from '@/src/shared/ui';
import { Select } from '@/src/shared/ui';
import { Textarea } from '@/src/shared/ui';
import { humanizePolicyStatus } from '@/src/modules/policies/model/policyDisplayLabels';

import { useClientCancelPolicyController } from '../controller/useClientCancelPolicyController';

export default function ClientCancelPolicyPage() {
  const ctrl = useClientCancelPolicyController();

  return (
    <div className="ui-page max-w-7xl mx-auto space-y-8">
      <PageHeader
        breadcrumb={{ label: 'Back to policy', onClick: ctrl.backToPolicy }}
        title="Cancel policy"
        subtitle="Request cancellation. We'll confirm details before anything is final."
      />

      {ctrl.loading ? (
        <div className="text-slate-400 font-medium">Loading…</div>
      ) : (
        <>
          {ctrl.error && (
            <div className="p-4 rounded-2xl border border-rose-200 bg-rose-50 text-rose-900 text-sm font-semibold">{ctrl.error}</div>
          )}

          {ctrl.result ? (
            <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 space-y-3">
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Status</div>
              <div className="text-xl font-black text-slate-900">{humanizePolicyStatus(String(ctrl.result.status || 'CANCELLATION_REQUESTED'))}</div>
              <div className="text-sm font-semibold text-slate-600">Your request has been received. Our team will follow up if any details are needed.</div>
              <div className="pt-4"><Button size="lg" onClick={ctrl.backToPolicy}>Back to policy</Button></div>
            </div>
          ) : (
            <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 space-y-4">
              {ctrl.step === 1 ? (
                <>
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Policy</div>
                    <Select className="ui-input" value={ctrl.policyId} onChange={(e) => ctrl.setPolicyId(e.target.value)} disabled={Boolean(ctrl.policyIdFromRoute)}>
                      <option value="">Select a policy…</option>
                      {ctrl.policies.map((p) => (<option key={p.id} value={String(p.id)}>{String(p.policyNumber || p.id).toUpperCase()}</option>))}
                    </Select>
                  </div>
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Requested effective date</div>
                    <Input className="ui-input" type="date" value={ctrl.effectiveDate} onValueChange={(next) => ctrl.setEffectiveDate(next)} />
                  </div>
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Reason</div>
                    <Textarea className="ui-input" rows={4} value={ctrl.reason} onChange={(e) => ctrl.setReason(e.target.value)} placeholder="Tell us why you'd like to cancel." />
                  </div>
                  <div className="pt-2 flex items-center justify-end gap-3">
                    <Button variant="secondary" size="lg" onClick={ctrl.backToPolicy}>Keep policy</Button>
                    <Button size="lg" onClick={ctrl.goToStep2} disabled={!ctrl.canSubmit}>Continue</Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="rounded-2xl border border-slate-200 p-4 text-sm font-semibold text-slate-700">
                    You are about to request cancellation for this policy effective {ctrl.effectiveDate || 'today'}.
                    {ctrl.reason ? (<div className="mt-2">Reason: <span className="font-black text-slate-900">{ctrl.reason}</span></div>) : null}
                  </div>
                  <div className="pt-2 flex items-center justify-end gap-3">
                    <Button variant="secondary" size="lg" onClick={ctrl.goToStep1}>Back</Button>
                    <Button type="button" onClick={() => void ctrl.submit()} disabled={!ctrl.canSubmit || ctrl.saving} className="px-6 py-4 rounded-3xl bg-rose-600 text-white font-black shadow-lg shadow-rose-600/20 disabled:opacity-60">
                      {ctrl.saving ? 'Submitting…' : 'Confirm cancellation'}
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

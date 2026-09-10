import React, { useEffect, useState } from 'react';
import { WorkspaceIntegrationsView } from '@/src/modules/settings/views/WorkspaceIntegrationsView';
import { boClient as api } from '@/src/surfaces/bo/api/boClient';
import { Button, Input } from '@/src/shared/ui';
import type { MotorMarketChecklist, MotorMarketReconciliation, MotorMarketSubmission } from '@/src/shared/api/boApiClient';

export default function IntegrationsPage() {
  const [checklist, setChecklist] = useState<MotorMarketChecklist | null>(null);
  const [reconciliation, setReconciliation] = useState<MotorMarketReconciliation | null>(null);
  const [submissions, setSubmissions] = useState<MotorMarketSubmission[]>([]);
  const [policyId, setPolicyId] = useState('');
  const [message, setMessage] = useState('');

  const refresh = async () => {
    const [checklistResponse, reconciliationResponse, submissionsResponse] = await Promise.all([
      api.getMotorMarketChecklist(),
      api.getMotorMarketReconciliation(),
      api.listMotorMarketSubmissions({ provider: 'SEGURNET', limit: 8 }),
    ]);
    if (checklistResponse.success) setChecklist(checklistResponse.data || null);
    if (reconciliationResponse.success) setReconciliation(reconciliationResponse.data || null);
    if (submissionsResponse.success) setSubmissions(submissionsResponse.data?.items || []);
  };

  useEffect(() => {
    void refresh();
  }, []);

  const retry = async (id: string) => {
    setMessage('');
    const response = await api.retryMotorMarketSubmission(id);
    setMessage(response.success ? 'Submission attempt recorded.' : response.error?.message || 'Retry failed.');
    if (response.success) void refresh();
  };

  const preparePolicy = async () => {
    const id = policyId.trim();
    if (!id) return;
    setMessage('');
    const response = await api.prepareSegurnetPolicySubmission(id);
    setMessage(response.success ? 'FNM policy submission prepared.' : response.error?.message || 'Could not prepare FNM submission.');
    if (response.success) {
      setPolicyId('');
      void refresh();
    }
  };

  return (
    <div className="space-y-6">
      <WorkspaceIntegrationsView />
      <div className="ui-page max-w-7xl mx-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-black text-slate-900">Motor market integrations</h2>
        <p className="mt-2 text-sm font-medium text-slate-500">
          Segurnet (Portugal motor) and FIVA (Spain motor) are spec-first integrations. Runtime API clients wait for confirmed API docs, credentials, test endpoints and support contacts.
        </p>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            ['Segurnet', 'Portugal motor submission/status integration'],
            ['FIVA', 'Spain motor submission/status integration'],
          ].map(([name, description]) => (
            <div key={name} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-black uppercase tracking-widest text-slate-500">{name}</div>
              <div className="mt-1 text-sm font-semibold text-slate-700">{description}</div>
              <div className="mt-3 text-xs font-black uppercase tracking-widest text-amber-600">Spec required before code</div>
            </div>
          ))}
        </div>
      </div>
      <div className="ui-page max-w-7xl mx-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-lg font-black text-slate-900">Portugal Segurnet onboarding</h2>
            <p className="mt-2 text-sm font-medium text-slate-500">
              Tracks FNM policy submissions, e SEGURNET FNOL and IDS/CIDS claims messages. Live transmission remains disabled until APS/insurer specs and credentials are confirmed.
            </p>
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={() => void refresh()}>Refresh</Button>
        </div>
        <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4 flex flex-col gap-3 md:flex-row md:items-end">
          <div className="flex-1">
            <label className="mb-1 block text-xs font-black uppercase tracking-widest text-slate-500">Prepare FNM policy submission</label>
            <Input variant="ui" placeholder="Policy ID" value={policyId} onChange={(event) => setPolicyId(event.target.value)} />
          </div>
          <Button type="button" variant="primary" size="md" disabled={!policyId.trim()} onClick={() => void preparePolicy()}>
            Prepare policy submission
          </Button>
        </div>
        <div className="mt-5 grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs font-black uppercase tracking-widest text-slate-500">Checklist</div>
            <div className="mt-2 space-y-2">
              {(checklist?.items || []).slice(0, 6).map((item) => (
                <div key={item.label} className="text-xs font-semibold text-slate-600">
                  <span className="font-black text-amber-600">Pending:</span> {item.label}
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs font-black uppercase tracking-widest text-slate-500">Reconciliation</div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(reconciliation?.statuses || []).map((row) => (
                <div key={row.status} className="rounded-lg bg-white px-3 py-2">
                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">{row.status.replace(/_/g, ' ')}</div>
                  <div className="text-lg font-black text-slate-900">{row.count}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs font-black uppercase tracking-widest text-slate-500">Recent submissions</div>
            <div className="mt-2 space-y-2">
              {submissions.length === 0 && <div className="text-xs font-semibold text-slate-400">No Segurnet submissions prepared yet.</div>}
              {submissions.map((submission) => (
                <div key={submission.id} className="rounded-lg bg-white p-3">
                  <div className="text-xs font-black text-slate-800">{submission.channel}</div>
                  <div className="mt-1 text-[11px] font-semibold text-slate-500">{submission.status.replace(/_/g, ' ')}</div>
                  <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => void retry(submission.id)}>Record retry</Button>
                </div>
              ))}
            </div>
          </div>
        </div>
        {message && <p className="mt-4 text-sm font-bold text-slate-700">{message}</p>}
      </div>
    </div>
  );
}

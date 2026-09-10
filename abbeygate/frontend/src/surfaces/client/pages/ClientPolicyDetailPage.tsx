import React from 'react';
import { PageHeader } from '@/src/shared/ui';
import { Button } from '@/src/shared/ui';
import { FileUpload } from '@/src/shared/ui';
import { Card, Badge } from '@/src/shared/ui';
import { formatDateRangeUI, formatDateUI, formatMoneyUI } from '@/src/shared/lib/format';
import { getClaimStatusLabel } from '@/src/modules/claims/model/claimDisplayLabels';

import { useClientPolicyDetailController } from '../controller/useClientPolicyDetailController';
import type { PolicyDetailTab } from '../controller/useClientPolicyDetailController';
import { openClientDocument } from '@/src/surfaces/client/lib/openClientDocument';

const TABS: PolicyDetailTab[] = ['Overview', 'Documents', 'Billing', 'Claims'];

export default function ClientPolicyDetailPage() {
  const ctrl = useClientPolicyDetailController();

  return (
    <div className="ui-page max-w-7xl mx-auto space-y-10">
      <PageHeader
        breadcrumb={{ label: 'Back to policies', onClick: ctrl.goBackToPolicies }}
        title={ctrl.loading ? 'Policy' : ctrl.view.insured}
        subtitle={`Policy ${ctrl.view.policyNumber} • ${formatDateRangeUI(ctrl.view.start, ctrl.view.end)}`}
        status={{ label: ctrl.view.status, tone: ctrl.view.status.toUpperCase().includes('EXPIRED') ? 'danger' : 'success' }}
        actions={(
          <div className="flex items-center gap-3">
            <Button variant="secondary" size="lg" onClick={ctrl.goToFileClaim}>File a claim</Button>
            <Button size="lg" onClick={ctrl.goToDocuments}>View documents</Button>
          </div>
        )}
      />

      <div className="ui-tabsbar">
        {TABS.map((t) => (
          <Button key={t} type="button" variant="tab" size="tab" onClick={() => ctrl.setActiveTab(t)} className={`ui-tab ${ctrl.activeTab === t ? 'ui-tab-active' : 'ui-tab-inactive'}`}>
            {t}
          </Button>
        ))}
      </div>

      {ctrl.loading ? (
        <div className="text-slate-400 font-medium">Loading…</div>
      ) : !ctrl.policy ? (
        <div className="text-slate-400 font-medium">Policy not found.</div>
      ) : (
        <>
          {ctrl.activeTab === 'Overview' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <Card className="ui-card-pad lg:col-span-2 border-none">
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Policy summary</div>
                <div className="mt-2 text-xl font-black text-slate-900">{ctrl.view.product}</div>
                <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                  <Card className="p-5 bg-slate-50 border-slate-200">
                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Premium</div>
                    <div className="mt-2 text-2xl font-black text-slate-900">{formatMoneyUI(ctrl.view.premium, ctrl.view.currency as 'EUR' | 'USD' | 'GBP')}</div>
                    <div className="text-xs text-slate-500 font-semibold mt-2">Billing details are available in the Billing tab.</div>
                  </Card>
                  <Card className="p-5 bg-slate-50 border-slate-200">
                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Open tasks</div>
                    <div className="mt-3 text-sm font-semibold text-slate-700">
                      {ctrl.policyDocs.length ? 'No document requests outstanding.' : 'Upload any requested documents (if applicable).'}
                    </div>
                  </Card>
                </div>
              </Card>
              <Card className="ui-card-pad border-none">
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Quick status</div>
                <div className="mt-2 text-lg font-black text-slate-900">Billing & claims</div>
                <div className="mt-6 space-y-3 text-sm font-semibold text-slate-700">
                  <div className="flex items-center justify-between"><span>Open invoices</span><span className="font-black text-slate-900">{ctrl.policyInvoices.filter((i) => i.status === 'OPEN').length}</span></div>
                  <div className="flex items-center justify-between"><span>Claims</span><span className="font-black text-slate-900">{ctrl.policyClaims.length}</span></div>
                </div>
              </Card>
            </div>
          )}

          {ctrl.activeTab === 'Documents' && (
            <Card className="ui-card-pad space-y-6 border-none">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Documents</div>
                  <div className="mt-2 text-xl font-black text-slate-900">Issued + uploads</div>
                </div>
                <FileUpload label={ctrl.uploading ? 'Uploading…' : 'Upload document'} buttonSize="lg" disabled={ctrl.uploading} onFileSelect={(f) => { if (f[0]) void ctrl.uploadDoc(f[0]); }} />
              </div>
              {ctrl.policyDocs.length === 0 ? (
                <div className="text-slate-500 font-semibold">No documents available yet for this policy.<div className="text-slate-400 text-sm mt-1">Generated policy documents and customer uploads will appear here.</div></div>
              ) : (
                <div className="space-y-3">
                  {ctrl.policyDocs.map((d) => (
                    <Card key={d.id} className="p-4 flex items-center justify-between gap-4">
                      <div><div className="text-sm font-black text-slate-900">{d.name}</div><div className="text-xs text-slate-500 font-semibold mt-1">Uploaded {formatDateUI(d.uploadedAt, { withTime: true })}</div></div>
                      <Button
                        type="button"
                        variant="link"
                        size="none"
                        disabled={!d.url}
                        onClick={() => { if (d.url) void openClientDocument(d.url); }}
                        className="text-brand-primary font-black text-xs uppercase tracking-widest hover:underline"
                      >
                        Download
                      </Button>
                    </Card>
                  ))}
                </div>
              )}
            </Card>
          )}

          {ctrl.activeTab === 'Billing' && (
            <div className="space-y-10">
              <Card className="ui-card-pad space-y-6 border-none">
                <div className="flex items-center justify-between"><div><div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Billing</div><div className="text-xl font-black text-slate-900">Invoices</div></div></div>
                {ctrl.policyInvoices.length === 0 ? (
                  <div className="text-slate-500 font-semibold">No invoices associated with this policy yet.</div>
                ) : (
                  <div className="space-y-3">
                    {ctrl.policyInvoices.map((inv) => (
                      <Card key={inv.id} className="p-4 flex items-center justify-between gap-4">
                        <div><div className="text-sm font-black text-slate-900">Invoice {String(inv.id).slice(0, 8).toUpperCase()}</div><div className="text-xs text-slate-500 font-semibold mt-1">Due {inv.dueDate ? formatDateUI(inv.dueDate) : '—'} • Status {inv.status}</div></div>
                        <div className="text-right"><div className="text-sm font-black text-slate-900">{formatMoneyUI(inv.amount || 0, 'USD')}</div></div>
                      </Card>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          )}

          {ctrl.activeTab === 'Claims' && (
            <Card className="ui-card-pad space-y-6 border-none">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div><div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Claims</div><div className="mt-2 text-xl font-black text-slate-900">Status and updates</div></div>
                <Button size="lg" onClick={ctrl.goToFileClaim}>File a claim</Button>
              </div>
              {ctrl.policyClaims.length === 0 ? (
                <div className="text-slate-500 font-semibold">No claims filed for this policy.</div>
              ) : (
                <div className="space-y-3">
                  {ctrl.policyClaims.map((c) => (
                    <Card key={c.id} className="p-4 flex items-center justify-between gap-4">
                      <div><div className="text-sm font-black text-slate-900">{c.claimNumber || String(c.id).slice(0, 8).toUpperCase()}</div><div className="text-xs text-slate-500 font-semibold mt-1">Filed {formatDateUI(c.reportedDate || c.createdAt || c.incidentDate)} • {c.claimType}</div></div>
                      <Badge variant="warning">{getClaimStatusLabel(String(c.status || 'Submitted'))}</Badge>
                    </Card>
                  ))}
                </div>
              )}
            </Card>
          )}

        </>
      )}
    </div>
  );
}

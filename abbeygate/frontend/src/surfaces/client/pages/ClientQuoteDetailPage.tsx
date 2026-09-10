import React from 'react';
import { PageHeader } from '@/src/shared/ui';
import { Button, Card } from '@/src/shared/ui';
import { FileUpload } from '@/src/shared/ui';
import { formatDateRangeUI, formatDateUI, formatMoneyUI } from '@/src/shared/lib/format';

import { useClientQuoteDetailController } from '../controller/useClientQuoteDetailController';
import type { QuoteDetailTab } from '../controller/useClientQuoteDetailController';

const TABS: QuoteDetailTab[] = ['Overview', 'Details', 'Documents', 'Billing'];

export default function ClientQuoteDetailPage() {
  const ctrl = useClientQuoteDetailController();

  return (
    <div className="ui-page max-w-7xl mx-auto space-y-10">
      <PageHeader
        breadcrumb={{ label: 'Back to quotes', onClick: ctrl.goBackToQuotes }}
        title={ctrl.loading ? 'Quote' : ctrl.view.insured}
        subtitle={`Quote ${ctrl.view.policyNumber} • ${formatDateRangeUI(ctrl.view.start, ctrl.view.end)}`}
        status={{ label: ctrl.view.status, tone: 'warning' }}
        actions={(<Button size="lg" onClick={() => void ctrl.approveAndBind()} disabled={ctrl.binding}>{ctrl.binding ? 'Binding…' : 'Approve & bind'}</Button>)}
      />

      <div className="ui-tabsbar">
        {TABS.map((t) => (<Button key={t} onClick={() => ctrl.setActiveTab(t)} variant="tab" size="tab" className={`ui-tab ${ctrl.activeTab === t ? 'ui-tab-active' : 'ui-tab-inactive'}`}>{t}</Button>))}
      </div>

      {ctrl.loading ? (
        <div className="text-slate-400 font-medium">Loading…</div>
      ) : !ctrl.policy ? (
        <div className="text-slate-400 font-medium">Quote not found.</div>
      ) : (
        <>
          {ctrl.activeTab === 'Overview' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <Card className="-pad border-none lg:col-span-2">
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Summary</div>
                <div className="mt-2 text-xl font-black text-slate-900">Auto Insurance</div>
                <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5">
                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Estimated premium</div>
                    <div className="mt-2 text-2xl font-black text-slate-900">{formatMoneyUI(ctrl.view.premium, 'USD')}</div>
                    <div className="text-xs text-slate-500 font-semibold mt-2">Billed based on your selected plan after binding.</div>
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5">
                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Next steps</div>
                    <ul className="mt-3 space-y-2 text-sm font-semibold text-slate-700"><li>1) Approve & bind</li><li>2) Upload required documents</li><li>3) Billing setup (if required)</li></ul>
                  </div>
                </div>
              </Card>
              <Card className="-pad border-none">
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Checklist</div>
                <div className="mt-2 text-lg font-black text-slate-900">Ready to bind</div>
                <div className="mt-6 space-y-3 text-sm font-semibold text-slate-700">
                  <div className="flex items-center justify-between"><span>Client details</span><span className="text-brand-primary font-black">OK</span></div>
                  <div className="flex items-center justify-between"><span>Documents</span><span className="text-amber-700 font-black">{ctrl.quoteDocs.length ? 'Uploaded' : 'Pending'}</span></div>
                  <div className="flex items-center justify-between"><span>Billing</span><span className="text-slate-500 font-black">Not required</span></div>
                </div>
              </Card>
            </div>
          )}

          {ctrl.activeTab === 'Details' && (
            <Card className="-pad border-none">
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Details</div>
              <div className="mt-2 text-xl font-black text-slate-900">Submitted information</div>
              <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="border border-slate-200 rounded-2xl p-5 bg-white/60"><div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Named insured</div><div className="mt-2 text-sm font-bold text-slate-800">{ctrl.view.insured}</div></div>
                <div className="border border-slate-200 rounded-2xl p-5 bg-white/60"><div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Effective</div><div className="mt-2 text-sm font-bold text-slate-800">{formatDateRangeUI(ctrl.view.start, ctrl.view.end)}</div></div>
              </div>
              <div className="mt-6 text-sm text-slate-500 font-semibold">Contact your broker for changes to submitted information.</div>
            </Card>
          )}

          {ctrl.activeTab === 'Documents' && (
            <Card className="-pad border-none space-y-6">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div><div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Documents</div><div className="mt-2 text-xl font-black text-slate-900">Uploads and requests</div></div>
                <FileUpload label={ctrl.uploading ? 'Uploading…' : 'Upload document'} buttonSize="lg" disabled={ctrl.uploading} onFileSelect={(f) => { if (f[0]) void ctrl.uploadDoc(f[0]); }} />
              </div>
              {ctrl.quoteDocs.length === 0 ? (
                <div className="text-slate-500 font-semibold">No documents uploaded yet for this quote.<div className="text-slate-400 text-sm mt-1">Upload any requested items (loss runs, screening policy, unit mix report).</div></div>
              ) : (
                <div className="space-y-3">
                  {ctrl.quoteDocs.map((d) => (
                    <div key={d.id} className="p-4 rounded-2xl border border-slate-200 bg-white flex items-center justify-between gap-4">
                      <div><div className="text-sm font-black text-slate-900">{d.name}</div><div className="text-xs text-slate-500 font-semibold mt-1">Uploaded {formatDateUI(d.uploadedAt, { withTime: true })}</div></div>
                      <a className="text-brand-primary font-black text-xs uppercase tracking-widest hover:underline" href={d.url} target="_blank" rel="noreferrer">Download</a>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          {ctrl.activeTab === 'Billing' && (
            <Card className="-pad border-none"><div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Billing</div><div className="mt-2 text-xl font-black text-slate-900">Payment setup</div><div className="mt-6 text-sm font-semibold text-slate-600">Billing setup becomes available after the quote is bound.</div></Card>
          )}
        </>
      )}
    </div>
  );
}

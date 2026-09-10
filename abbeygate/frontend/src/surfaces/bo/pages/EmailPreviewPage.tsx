import React from 'react';
import { PageHeader, Button, Toast } from '@/src/shared/ui';
import { useEmailPreviewController } from '@/src/modules/communications/hooks/useEmailPreviewController';

function approvalTone(status: string | null): string {
  const s = String(status || '').toUpperCase();
  if (s === 'APPROVED') return 'bg-emerald-100 text-emerald-800';
  if (s === 'DRAFT') return 'bg-amber-100 text-amber-800';
  if (s === 'REJECTED') return 'bg-rose-100 text-rose-800';
  return 'bg-slate-100 text-slate-600';
}

/**
 * Thin composition shell for the Email Preview & Testing Centre. All data
 * loading, selection, jurisdiction switching and the audited test-send workflow
 * live in `useEmailPreviewController` (communications module) — the surface only
 * composes presentation (surfaces contract: no business logic in surfaces).
 */
const EmailPreviewPage: React.FC = () => {
  const {
    jurisdictions,
    inventory,
    directProducers,
    coverage,
    selected,
    jurisdiction,
    preview,
    loading,
    previewLoading,
    error,
    testEmail,
    testBusy,
    toast,
    lintErrors,
    lintWarnings,
    refresh,
    selectTemplate,
    setJurisdiction,
    setTestEmail,
    sendTest,
    dismissToast,
  } = useEmailPreviewController();

  return (
    <div className="ui-page max-w-7xl mx-auto space-y-6">
      <Toast message={toast} isVisible={Boolean(toast)} onClose={dismissToast} type="success" />
      <PageHeader
        title="Email Preview & Testing Centre"
        subtitle="Inspect every system email from safe fixtures. Preview-only by default; test sends are synthetic and restricted to allowlisted mailboxes."
        actions={<Button variant="secondary" onClick={() => void refresh()} disabled={loading}>Refresh</Button>}
      />

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-800">{error}</div>
      )}

      {coverage && (
        <div className="ui-card ui-card-pad flex flex-wrap items-center gap-6 text-sm font-semibold">
          <span className="text-slate-500">Coverage</span>
          <span className="text-slate-900">{coverage.summary.total} previewable templates</span>
          <span className="text-emerald-700">{coverage.summary.clean} clean</span>
          <span className={coverage.summary.withErrors > 0 ? 'text-rose-700' : 'text-slate-400'}>
            {coverage.summary.withErrors} with errors
          </span>
          <span className="text-slate-400">{coverage.summary.directProducers} direct sender(s)</span>
          <span className="ml-auto font-mono text-xs text-slate-400">build: {coverage.generatedShaAtRuntime}</span>
        </div>
      )}

      {loading ? (
        <div className="ui-card ui-card-pad text-sm font-semibold text-slate-500">Loading email inventory...</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="ui-card ui-card-pad space-y-1 lg:col-span-1 max-h-[70vh] overflow-auto">
            {inventory.map((item) => {
              const active = item.templateKey === selected;
              return (
                <button
                  key={item.templateKey}
                  type="button"
                  onClick={() => selectTemplate(item.templateKey)}
                  className={`w-full rounded-xl px-3 py-2 text-left transition ${active ? 'bg-brand-primary text-white' : 'hover:bg-slate-100 text-slate-800'}`}
                >
                  <div className="text-sm font-bold">{item.templateName}</div>
                  <div className={`text-[11px] font-mono ${active ? 'text-white/80' : 'text-slate-500'}`}>{item.templateKey}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {item.systemOnly && (
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${active ? 'bg-white/20' : 'bg-slate-200 text-slate-700'}`}>SYSTEM</span>
                    )}
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${active ? 'bg-white/20 text-white' : approvalTone(item.governance.approvalStatus)}`}>
                      {item.governance.approvalStatus || 'CODE'}
                    </span>
                  </div>
                </button>
              );
            })}

            {directProducers.length > 0 && (
              <div className="mt-3 border-t border-slate-100 pt-3">
                <div className="px-3 text-[10px] font-black uppercase tracking-widest text-slate-400">
                  Direct senders (not previewable)
                </div>
                {directProducers.map((p) => (
                  <div key={p.id} className="rounded-xl px-3 py-2 text-left">
                    <div className="text-sm font-bold text-slate-700">{p.id}</div>
                    <div className="text-[11px] font-mono text-slate-500">{p.source}</div>
                    <div className="mt-1 text-[11px] font-semibold text-slate-400">{p.reason}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="lg:col-span-2 space-y-4">
            <div className="ui-card ui-card-pad flex flex-wrap items-center gap-3">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Jurisdiction</span>
              {jurisdictions.map((j) => (
                <button
                  key={j}
                  type="button"
                  onClick={() => setJurisdiction(j)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-bold transition ${jurisdiction === j ? 'bg-brand-primary text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                >
                  {j}
                </button>
              ))}
            </div>

            {previewLoading || !preview ? (
              <div className="ui-card ui-card-pad text-sm font-semibold text-slate-500">
                {previewLoading ? 'Rendering preview...' : 'Select a template to preview.'}
              </div>
            ) : (
              <>
                <div className="ui-card ui-card-pad space-y-3">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Subject</div>
                    <div className="mt-1 text-sm font-bold text-slate-900">{preview.subject}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs font-semibold text-slate-600 sm:grid-cols-3">
                    <div><span className="text-slate-400">Version:</span> {preview.governance.version ?? '—'}</div>
                    <div>
                      <span className="text-slate-400">Approval:</span>{' '}
                      <span className={`rounded px-1.5 py-0.5 ${approvalTone(preview.governance.approvalStatus)}`}>
                        {preview.governance.approvalStatus || 'CODE_ONLY'}
                      </span>
                    </div>
                    <div><span className="text-slate-400">Last editor:</span> {preview.governance.lastEditor || '—'}</div>
                    <div className="col-span-2 sm:col-span-3 font-mono text-[11px]">
                      <span className="text-slate-400">Deploy SHA:</span> {preview.governance.lastDeployedSha || '—'}
                    </div>
                  </div>

                  {(lintErrors.length > 0 || lintWarnings.length > 0) ? (
                    <div className="space-y-1">
                      {lintErrors.map((f) => (
                        <div key={f.code} className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800">
                          {f.message}{f.detail ? `: ${f.detail}` : ''}
                        </div>
                      ))}
                      {lintWarnings.map((f) => (
                        <div key={f.code} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                          {f.message}{f.detail ? `: ${f.detail}` : ''}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
                      No lint issues — variables resolved, links absolute, logo present.
                    </div>
                  )}
                </div>

                <div className="ui-card overflow-hidden">
                  <iframe
                    title="email-preview"
                    className="h-[520px] w-full border-0 bg-white"
                    sandbox=""
                    srcDoc={preview.bodyHtml}
                  />
                </div>

                <div className="ui-card ui-card-pad space-y-3">
                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                    Send test (synthetic · allowlisted mailboxes only)
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <input
                      type="email"
                      value={testEmail}
                      onChange={(e) => setTestEmail(e.target.value)}
                      placeholder="test.mailbox@allowlisted.domain"
                      className="flex-1 min-w-[240px] rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800"
                    />
                    <Button
                      variant="primary"
                      disabled={testBusy || !testEmail.trim()}
                      onClick={() => void sendTest()}
                    >
                      {testBusy ? 'Sending...' : 'Send test email'}
                    </Button>
                  </div>
                  <p className="text-xs font-semibold text-slate-400">
                    Test emails are marked [SYNTHETIC TEST], never create a policy, are pinned to your operating tenant, and are refused for non-allowlisted addresses.
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default EmailPreviewPage;

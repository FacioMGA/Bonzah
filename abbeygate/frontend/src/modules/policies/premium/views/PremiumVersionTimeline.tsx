import React from 'react';
import { Button } from '@/src/shared/ui';
import { SearchableSelect as UiSearchableSelect } from '@/src/shared/ui';
import { asRecord } from '@/src/shared/lib/record';

type PolicyVersionRow = {
  riskTransactionId?: string;
  transactionType?: string;
  transactionTypeDisplay?: string;
  status?: string;
  transactionNumber?: string | number;
  effectiveDate?: string | Date;
  premiumSnapshot?: number | null;
  bdxRows?: Array<Record<string, unknown>>;
};

type PremiumVersionTimelineProps = {
  selectedPortfolio?: Record<string, unknown>;
  currency?: string;
  excessValue?: number;
  isIssuedRecordMode?: boolean;
  isIssuedLifecycle?: boolean;
  endorsementDraftRiskTransactionId?: string | null;
  viewingVersionId?: string | null;
  setViewingVersionId: (id: string | null) => void;
  viewingRiskTransactionId?: string | null;
  setViewingRiskTransactionId: (id: string | null) => void;
  viewingRiskTransactionSnapshot?: Record<string, unknown> | null;
  latestIssuedRiskTransactionId?: string | null;
  policyVersions?: PolicyVersionRow[];
  setShowRestoreVersionModal: (open: boolean) => void;
  setShowCreateEndorsementModal: (open: boolean) => void;
  setEndorsementEffectiveDate: (value: string) => void;
  setEndorsementReason: (value: string) => void;
  handleCancelEndorsementDraft: () => void;
  isCancellingEndorsementDraft?: boolean;
  isBindingEndorsementDraft?: boolean;
  isIssuingEndorsement?: boolean;
};

export function PremiumVersionTimeline(props: PremiumVersionTimelineProps) {
  const {
    // Context
    selectedPortfolio,
    currency,

    // State
    isIssuedRecordMode,
    isIssuedLifecycle,
    endorsementDraftRiskTransactionId,
    viewingVersionId,
    setViewingVersionId,
    viewingRiskTransactionId,
    setViewingRiskTransactionId,
    viewingRiskTransactionSnapshot,
    latestIssuedRiskTransactionId,
    policyVersions,

    // Modals + actions
    setShowRestoreVersionModal,
    setShowCreateEndorsementModal,
    setEndorsementEffectiveDate,
    setEndorsementReason,
    handleCancelEndorsementDraft,
    isCancellingEndorsementDraft,
    isBindingEndorsementDraft,
    isIssuingEndorsement,
  } = props;

  return (
    <>
      {/* Draft version selector (quote drafts pre-issue; endorsement drafts post-issue) */}
      {!isIssuedRecordMode && (
        <div className="mt-8">
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div className="relative group/field flex-1 max-w-sm">
              <label className="absolute -top-2.5 left-4 bg-brand-canvas px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10 transition-colors group-focus-within/field:text-brand-primary">
                {isIssuedLifecycle ? 'Endorsement draft' : 'Draft version'}
              </label>
              <UiSearchableSelect
                value={isIssuedLifecycle ? (endorsementDraftRiskTransactionId || '') : (viewingVersionId || '')}
                onChange={(v) => {
                  if (isIssuedLifecycle) {
                    setViewingVersionId(null);
                    setViewingRiskTransactionId(v || null);
                  } else {
                    setViewingVersionId(v || null);
                  }
                }}
                options={
                  isIssuedLifecycle
                    ? [
                        { value: '', label: 'No draft selected' },
                        ...((() => {
                          const drafts = (policyVersions || [])
                            .filter((pv) => String(pv?.transactionType || '').toUpperCase() === 'ENDORSEMENT' && String(pv?.status || '').toUpperCase() === 'DRAFT')
                            .sort((a, b) => {
                              const aNo = Number(a?.transactionNumber || 0);
                              const bNo = Number(b?.transactionNumber || 0);
                              if (Number.isFinite(aNo) && Number.isFinite(bNo) && aNo !== bNo) return bNo - aNo;
                              const aTs = a?.effectiveDate ? new Date(String(a.effectiveDate)).getTime() : 0;
                              const bTs = b?.effectiveDate ? new Date(String(b.effectiveDate)).getTime() : 0;
                              if (aTs !== bTs) return bTs - aTs;
                              return String(b?.riskTransactionId || '').localeCompare(String(a?.riskTransactionId || ''));
                            });
                          return drafts.map((pv, idx) => {
                            const txNo = pv?.transactionNumber ?? '—';
                            const eff = pv?.effectiveDate ? new Date(pv.effectiveDate).toISOString().slice(0, 10) : '';
                            const prem = pv?.premiumSnapshot;
                            const premText = (prem === null || prem === undefined) ? 'N/A' : `€${Number(prem).toFixed(2)}`;
                            const latestTag = idx === 0 ? 'LATEST — ' : '';
                            return {
                              value: String(pv?.riskTransactionId || ''),
                              label: `${latestTag}#${txNo} — DRAFT${eff ? ` — ${eff}` : ''} — ${premText}`,
                            };
                          })
                          .filter((o) => Boolean(o.value));
                        })()),
                      ]
                    : [
                        { value: '', label: 'Current Draft (Latest)' },
                        ...(((selectedPortfolio?.quoteHistory || []) as Array<Record<string, unknown>>).map((h) => {
                          const snapshot = asRecord(h.snapshot);
                          const quoteResponse = asRecord(snapshot.quoteResponse);
                          const primaryOption = asRecord(quoteResponse.primaryOption);
                          const prem =
                            primaryOption.annualPremium ??
                            primaryOption.totalPremium ??
                            quoteResponse.annualPremium;
                          const premText = prem ? `€${Number(prem).toFixed(2)}` : 'N/A';
                          return {
                            value: String(h.id || ''),
                            label: `v${String(h.version || '')} — ${new Date(String(h.archivedAt || '')).toLocaleString()} — ${premText}`,
                          };
                        })),
                      ]
                }
                placeholder={isIssuedLifecycle ? 'Select endorsement draft…' : 'Select draft…'}
                searchPlaceholder={isIssuedLifecycle ? 'Search endorsement drafts…' : 'Search drafts…'}
              />
            </div>

            {isIssuedLifecycle && Boolean(endorsementDraftRiskTransactionId) && (
              <div className="flex items-end">
                <Button
                  variant="secondary"
                  size="md"
                  className="gap-2 h-controlXs px-5 rounded-2xl text-[11px] font-black uppercase tracking-widest"
                  onClick={handleCancelEndorsementDraft}
                  isLoading={isCancellingEndorsementDraft}
                  disabled={isCancellingEndorsementDraft || isBindingEndorsementDraft || isIssuingEndorsement}
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12" />
                  </svg>
                  Cancel endorsement
                </Button>
              </div>
            )}

            {/* Quote-only restore controls (pre-issue) */}
            {!isIssuedLifecycle && viewingVersionId && (
              <div className="flex items-center gap-3">
                <div className="px-3 py-2 rounded-2xl bg-orange-100 text-orange-800 text-[10px] font-black uppercase tracking-widest flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-orange-600 animate-pulse" />
                  Viewing Historical Version (Read-Only)
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowRestoreVersionModal(true)}
                  className="px-4 py-2 rounded-2xl bg-brand-primary/10 text-brand-primary text-[10px] font-black uppercase tracking-widest hover:bg-brand-primary/15 transition-colors"
                >
                  Restore this version
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setViewingVersionId(null)}
                  className="text-xs font-bold text-slate-500 hover:text-brand-primary underline decoration-2 underline-offset-4 transition-colors bg-transparent !p-0"
                >
                  Return to Current
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Issued Policy Version Selector (RiskTransaction ledger) */}
      {isIssuedLifecycle && !endorsementDraftRiskTransactionId && (
        <div className="mt-8 space-y-5">
          <div className="flex items-end justify-between gap-6 flex-wrap">
            <div className="relative group/field flex-1 max-w-sm">
              <label className="absolute -top-2.5 left-4 bg-brand-canvas px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10 transition-colors group-focus-within/field:text-brand-primary">
                Issued policy version
              </label>
              <UiSearchableSelect
                value={viewingRiskTransactionId || latestIssuedRiskTransactionId || ''}
                onChange={(v) => setViewingRiskTransactionId(v || null)}
                options={[
                  ...(policyVersions || [])
                    .filter((pv) => String(pv?.status || '').toUpperCase() === 'BOUND')
                    .map((v) => {
                      const txNo = v?.transactionNumber ?? '—';
                      const ty = String(v?.transactionTypeDisplay || v?.transactionType || '').toUpperCase();
                      const st = String(v?.status || '').toUpperCase();
                      const eff = v?.effectiveDate ? new Date(v.effectiveDate).toISOString().slice(0, 10) : '';
                      const prem = v?.premiumSnapshot;
                      const premText = (prem === null || prem === undefined) ? 'N/A' : `€${Number(prem).toFixed(2)}`;
                      const label = `#${txNo} — ${ty} — ${st}${eff ? ` — ${eff}` : ''} — ${premText}`;
                      return { value: String(v?.riskTransactionId || ''), label };
                    })
                    .filter((o) => Boolean(o.value)),
                ]}
                placeholder="Select version…"
                searchPlaceholder="Search versions…"
              />
            </div>

            {isIssuedRecordMode && !viewingVersionId && (
              <div className="flex items-center justify-end">
                <Button
                  variant="primary"
                  size="lg"
                  className="gap-2"
                  onClick={() => {
                    setEndorsementEffectiveDate(new Date().toISOString().slice(0, 10));
                    setEndorsementReason('');
                    setShowCreateEndorsementModal(true);
                  }}
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14" />
                  </svg>
                  Create endorsement
                </Button>
              </div>
            )}

            {endorsementDraftRiskTransactionId && (
              <div className="px-4 py-3 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 text-sm font-bold">
                {(() => {
                  const eff = viewingRiskTransactionSnapshot?.effectiveDate ? new Date(String(viewingRiskTransactionSnapshot.effectiveDate)).toISOString().slice(0, 10) : '';
                  return (
                    <>
                      You are working on an endorsement to Policy {String(selectedPortfolio?.policyNumber || selectedPortfolio?.id)}
                      {eff ? ` (effective ${eff})` : ''}
                    </>
                  );
                })()}
              </div>
            )}
          </div>

          {/* Risk transactions history table (issued versions only) */}
          {!endorsementDraftRiskTransactionId && (
            <div className="ui-table-wrap">
              <div className="px-10 py-6 bg-slate-50/60 border-b border-slate-200/60 flex items-center justify-between gap-4 flex-wrap">
                <div className="text-[11px] font-black text-slate-600 uppercase tracking-widest">Risk transactions history</div>
                <div className="text-xs font-bold text-slate-400">&nbsp;</div>
              </div>
              <div className="overflow-auto">
                <table className="ui-table min-w-tableWide">
                  <thead className="ui-thead">
                    <tr>
                      <th className="px-10 py-6 w-[22%]">Section</th>
                      <th className="px-10 py-6 w-[18%] whitespace-nowrap">Risk Trans. Type</th>
                      <th className="px-10 py-6 w-[16%] whitespace-nowrap">Eff. Date</th>
                      <th className="px-10 py-6 w-[22%]">Limit</th>
                      <th className="px-10 py-6 w-[10%]">Excess</th>
                      <th className="px-10 py-6 w-[12%] text-right">Premium</th>
                    </tr>
                  </thead>
                  <tbody className="ui-tbody text-sm">
                    {(() => {
                      const bound = (policyVersions || []).filter((v) => String(v?.status || '').toUpperCase() === 'BOUND');
                      const rows = bound.flatMap((v) => (Array.isArray(v?.bdxRows) ? v.bdxRows : []));

                      const fmtDate = (d: unknown) => {
                        const dt = d ? new Date(String(d)) : null;
                        if (!dt || Number.isNaN(dt.getTime())) return '—';
                        return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(dt);
                      };
                      const fmtPremium = (n: unknown, ccy: string) => {
                        const v = Number(n);
                        if (!Number.isFinite(v)) return '—';
                        const abs = Math.abs(v).toFixed(2);
                        const sym = ccy === 'EUR' ? '€' : `${ccy} `;
                        return v < 0 ? `(${sym}${abs})` : `${sym}${abs}`;
                      };

                      return rows.map((r, idx: number) => {
                        const row = asRecord(r);
                        const rtId = String(row.riskTransactionId || '');

                        return (
                          <tr
                            key={`${rtId}:${String(row.section || '')}:${idx}`}
                            className="ui-row"
                          >
                            <td className="px-10 py-6 text-slate-900 font-black">{String(row.section || '—')}</td>
                            <td className="px-10 py-6 text-slate-700 font-semibold">{String(row.riskTransType || '—')}</td>
                            <td className="px-10 py-6 text-slate-700 font-semibold whitespace-nowrap">{fmtDate(row.effectiveDate)}</td>
                            <td className="px-10 py-6 text-slate-700 font-semibold">{String(row.limitText || '—')}</td>
                            <td className="px-10 py-6 text-slate-700 font-semibold">{String(row.excessText || '—')}</td>
                            <td className="px-10 py-6 text-right font-black tabular-nums text-slate-900">
                              {fmtPremium(row.premium, String(row.currency || currency || 'EUR'))}
                            </td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}


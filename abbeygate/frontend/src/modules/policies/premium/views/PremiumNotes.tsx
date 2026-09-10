import React from 'react';
import { policyCrudApiClient } from '../../api/policyCrudApiClient';
import { Button } from '@/src/shared/ui';

import { logger } from '@/src/shared/lib/logger';
import { asRecord } from '@/src/shared/lib/record';
import { filterOperatorVisibleBlockers } from '../../model/issueReadinessDisplay';
import { needsPricingAdjustmentReason } from '../domain/adjustments';
import { SanctionsHitRow, type SanctionsFirstHit } from '../../compliance/views/SanctionsHitRow';

type BlockerAction = { label?: string; actionId?: string; href?: string; hash?: string };
type IssueBlocker = { code?: string; message?: string; group?: string; severity?: string; actions?: BlockerAction[]; actionId?: string; href?: string; hash?: string; label?: string; details?: Record<string, unknown> };
type PortfolioLike = { id: string; policyId?: string; quoteData?: Record<string, unknown> };
type PremiumNotesProps = {
  selectedPortfolio: PortfolioLike;
  viewingVersionId?: string | null;
  viewingRiskTransactionId?: string | null;
  issueReadiness?: { blockers?: IssueBlocker[] } | null;
  issueReadinessLoading?: boolean;
  handleReRate: () => void;
  handleSendQuestionnaire: () => void;
  reloadCurrentPolicy: () => Promise<void>;
  refreshIssueReadiness: (policyId: string) => Promise<void>;
  openQuoteWizard: (policyId: string, hash: string) => void;
  isEndorsementMode?: boolean;
  isIssuedRecordMode?: boolean;
};

export function PremiumNotes(props: PremiumNotesProps) {
  const {
    selectedPortfolio,
    viewingVersionId,
    viewingRiskTransactionId,
    issueReadiness,
    issueReadinessLoading,
    handleReRate,
    handleSendQuestionnaire,
    reloadCurrentPolicy,
    refreshIssueReadiness,
    openQuoteWizard,
    isEndorsementMode,
  } = props;

  if (Boolean(props.isIssuedRecordMode)) return null;

  const qdOuter = asRecord(selectedPortfolio?.quoteData);
  const needsUwReasonOuter = needsPricingAdjustmentReason(qdOuter);

  const visibleBlockers = Array.isArray(issueReadiness?.blockers) ? filterOperatorVisibleBlockers(issueReadiness.blockers) : [];
  const blockerCount = visibleBlockers.length;
  if (!(blockerCount > 0 || needsUwReasonOuter)) return null;

  const isQuoteHistoryHistorical = Boolean(viewingVersionId);
  const isRiskTxnVersionView = Boolean(viewingRiskTransactionId);

  return (
    <div className="ui-card ui-card-pad">
      <div className="ui-section-title">Important notes</div>
      <div className="mt-4 space-y-6">
        {needsUwReasonOuter ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <div className="text-xs font-semibold text-amber-900/90">
              Underwriting adjustment requires a reason (you can still recalculate, but issuing should remain blocked until a reason is added).
            </div>
          </div>
        ) : null}

        {issueReadinessLoading ? (
          <div className="text-xs font-semibold text-slate-500">Checking readiness…</div>
        ) : (blockerCount > 0) ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <div className="text-[10px] font-black uppercase tracking-widest text-amber-900">Blockers</div>
            {(() => {
              const runAction = (a: BlockerAction | undefined) => {
                if (!a) return;
                if (a.actionId === 'BO.RECALC_PREMIUM') return handleReRate();
                if (a.actionId === 'BO.SEND_QUESTIONNAIRE') return handleSendQuestionnaire();
                if (a.actionId === 'BO.MANUAL_UW_APPROVAL') {
                  (async () => {
                    try {
                      const res = await policyCrudApiClient.manualUwApproval(selectedPortfolio.id);
                      if (!res?.success) throw new Error(res?.error?.message || 'Failed to approve manually');
                      await reloadCurrentPolicy();
                      await refreshIssueReadiness(selectedPortfolio.id);
                    } catch (e) {
                      logger.error('Failed to approve manually', e);
                    }
                  })();
                  return;
                }
                if (a.href) return window.open(a.href, '_blank', 'noopener,noreferrer');
                if (a.actionId === 'BO.OPEN_CUSTOMER_QUOTE') {
                  const h = a.hash || 'your-quote';
                  openQuoteWizard(String(selectedPortfolio?.policyId || selectedPortfolio.id), h);
                  return;
                }
                if (a.actionId === 'BO.OPEN_PAYMENT') {
                  openQuoteWizard(String(selectedPortfolio?.policyId || selectedPortfolio.id), 'payment');
                  return;
                }
              };

              const combined = visibleBlockers;
              const order = ['STATUS', 'UNDERWRITING', 'PRICING', 'DOCUMENTS', 'PAYMENT', 'LOCK', 'OTHER'];
              const byGroup = combined.reduce<Record<string, IssueBlocker[]>>((acc, b) => {
                const g = String(b.group || 'OTHER');
                acc[g] = acc[g] || [];
                acc[g].push(b);
                return acc;
              }, {});

              const computedGroups = order
                .filter((k) => Array.isArray(byGroup[k]) && byGroup[k].length > 0)
                .map((k) => ({ group: k, blockers: byGroup[k] }));

              return (
                <div className="mt-2 space-y-3">
                  {computedGroups.map(({ group, blockers }) => (
                    <div key={group} className="space-y-2">
                      <div className="text-[10px] font-black uppercase tracking-widest text-amber-800">{group}</div>
                      <ul className="space-y-2">
                        {blockers.map((b, idx: number) => (
                          <li key={idx} className="text-xs font-semibold text-amber-900/90">
                            <span>{b.message || b.code || 'Unknown blocker'}</span>
                            {(b.code === 'SANCTIONS_BLOCKED' || b.code === 'SANCTIONS_PROVIDER_UNAVAILABLE' || b.code === 'SANCTIONS_EVIDENCE_MISSING') ? (
                              <span className="ml-2 text-[10px] font-black uppercase tracking-wider text-amber-700">
                                {[
                                  String(asRecord(b.details).providerSearchId || '').trim() ? `Ref ${String(asRecord(b.details).providerSearchId)}` : 'Missing search ref',
                                  String(asRecord(b.details).providerRiskRating || '').trim() ? `Score ${String(asRecord(b.details).providerRiskRating)}` : 'Missing score',
                                ].join(' · ')}
                              </span>
                            ) : null}
                            {b.code === 'SANCTIONS_BLOCKED' ? (() => {
                              const detailsRec = asRecord(b.details);
                              const firstHit = asRecord(detailsRec.firstHit) as SanctionsFirstHit;
                              if (!firstHit?.hitId) return null;
                              return (
                                <SanctionsHitRow
                                  firstHit={firstHit}
                                  reportFilename={typeof detailsRec.reportFilename === 'string' ? detailsRec.reportFilename : null}
                                  providerSearchId={typeof detailsRec.providerSearchId === 'string' ? detailsRec.providerSearchId : null}
                                />
                              );
                            })() : null}
                            {(() => {
                              const actions: BlockerAction[] =
                                Array.isArray(b?.actions) && b.actions.length
                                  ? b.actions
                                  : (b.actionId || b.href)
                                    ? [{ label: b.label || 'Fix', actionId: b.actionId, href: b.href, hash: b.hash }]
                                    : [];
                              if (actions.length === 0) return null;

                              // Quote history snapshots are never actionable. Endorsement drafts *are* actionable even though they use a RiskTransaction view.
                              const disabled = isQuoteHistoryHistorical || (isRiskTxnVersionView && !Boolean(isEndorsementMode));
                              const title = disabled ? 'Switch to current version to run actions' : undefined;

                              return (
                                <span className="ml-2 inline-flex items-center gap-2 flex-wrap">
                                  {actions.map((a, i) => (
                                    <Button
                                      key={i}
                                      onClick={() => runAction(a)}
                                      size="sm"
                                      variant="secondary"
                                      className="!px-2.5 !py-1 !text-[10px] !rounded-lg bg-amber-900 text-amber-50 border border-amber-900/10 hover:bg-amber-800 hover:text-amber-50 shadow-sm"
                                      disabled={disabled}
                                      title={title}
                                    >
                                      {a?.label || 'Fix'}
                                    </Button>
                                  ))}
                                </span>
                              );
                            })()}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        ) : null}
      </div>
    </div>
  );
}


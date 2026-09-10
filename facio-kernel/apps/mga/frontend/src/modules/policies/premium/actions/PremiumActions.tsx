import React from 'react';
import { RotateCcw, Unlock } from 'lucide-react';
import { Button } from '@/src/shared/ui';
import { formatDateUI } from '@/src/shared/lib/format';
import { policyDisplayStatus } from '@/src/modules/policies/model/policyStateFlag';
import { asRecord } from '@/src/shared/lib/record';
import { hasOnlyAutoRefreshPricingBlockers } from '../../model/issueReadinessDisplay';

// UI mirror of the lifecycle states that can transition to QUOTED. The
// backend state machine remains the enforcement point before any email is
// queued; this prevents presenting an action that is guaranteed to be refused.
const QUOTE_SENDABLE_STATUSES = new Set(['DRAFT', 'INTAKE', 'REFERRAL', 'INFO_REQUIRED', 'QUOTED', 'AWAITING_PAYMENT']);

type PremiumActionsProps = {
  selectedPortfolio?: Record<string, unknown>;
  viewingVersionId?: string | null;
  viewingRiskTransactionSnapshot?: Record<string, unknown> | null;
  viewingRiskTransactionId?: string | null;
  issueReadiness?: { canIssue?: boolean; blockers?: unknown[] } | null;
  quoteSentAt?: string | number | Date | null;
  quoteSentKey?: string | null;
  canSaveQuoteVersion?: boolean;
  handleReRate: () => void;
  isReRating?: boolean;
  handleSaveQuoteVersion: () => void;
  isSavingQuoteVersion?: boolean;
  handleUnlockBoundMode: () => void;
  isUnlockingBoundMode?: boolean;
  setEndorsementEffectiveDate: (value: string) => void;
  setEndorsementReason: (value: string) => void;
  setShowCreateEndorsementModal: (value: boolean) => void;
  handleIssueQuote: () => void;
  isIssuingQuote?: boolean;
  quoteActionDisabledReason?: string | null;
  handleBindCoverage: () => void;
  isBindingCoverage?: boolean;
  handleIssuePolicyFinal: () => void;
  isIssuingPolicyFinal?: boolean;
  handleBindEndorsementDraft: () => void;
  isBindingEndorsementDraft?: boolean;
  handleIssueEndorsement: () => void;
  isIssuingEndorsement?: boolean;
  isCancellationEndorsement?: boolean;
  quoteActionLabel?: string;
  hidePricingControls?: boolean;
  forceShowQuoteAction?: boolean;
  canBindAuthority?: boolean;
  canIssueAuthority?: boolean;
  latestIssuedRiskTransactionId?: string | null;
};

export function PremiumActions(props: PremiumActionsProps) {
  const {
    selectedPortfolio,
    viewingVersionId,
    viewingRiskTransactionSnapshot,
    viewingRiskTransactionId,
    issueReadiness,
    quoteSentAt,
    quoteSentKey,
    canSaveQuoteVersion,
    handleReRate,
    isReRating,
    handleSaveQuoteVersion,
    isSavingQuoteVersion,
    handleUnlockBoundMode,
    isUnlockingBoundMode,
    setEndorsementEffectiveDate,
    setEndorsementReason,
    setShowCreateEndorsementModal,
    handleIssueQuote,
    isIssuingQuote,
    quoteActionDisabledReason,
    handleBindCoverage,
    isBindingCoverage,
    handleIssuePolicyFinal,
    isIssuingPolicyFinal,
    handleBindEndorsementDraft,
    isBindingEndorsementDraft,
    handleIssueEndorsement,
    isIssuingEndorsement,
    isCancellationEndorsement,
    quoteActionLabel = 'Send quote',
    hidePricingControls = false,
    canBindAuthority = true,
    canIssueAuthority = true,
    latestIssuedRiskTransactionId,
  } = props;

  return (
    <div className="flex flex-col items-end gap-4">
      {(() => {
        const statusUpper = String(policyDisplayStatus(asRecord(selectedPortfolio)) || '').toUpperCase();
        const isQuoteHistoryHistorical = Boolean(viewingVersionId);

        const txTypeUpper = String(viewingRiskTransactionSnapshot?.transactionType || '').toUpperCase();
        const txStatusUpper = String(viewingRiskTransactionSnapshot?.status || '').toUpperCase();
        const isRiskTxnVersionView = Boolean(viewingRiskTransactionId);
        const isEndorsementVersionView = isRiskTxnVersionView && txTypeUpper === 'ENDORSEMENT';
        const isEndorsementEditable = isEndorsementVersionView && txStatusUpper === 'DRAFT';

        const blockers = Array.isArray(issueReadiness?.blockers) ? issueReadiness.blockers : [];
        const canAct = !isQuoteHistoryHistorical && (Boolean(issueReadiness?.canIssue) || hasOnlyAutoRefreshPricingBlockers(blockers));
        const isBoundStage = statusUpper === 'BOUND' || statusUpper === 'BOUND_DRAFT_ISSUED';
        const isIssuedStage = statusUpper === 'ISSUED' || statusUpper === 'ACTIVE';
        const canBindCoverage = canBindAuthority && canAct && !isRiskTxnVersionView && !isBoundStage && !isIssuedStage;
        // ABY-497 — sending a quote email must not require bind readiness or
        // bind authority. Operators often email the quote while UW blockers
        // are still open; the backend send route does not gate on issue
        // readiness.
        const canSendQuote = !isQuoteHistoryHistorical && !isRiskTxnVersionView && QUOTE_SENDABLE_STATUSES.has(statusUpper);
        const quoteBlockedReason = String(quoteActionDisabledReason || '').trim();
        const viewingCurrentBoundInception = viewingRiskTransactionId === latestIssuedRiskTransactionId && txTypeUpper === 'INCEPTION' && txStatusUpper === 'BOUND';
        const canIssueFinal = canIssueAuthority && !isQuoteHistoryHistorical && (!isRiskTxnVersionView || viewingCurrentBoundInception) && isBoundStage;

        const qrNow = asRecord(selectedPortfolio?.quoteResponse);
        const primaryOption = asRecord(qrNow.primaryOption);
        const currentQuoteKey =
          String(primaryOption.annualPremium ?? primaryOption.totalPremium ?? qrNow.annualPremium ?? '') +
          '|' +
          String(qrNow.status ?? '');
        const showSentAt = Boolean(quoteSentAt && quoteSentKey && quoteSentKey === currentQuoteKey && canSendQuote);

        const showUnlock = canBindAuthority && !isQuoteHistoryHistorical && !isRiskTxnVersionView && (statusUpper === 'BOUND' || statusUpper === 'BOUND_DRAFT_ISSUED');
        const showRecalc = !hidePricingControls && !isQuoteHistoryHistorical && !showUnlock && !isIssuedStage && !isRiskTxnVersionView;
        const showEndorsementRecalc = !hidePricingControls && !isQuoteHistoryHistorical && isEndorsementEditable;

        const showCreateEndorsement = !isQuoteHistoryHistorical && isIssuedStage && !isEndorsementEditable;
        const showBindEndorsement = canBindAuthority && !isQuoteHistoryHistorical && isEndorsementEditable;
        const showIssueEndorsement = canIssueAuthority && !isQuoteHistoryHistorical && isEndorsementVersionView && txStatusUpper === 'BOUND';

        const showSaveVersion =
          !isQuoteHistoryHistorical &&
          !hidePricingControls &&
          Boolean(canSaveQuoteVersion) &&
          (
            (!isRiskTxnVersionView && !isBoundStage && !isIssuedStage) ||
            isEndorsementEditable
          );

        return (
          <div className="flex flex-col gap-3 w-full">
            {/* Line 1: rating / versioning controls */}
            <div className="flex items-start justify-between gap-3 flex-wrap w-full">
              <div className="flex items-center gap-3 flex-wrap">
                {showRecalc && (
                  <Button
                    variant="secondary"
                    size="lg"
                    className="gap-2 border border-brand-primary/20 bg-brand-primary/10 text-brand-primary hover:bg-brand-primary/15"
                    onClick={() => handleReRate()}
                    isLoading={isReRating}
                  >
                    <RotateCcw className="w-4 h-4" />
                    Recalculate
                  </Button>
                )}

                {showEndorsementRecalc && (
                  <Button
                    variant="secondary"
                    size="lg"
                    className="gap-2 border border-brand-primary/20 bg-brand-primary/10 text-brand-primary hover:bg-brand-primary/15"
                    onClick={() => handleReRate()}
                    isLoading={isReRating}
                  >
                    <RotateCcw className="w-4 h-4" />
                    Recalculate endorsement
                  </Button>
                )}

                {showSaveVersion && (
                  <Button
                    variant="secondary"
                    size="lg"
                    className="gap-2"
                    onClick={handleSaveQuoteVersion}
                    isLoading={isSavingQuoteVersion}
                    disabled={isSavingQuoteVersion}
                  >
                    Save version
                  </Button>
                )}

                {showUnlock && (
                  <Button
                    variant="secondary"
                    size="lg"
                    className="gap-2 border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100"
                    onClick={handleUnlockBoundMode}
                    isLoading={isUnlockingBoundMode}
                    disabled={isUnlockingBoundMode}
                  >
                    <Unlock className="w-4 h-4" />
                    Unlock for editing
                  </Button>
                )}
              </div>

              <div className="flex items-center justify-end gap-3 flex-wrap" />
            </div>

            {/* Line 2: send / bind / issue */}
            <div className="flex items-center justify-end gap-3 flex-wrap w-full">
              {showCreateEndorsement && (
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
              )}

              {canSendQuote && (
                <div className="relative">
                  <Button
                    actionId="POLICY.QUOTE"
                    variant="secondary"
                    size="lg"
                    onClick={handleIssueQuote}
                    disabled={isIssuingQuote || statusUpper === 'DECLINED' || Boolean(quoteBlockedReason)}
                    title={quoteBlockedReason || undefined}
                    className="gap-2"
                  >
                    <svg className="w-4 h-4 text-brand-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>
                    {isIssuingQuote ? 'Sending…' : quoteActionLabel}
                  </Button>
                  {showSentAt && (
                    <div className="absolute left-0 top-full mt-1 text-[10px] font-bold text-slate-400">
                      Sent at {formatDateUI(quoteSentAt, { withTime: true })}
                    </div>
                  )}
                  {quoteBlockedReason && (
                    <div className="absolute right-0 top-full mt-1 max-w-xs text-right text-[10px] font-bold text-amber-700">
                      {quoteBlockedReason}
                    </div>
                  )}
                </div>
              )}

              {canBindCoverage && (
                <Button
                  variant="primary"
                  size="lg"
                  className="gap-2"
                  onClick={handleBindCoverage}
                  isLoading={isBindingCoverage}
                  disabled={isBindingCoverage}
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 2l7 4v6c0 5-3 9-7 10-4-1-7-5-7-10V6l7-4z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4" />
                  </svg>
                  Bind coverage
                </Button>
              )}

              {canIssueFinal && (
                <Button
                  variant="primary"
                  size="lg"
                  className="gap-2"
                  onClick={handleIssuePolicyFinal}
                  isLoading={isIssuingPolicyFinal}
                  disabled={isIssuingPolicyFinal}
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h8M8 11h8M8 15h5" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 3h8l4 4v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
                  </svg>
                  Issue policy
                </Button>
              )}

              {showBindEndorsement && (
                <Button
                  variant={isCancellationEndorsement ? 'danger' : 'primary'}
                  size="lg"
                  className={`gap-2 ${isCancellationEndorsement ? 'bg-red-600 hover:bg-red-700 border-red-600 text-white' : ''}`}
                  onClick={handleBindEndorsementDraft}
                  isLoading={isBindingEndorsementDraft}
                  disabled={isBindingEndorsementDraft}
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 2l7 4v6c0 5-3 9-7 10-4-1-7-5-7-10V6l7-4z" />
                  </svg>
                  {isCancellationEndorsement ? 'Endorse cancellation' : 'Bind endorsement'}
                </Button>
              )}

              {showIssueEndorsement && (
                <Button
                  variant="primary"
                  size="lg"
                  className={`gap-2 ${isCancellationEndorsement ? 'bg-red-600 hover:bg-red-700 border-red-600 text-white' : ''}`}
                  onClick={handleIssueEndorsement}
                  isLoading={isIssuingEndorsement}
                  disabled={isIssuingEndorsement}
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h8M8 11h8M8 15h5" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 3h8l4 4v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
                  </svg>
                  {isCancellationEndorsement ? 'Issue cancellation endorsement' : 'Issue endorsement'}
                </Button>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

import React from 'react';
import {productCatalog} from '@/src/products/catalog';
import { IconButton, Button } from '@/src/shared/ui';
import { usePolicyWorkspace } from '../PolicyWorkspaceContext';
import { usePolicyDetailViewController, formatDateUI } from '../../hooks/usePolicyDetailViewController';
import { asRecord } from '@/src/shared/lib/record';

type DetailViewCtrl = ReturnType<typeof usePolicyDetailViewController>;

interface PolicyWorkspaceHeaderProps {
  ctrl: Pick<DetailViewCtrl, 'header' | 'statusBadge' | 'cancellation'>;
  setShowHistoryModal: (open: boolean) => void;
  navigate: (
    to: string | { pathname: string; search?: string; hash?: string },
    options?: { replace?: boolean; preventScrollReset?: boolean },
  ) => void;
}

export function PolicyWorkspaceHeader({ ctrl, setShowHistoryModal, navigate }: PolicyWorkspaceHeaderProps) {
  const { selectedPortfolio, endorsementDraftRiskTransactionId, openQuoteWizard } = usePolicyWorkspace();

  if (!selectedPortfolio) return null;

  const selectedPortfolioRecord = asRecord(selectedPortfolio);
  const renewalFamily = asRecord(selectedPortfolioRecord.renewalFamily);
  const previousTermPolicyId = String(renewalFamily.previousTermPolicyId || '').trim();
  const nextTermPolicyId = String(renewalFamily.nextTermPolicyId || '').trim();
  const renewalSequence = Number(selectedPortfolioRecord.renewalSequence || 1);
  const statusUpper = String(selectedPortfolioRecord.status || '').toUpperCase();
  const isIssuedStatus = ['ISSUED', 'ACTIVE', 'BOUND', 'BOUND_DRAFT_ISSUED'].includes(statusUpper);
  const isPolicyLocked = Boolean(selectedPortfolioRecord.isLocked || asRecord(selectedPortfolioRecord.policy).isLocked);

  // ABY-252 — operators need access to the customer wizard for ANY policy
  // that is still mutable (not fully issued + locked), regardless of whether
  // the quote was started via BO or via customer self-onboarding, and
  // regardless of whether a UW invite happens to have been sent. The
  // previous `isSelfOnboardingFlow || hasUwInvite` gate hid the button on
  // every BO-originated draft, which is the most common case the operator
  // needs to walk through end-to-end. Keep the issued+locked guard so we
  // don't accidentally let someone modify a bound policy via the wizard.
  const hasCustomerWizard = productCatalog.some(entry => entry.manifest.productType === String(selectedPortfolioRecord.productType || '').toUpperCase() && entry.publicJourneyAvailable !== false);
  const canOpenCustomerFlow = hasCustomerWizard && !(isIssuedStatus && isPolicyLocked && !endorsementDraftRiskTransactionId);

  return (
    <div className="bg-transparent">
      <div className="flex items-start sm:items-center justify-between gap-4 sm:gap-6">
        <div className="min-w-0 flex items-center gap-3 sm:gap-4">
          <IconButton title="Back" variant="neutral" onClick={() => navigate('/policies')}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </IconButton>
          <h1 className="min-w-0 text-2xl sm:text-3xl font-black text-slate-900 tracking-tight truncate">
            {ctrl.header.insuredTitle}
          </h1>
        </div>

        <IconButton title="Audit history" variant="neutral" onClick={() => setShowHistoryModal(true)}>
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        </IconButton>
      </div>

      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="min-w-0 flex items-center gap-4 sm:gap-8 text-xs sm:text-sm font-semibold text-slate-500 flex-wrap">
          <span className="inline-flex items-center gap-1">
            <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h10M7 12h10M7 17h6" />
            </svg>
            <span>{ctrl.header.businessId}</span>
          </span>

          <span className="inline-flex items-center gap-1">
            <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 21a8 8 0 10-16 0" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 13a4 4 0 100-8 4 4 0 000 8z" />
            </svg>
            <span className="truncate">{ctrl.header.policyholderName}</span>
          </span>

          {ctrl.header.coverageType && (
            <span className="inline-flex items-center gap-1">
              <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3l8 4v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V7l8-4z" />
              </svg>
              <span className="truncate">{ctrl.header.coverageType}</span>
            </span>
          )}

          <span className="inline-flex items-center gap-1">
            <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3M5 11h14M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span className="truncate">
              {formatDateUI((selectedPortfolio?.start && selectedPortfolio.start !== 'N/A') ? selectedPortfolio.start : new Date())}
              {' — '}
              {formatDateUI((selectedPortfolio?.end && selectedPortfolio.end !== 'N/A') ? selectedPortfolio.end : new Date(new Date().setFullYear(new Date().getFullYear() + 1)))}
            </span>
          </span>
          <span className="inline-flex items-center gap-1">
            <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5V4h-5M2 20h5V4H2m5 8h10" />
            </svg>
            <span>Term {renewalSequence}</span>
          </span>
        </div>

        {/* Premium + Status */}
        <div className="flex items-center gap-3 sm:gap-4 flex-wrap">
          {(previousTermPolicyId || nextTermPolicyId) && (
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => previousTermPolicyId && navigate(`/policies/${previousTermPolicyId}#premium`)}
                disabled={!previousTermPolicyId}
              >
                Previous term
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => nextTermPolicyId && navigate(`/policies/${nextTermPolicyId}#premium`)}
                disabled={!nextTermPolicyId}
              >
                Next term
              </Button>
            </div>
          )}
          <div className="text-lg sm:text-xl font-black tracking-tight text-slate-900">
            {ctrl.statusBadge.premiumDisplay ?? <span className="text-xs sm:text-sm font-bold text-slate-400">Premium pending</span>}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-2xl text-[9px] sm:text-[10px] font-black uppercase tracking-widest ${ctrl.statusBadge.statusClasses}`}>
              {ctrl.statusBadge.label}
            </span>
            <span
              title={ctrl.statusBadge.complianceTitle}
              aria-label={ctrl.statusBadge.complianceTitle}
              className={`inline-flex h-3 w-3 rounded-full ${ctrl.statusBadge.complianceDotClass}`}
            />
            {endorsementDraftRiskTransactionId && (
              <span className="px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-2xl text-[9px] sm:text-[10px] font-black uppercase tracking-widest bg-amber-100/70 text-amber-900">
                {ctrl.cancellation.endorsementInProgress ? 'Cancellation in progress' : 'Endorsement in progress'}
              </span>
            )}
            {ctrl.statusBadge.questionnaireSubstatus && (
              <span className="px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-2xl text-[9px] sm:text-[10px] font-black uppercase tracking-widest bg-sky-100/70 text-sky-900">
                {ctrl.statusBadge.questionnaireSubstatus}
              </span>
            )}
            {canOpenCustomerFlow && (
              <IconButton
                title="View customer flow"
                variant="neutral"
                onClick={() => {
                  if (!selectedPortfolio?.id || selectedPortfolio.id === 'new') return;
                  if (isIssuedStatus && isPolicyLocked && !endorsementDraftRiskTransactionId) return;
                  void openQuoteWizard(String(asRecord(selectedPortfolio).policyId || selectedPortfolio.id), 'policy-holder');
                }}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 3h7v7" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14L21 3" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 14v7H3V3h7" />
                </svg>
              </IconButton>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

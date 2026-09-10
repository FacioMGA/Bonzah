import React from 'react';
import { Input } from '@/src/shared/ui';
import type { CurrencyCode } from '@/src/shared/lib/format';
import { PremiumActions } from '../actions/PremiumActions';
import { PremiumNotes } from './PremiumNotes';
import { PremiumVersionTimeline } from './PremiumVersionTimeline';
import { PremiumPricingBreakdown } from '../renderers/PremiumPricingBreakdown';
import { ManualProposalEditor } from '../renderers/ManualProposalEditor';
import { AmountCell } from '../renderers/AmountCell';
import { usePremiumController } from '../hooks/usePremiumController';
import { asRecord } from '@/src/shared/lib/record';
import { formatBinderLabel } from '../../binders/binderFormatting';
import {
  effectiveCoverageSelectionFromPolicy,
  manualProposalCompleteness,
  mergeManualProposalRowsFromQuestionnaire,
  normalizeManualProposalRows,
  seedManualProposalRows,
} from '../model/manualProposal';
import type { PolicyRecord, PolicyStateSetter, UnknownRecordSetter, PolicyUwAnswers, UwAnswersSetter } from '../../model/policy';
import { hasPermission } from '@/src/modules/auth/session';
import { useSession } from '@/src/modules/auth/useSession';

type UnknownRecord = Record<string, unknown>;
type PricingStep = { id?: string; name?: string; amount?: number };

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

function hasRecordFields(value: unknown): boolean {
  return Object.keys(asRecord(value)).length > 0;
}

function premiumAmount(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeProductType(value: unknown): string {
  return String(value || '').trim().toUpperCase();
}

const AUTOMATED_PREMIUM_PRODUCT_TYPES = new Set(['HOME', 'MOTOR', 'TRAVEL', 'HEALTH']);

export function isManualProposalRecord(productType: string, quoteData: UnknownRecord, quoteResponse: UnknownRecord): boolean {
  const normalizedType = normalizeProductType(productType);
  const pricingModeManual = String(quoteResponse.pricingMode || '').trim().toLowerCase() === 'manual';

  if (normalizedType === 'BUSINESS' || normalizedType === 'OPEN_MARKET') return true;

  // ABY-497 — HOME/TRAVEL (and other catalogue products) always carry
  // `risk` + `proposer` in quoteData. Treating that pair as a manual
  // proposal hid PremiumActions "Send quote" and left only the manual
  // proposal editor with a permanently disabled "Send to client".
  if (AUTOMATED_PREMIUM_PRODUCT_TYPES.has(normalizedType)) return pricingModeManual;

  const proposal = asRecord(quoteData.proposal);
  const rows = proposal.coverageRows;
  if (Array.isArray(rows) && rows.length > 0) return true;
  if (premiumAmount(quoteData.manualPremium) > 0) return true;
  if (hasRecordFields(quoteData.business)) return true;

  // Fresh unstamped manual-intake submissions before productType is assigned.
  if (!normalizedType) {
    const risk = asRecord(quoteData.risk);
    const hasOpenMarketRisk = Boolean(String(risk.lineOfBusiness || '').trim() || String(risk.description || '').trim());
    if (hasRecordFields(quoteData.proposer) && (hasRecordFields(quoteData.business) || hasOpenMarketRisk)) {
      return true;
    }
  }

  return pricingModeManual;
}

export function resolvePremiumProductType(args: {
  selectedPortfolio?: unknown;
  displayedPortfolio?: unknown;
  selectedProgram?: unknown;
  quoteData?: UnknownRecord;
}): string {
  const selectedPortfolioRecord = asRecord(args.selectedPortfolio);
  const displayedRecord = asRecord(args.displayedPortfolio);
  const selectedProgram = asRecord(args.selectedProgram);
  const policyProgram = asRecord(selectedPortfolioRecord.program);
  const quoteData = asRecord(args.quoteData);
  return normalizeProductType(
    selectedPortfolioRecord.productType ||
    displayedRecord.productType ||
    selectedPortfolioRecord.product ||
    displayedRecord.product ||
    selectedPortfolioRecord.productCode ||
    displayedRecord.productCode ||
    selectedProgram.productType ||
    asRecord(selectedProgram.metadata).productType ||
    policyProgram.productType ||
    asRecord(policyProgram.metadata).productType ||
    quoteData.productType ||
    asRecord(quoteData.__meta).productType,
  );
}

type CanonicalBreakdownLine = {
  code: string;
  label: string;
  amount: number;
  kind: 'base' | 'addon' | 'loading' | 'discount' | 'tax' | 'fee' | 'total';
};

/**
 * ABY-264 — read the canonical `breakdown.lines` from the quote
 * primary option. Today only the travel calculator emits this shape;
 * motor and home still rely on `endorsement.premium.*` steps + the
 * flat `breakdown.{netPremium,iptAmount,adminFee,grossPremium}`
 * fields. When present, the lines drive the BO Premium tab summary so
 * the operator sees the exact same base → addons → tax → admin fee →
 * total breakdown that the customer-facing wizard sidebar and PDF
 * schedule render.
 */
export function readCanonicalBreakdownLines(breakdown: UnknownRecord): CanonicalBreakdownLine[] {
  const raw = breakdown.lines;
  if (!Array.isArray(raw)) return [];
  const out: CanonicalBreakdownLine[] = [];
  for (const entry of raw) {
    const record = asRecord(entry);
    const code = String(record.code || '');
    const label = String(record.label || '');
    const amount = Number(record.amount);
    const kindRaw = String(record.kind || '');
    if (!code || !label || !Number.isFinite(amount)) continue;
    // `loading` (ADR-0035/0054 travel loadings) and `discount` (ADR-0056 BDX
    // declared-premium alignment) are part of the price — dropping them makes
    // the detail rows visibly fail to add up to the total.
    if (
      kindRaw !== 'base' && kindRaw !== 'addon' && kindRaw !== 'loading' && kindRaw !== 'discount'
      && kindRaw !== 'tax' && kindRaw !== 'fee' && kindRaw !== 'total'
    ) continue;
    out.push({ code, label, amount, kind: kindRaw });
  }
  return out;
}

function IssuedPremiumSummary(props: {
  primary: UnknownRecord;
  cost: UnknownRecord;
  currency: CurrencyCode;
  feeSteps?: PricingStep[];
}) {
  const { primary, cost, currency, feeSteps = [] } = props;
  const breakdown = asRecord(primary.breakdown);

  // ABY-264 — prefer the canonical `breakdown.lines` (single source of
  // truth shared with the wizard sidebar and PDF schedule). Falls back
  // to the legacy flat summary for products that don't emit `lines`
  // yet (motor, home).
  const canonicalLines = readCanonicalBreakdownLines(breakdown);
  if (canonicalLines.length > 0) {
    const totalLine = canonicalLines.find((line) => line.kind === 'total');
    const detailLines = canonicalLines.filter((line) => line.kind !== 'total');
    const totalAmount = premiumAmount(
      totalLine?.amount ?? breakdown.grossPremium ?? cost.totalPremium ?? primary.annualPremium ?? primary.totalPremium,
    );
    if (detailLines.length === 0 && totalAmount === 0) return null;
    return (
      <div className="ui-table-wrap">
        <div className="px-10 py-4 border-b border-slate-200 bg-slate-50/70">
          <div className="text-[11px] font-black text-slate-600 uppercase tracking-widest">Premium summary</div>
        </div>
        <div className="overflow-auto">
          <table className="ui-table">
            <thead className="ui-thead">
              <tr>
                <th className="px-10 py-6">Item</th>
                <th className="px-10 py-6 text-right whitespace-nowrap">Amount ({currency})</th>
              </tr>
            </thead>
            <tbody className="ui-tbody text-sm">
              {detailLines.map((line) => (
                <tr key={line.code} className="ui-row bg-white/0">
                  <td className="px-10 py-6 font-black text-slate-900">{line.label}</td>
                  <td className="px-10 py-6">
                    <AmountCell n={line.amount} currency={currency} />
                  </td>
                </tr>
              ))}
              <tr className="bg-brand-primary/10 border-t-2 border-brand-primary/25">
                <td className="px-10 py-6 font-black text-slate-900 text-[15px] uppercase">
                  {totalLine?.label || 'Total payable'}
                </td>
                <td className="px-10 py-6">
                  <div className="text-right font-black tabular-nums text-brand-primary text-lg whitespace-nowrap">
                    € {totalAmount.toFixed(2)}
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  const netPremium = premiumAmount(breakdown.netPremium ?? cost.subtotalNetPremium);
  const taxes = premiumAmount(breakdown.iptAmount ?? cost.tax ?? cost.mifSurcharge ?? cost.stampDuty);
  const adminFee = premiumAmount(breakdown.adminFee ?? cost.policyFee);
  const extrasTotal = feeSteps.reduce((sum, s) => sum + Number(s.amount || 0), 0);
  const totalPayable = premiumAmount(breakdown.grossPremium ?? cost.totalPremium ?? primary.annualPremium ?? primary.totalPremium);

  if (!netPremium && !totalPayable) return null;

  return (
    <div className="ui-table-wrap">
      <div className="px-10 py-4 border-b border-slate-200 bg-slate-50/70">
        <div className="text-[11px] font-black text-slate-600 uppercase tracking-widest">Premium summary</div>
      </div>
      <div className="overflow-auto">
        <table className="ui-table">
          <thead className="ui-thead">
            <tr>
              <th className="px-10 py-6">Item</th>
              <th className="px-10 py-6 text-right whitespace-nowrap">Amount ({currency})</th>
            </tr>
          </thead>
          <tbody className="ui-tbody text-sm">
            {netPremium > 0 && (
              <tr className="ui-row bg-white/0">
                <td className="px-10 py-6 font-black text-slate-900">Net premium</td>
                <td className="px-10 py-6"><AmountCell n={netPremium} currency={currency} /></td>
              </tr>
            )}
            {taxes > 0 && (
              <tr className="ui-row bg-white/0">
                <td className="px-10 py-6 font-black text-slate-900">Taxes &amp; charges</td>
                <td className="px-10 py-6"><AmountCell n={taxes} currency={currency} /></td>
              </tr>
            )}
            {adminFee > 0 && (
              <tr className="ui-row bg-white/0">
                <td className="px-10 py-6 font-black text-slate-900">Admin fee</td>
                <td className="px-10 py-6"><AmountCell n={adminFee} currency={currency} /></td>
              </tr>
            )}
            {extrasTotal > 0 && (
              <tr className="ui-row bg-white/0">
                <td className="px-10 py-6 font-black text-slate-900">Extras</td>
                <td className="px-10 py-6"><AmountCell n={extrasTotal} currency={currency} /></td>
              </tr>
            )}
            <tr className="bg-brand-primary/10 border-t-2 border-brand-primary/25">
              <td className="px-10 py-6 font-black text-slate-900 text-[15px] uppercase">Total payable</td>
              <td className="px-10 py-6">
                <div className="text-right font-black tabular-nums text-brand-primary text-lg whitespace-nowrap">
                  € {totalPayable.toFixed(2)}
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export type PremiumProps = {
  selectedPortfolio?: PolicyRecord | null;
  displayedPortfolio?: PolicyRecord | null;
  endorsementDraftRiskTransactionId?: string | null;
  viewingRiskTransactionSnapshot?: UnknownRecord | null;
  viewingVersionId?: string | null;
  viewingRiskTransactionId?: string | null;
  policyVersions?: UnknownRecord[];
  isIssuedRecordMode?: boolean;
  isIssuedLifecycle?: boolean;
  latestIssuedRiskTransactionId?: string | null;
  mbeTemplates?: UnknownRecord[];
  excessImpact?: number | null;
  excessImpactLoading?: boolean;
  coverageDirty?: boolean;
  canSaveQuoteVersion?: boolean;
  issueReadiness?: UnknownRecord | null;
  issueReadinessLoading?: boolean;
  quoteSentAt?: string | null;
  quoteSentKey?: string | null;
  isReRating?: boolean;
  isSavingQuoteVersion?: boolean;
  isUnlockingBoundMode?: boolean;
  isIssuingQuote?: boolean;
  isBindingCoverage?: boolean;
  isIssuingPolicyFinal?: boolean;
  isBindingEndorsementDraft?: boolean;
  isIssuingEndorsement?: boolean;
  isCancellingEndorsementDraft?: boolean;
  setCoverageDirty: (value: boolean) => void;
  setCanSaveQuoteVersion: (value: boolean) => void;
  clearQuoteSentIndicator: () => void;
  setSelectedPortfolio: PolicyStateSetter;
  setViewingRiskTransactionSnapshot: UnknownRecordSetter;
  setViewingVersionId: (value: string | null) => void;
  setViewingRiskTransactionId: (value: string | null) => void;
  setShowRestoreVersionModal: (value: boolean) => void;
  setShowPricingSteps: (value: boolean) => void;
  setShowCreateEndorsementModal: (value: boolean) => void;
  setEndorsementEffectiveDate: (value: string) => void;
  setEndorsementReason: (value: string) => void;
  handleCancelEndorsementDraft: () => void;
  handleReRate: (quoteDataOverride?: UnknownRecord) => void;
  handleSaveQuoteVersion: () => void;
  handleUnlockBoundMode: () => void;
  handleIssueQuote: () => void;
  handleBindCoverage: () => void;
  handleIssuePolicyFinal: () => void;
  handleBindEndorsementDraft: () => void;
  handleIssueEndorsement: () => void;
  handleSendQuestionnaire: () => Promise<void>;
  reloadCurrentPolicy: () => Promise<void>;
  refreshIssueReadiness: () => Promise<void>;
  openQuoteWizard: () => void;
  uwAnswers?: PolicyUwAnswers;
  setUwAnswers: UwAnswersSetter;
  isEndorsementMode?: boolean;
  aggregateLimit?: boolean;
  setAggregateLimit: (value: boolean) => void;
  parseDateLoose?: (value: unknown) => Date | undefined;
  toISODateOnly?: (value: Date) => string;
  calcExpiryDateFromStart?: (value: Date) => Date;
  formatMoneyUI?: (amount: unknown, currency?: CurrencyCode, opts?: { showCode?: boolean }) => string;
  handleGenerateQuote?: () => void;
  isGeneratingQuote?: boolean;
  handleBindPolicy?: () => void;
  isBindingPolicy?: boolean;
  bindEndorsement?: () => void;
  cancelEndorsement?: () => void;
  selectedBinderId?: string;
  availableBinders?: UnknownRecord[];
  selectedProgramId?: string;
  programs?: UnknownRecord[];
};

export function Premium(props: PremiumProps) {
  const { user } = useSession();
  const {
    selectedPortfolio,
    displayedPortfolio,
    endorsementDraftRiskTransactionId,
    viewingRiskTransactionSnapshot,
    viewingVersionId,
    viewingRiskTransactionId,
    policyVersions,
    isIssuedRecordMode,
    isIssuedLifecycle,
    latestIssuedRiskTransactionId,
    mbeTemplates,
    coverageDirty,
    canSaveQuoteVersion,
    issueReadiness,
    issueReadinessLoading,
    quoteSentAt,
    quoteSentKey,
    isReRating,
    isSavingQuoteVersion,
    isUnlockingBoundMode,
    isIssuingQuote,
    isBindingCoverage,
    isIssuingPolicyFinal,
    isBindingEndorsementDraft,
    isIssuingEndorsement,
    isCancellingEndorsementDraft,
    setCoverageDirty,
    setCanSaveQuoteVersion,
    clearQuoteSentIndicator,
    setSelectedPortfolio,
    setViewingRiskTransactionSnapshot,
    setViewingVersionId,
    setViewingRiskTransactionId,
    setShowRestoreVersionModal,
    setShowPricingSteps,
    setShowCreateEndorsementModal,
    setEndorsementEffectiveDate,
    setEndorsementReason,
    handleCancelEndorsementDraft,
    handleReRate,
    handleSaveQuoteVersion,
    handleUnlockBoundMode,
    handleIssueQuote,
    handleBindCoverage,
    handleIssuePolicyFinal,
    handleBindEndorsementDraft,
    handleIssueEndorsement,
    handleSendQuestionnaire,
    reloadCurrentPolicy,
    refreshIssueReadiness,
    openQuoteWizard,
    isEndorsementMode,
    selectedBinderId,
    availableBinders = [],
    selectedProgramId,
    programs = [],
  } = props;
  const auto = usePremiumController({
    selectedPortfolio,
    displayedPortfolio,
    endorsementDraftRiskTransactionId,
    viewingRiskTransactionSnapshot,
    mbeTemplates,
    setCoverageDirty,
    setCanSaveQuoteVersion,
    clearQuoteSentIndicator,
    setSelectedPortfolio,
    setViewingRiskTransactionSnapshot,
  });
  const canBindAuthority = hasPermission(user, 'policies.bind');
  const canIssueAuthority = hasPermission(user, 'policies.issue');
  const selectedPortfolioRecord = asRecord(selectedPortfolio);
  const selectedStatusUpper = String(selectedPortfolioRecord.status || '').toUpperCase();
  const isIssuedLikeStatus = ['ISSUED', 'ACTIVE', 'BOUND', 'BOUND_DRAFT_ISSUED'].includes(selectedStatusUpper);
  const selectedBinderIdValue = String(selectedBinderId || selectedPortfolio?.binderId || '').trim();
  const selectedProgramIdValue = String(selectedProgramId || selectedPortfolio?.programId || '').trim();
  const selectedBinder = availableBinders.find((binder) => String(asRecord(binder).id || '') === selectedBinderIdValue);
  const selectedProgram = programs.find((program) => String(asRecord(program).id || '') === selectedProgramIdValue);
  const policyBinder = asRecord(selectedPortfolioRecord.binder);
  const policyProgram = asRecord(selectedPortfolioRecord.program);
  const productType = resolvePremiumProductType({ selectedPortfolio, displayedPortfolio, selectedProgram, quoteData: auto.qd });
  const isManualProposalProduct = isManualProposalRecord(productType, auto.qd, auto.qr);
  const binderLabel = selectedBinder
    ? formatBinderLabel(selectedBinder)
    : hasRecordFields(policyBinder)
      ? formatBinderLabel(policyBinder)
      : firstText(selectedPortfolioRecord.binderLabel, selectedPortfolioRecord.binderName, selectedPortfolioRecord.binderReference);
  const programLabel = firstText(asRecord(selectedProgram).name, policyProgram.name, selectedPortfolioRecord.programLabel, selectedPortfolioRecord.programName);
  const hasAssignedBusinessMarket = Boolean(selectedBinderIdValue || selectedProgramIdValue || binderLabel || programLabel);
  const lockedMarketName = productType === 'BUSINESS'
    ? ([binderLabel, programLabel].filter(Boolean).join(' / ') || (hasAssignedBusinessMarket ? 'Selected binder / program' : ''))
    : '';
  const coverageSelection = effectiveCoverageSelectionFromPolicy(selectedPortfolio);
  const proposalRowsRaw = asRecord(auto.qd.proposal).coverageRows;
  const savedProposalRows = normalizeManualProposalRows(proposalRowsRaw);
  const seededProposalRows = seedManualProposalRows(auto.qd, productType, coverageSelection);
  const effectiveProposalRows = seededProposalRows.length > 0
    ? mergeManualProposalRowsFromQuestionnaire(savedProposalRows, seededProposalRows)
    : savedProposalRows;
  const proposalCompleteness = isManualProposalProduct
    ? manualProposalCompleteness({ ...auto.qd, proposal: { ...asRecord(auto.qd.proposal), marketName: lockedMarketName || asRecord(auto.qd.proposal).marketName } }, effectiveProposalRows)
    : null;
  const hasCanonicalProductAssignment = Boolean(
    String(selectedPortfolioRecord.productType || '').trim()
    && String(selectedPortfolioRecord.binderId || '').trim()
    && String(selectedPortfolioRecord.programId || '').trim(),
  );
  const quoteActionDisabledReason = !hasCanonicalProductAssignment
    ? 'Select and save an active binder and program before sending this quote.'
    : proposalCompleteness && !proposalCompleteness.readyToSend
      ? proposalCompleteness.missing[0] || 'Complete the proposal before sending'
      : null;

  React.useEffect(() => {
    if (!selectedPortfolio?.id) return;
    if (!isManualProposalProduct) return;
    if (isIssuedRecordMode || isIssuedLikeStatus) return;
    let cancelled = false;
    let inFlight = false;
    const refresh = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        await Promise.all([
          reloadCurrentPolicy(),
          refreshIssueReadiness(),
        ]);
      } finally {
        inFlight = false;
      }
    };
    const firstRefresh = window.setTimeout(() => { void refresh(); }, 1500);
    const interval = window.setInterval(() => { void refresh(); }, 4000);
    return () => {
      cancelled = true;
      window.clearTimeout(firstRefresh);
      window.clearInterval(interval);
    };
  }, [isIssuedLikeStatus, isIssuedRecordMode, isManualProposalProduct, refreshIssueReadiness, reloadCurrentPolicy, selectedPortfolio?.id]);

  if (!selectedPortfolio?.id) return null;

  return (
    <div className="max-w-full space-y-8">
      <div className="h-1" />

      <div className="space-y-8">
        <>
                      {/* Insurance period (reuse existing labeled input pattern) */}
                      {!isIssuedRecordMode && (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                          <div className="relative group/field">
                            <label className="absolute -top-2.5 left-4 bg-brand-canvas px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10 transition-colors group-focus-within/field:text-brand-primary">
                              Start date
                            </label>
                            <Input
                              type="date"
                              min={auto.minStartISO}
                              max={auto.maxStartISO}
                              value={auto.startISO}
                              disabled={auto.premiumLocked || auto.isCancellationEndorsement}
                              variant="ui"
                              className="font-bold"
                              aria-label="Start date"
                              onValueChange={(next) => auto.handleStartDateChange(next)}
                            />
                          </div>

                          <div className="relative group/field">
                            <label className="absolute -top-2.5 left-4 bg-brand-canvas px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10 transition-colors group-focus-within/field:text-brand-primary">
                              {auto.isCancellationEndorsement ? 'Cancellation effective date' : 'End date'}
                            </label>
                            <Input
                              type="date"
                              value={auto.periodEndISO}
                              disabled={auto.premiumLocked}
                              variant="ui"
                              className="font-bold"
                              aria-label={auto.isCancellationEndorsement ? 'Cancellation effective date' : 'End date'}
                              onValueChange={(next) => auto.handlePeriodEndDateChange(next)}
                            />
                          </div>

                          <div className="flex items-center justify-between px-5 py-4 min-h-[60px]">
                            <div>
                              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Period</div>
                              <div className="mt-1 text-sm font-black text-slate-900 tabular-nums">
                                {auto.periodDays !== null ? `${auto.periodDays} days` : '—'}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {auto.isCancellationEndorsement && (
                        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 flex items-center justify-between gap-3">
                          <div>
                            <div className="text-xs font-black uppercase tracking-wider text-red-700">Cancellation endorsement</div>
                            <div className="text-sm text-red-900">
                              Issue will cancel the policy and create a billing credit. Refund remains manual in Billing.
                            </div>
                          </div>
                          <span className="px-2 py-1 rounded-full text-[10px] font-black uppercase tracking-tight bg-red-100 text-red-700 border border-red-200">
                            Cancellation
                          </span>
                        </div>
                      )}

                      {isIssuedRecordMode && !isManualProposalProduct && (
                        <PremiumActions
                          selectedPortfolio={{ ...asRecord(selectedPortfolio), id: String(selectedPortfolio?.id || '') }}
                          viewingVersionId={viewingVersionId}
                          viewingRiskTransactionSnapshot={viewingRiskTransactionSnapshot}
                          viewingRiskTransactionId={viewingRiskTransactionId}
                          issueReadiness={issueReadiness}
                          quoteSentAt={quoteSentAt}
                          quoteSentKey={quoteSentKey}
                          canSaveQuoteVersion={canSaveQuoteVersion}
                          handleReRate={handleReRate}
                          isReRating={isReRating}
                          handleSaveQuoteVersion={handleSaveQuoteVersion}
                          isSavingQuoteVersion={isSavingQuoteVersion}
                          handleUnlockBoundMode={handleUnlockBoundMode}
                          isUnlockingBoundMode={isUnlockingBoundMode}
                          setEndorsementEffectiveDate={setEndorsementEffectiveDate}
                          setEndorsementReason={setEndorsementReason}
                          setShowCreateEndorsementModal={setShowCreateEndorsementModal}
                          handleIssueQuote={handleIssueQuote}
                          isIssuingQuote={isIssuingQuote}
                          quoteActionDisabledReason={quoteActionDisabledReason}
                          handleBindCoverage={handleBindCoverage}
                          isBindingCoverage={isBindingCoverage}
                          handleIssuePolicyFinal={handleIssuePolicyFinal}
                          isIssuingPolicyFinal={isIssuingPolicyFinal}
                          handleBindEndorsementDraft={handleBindEndorsementDraft}
                          isBindingEndorsementDraft={isBindingEndorsementDraft}
                          handleIssueEndorsement={handleIssueEndorsement}
                          isIssuingEndorsement={isIssuingEndorsement}
                          isCancellationEndorsement={auto.isCancellationEndorsement}
                          hidePricingControls
                          canBindAuthority={canBindAuthority}
                          canIssueAuthority={canIssueAuthority}
                        />
                      )}

                      {isIssuedRecordMode && (
                        <IssuedPremiumSummary
                          primary={auto.primary}
                          cost={auto.cost}
                          currency={auto.currency as CurrencyCode}
                          feeSteps={auto.feeSteps}
                        />
                      )}

                      <PremiumVersionTimeline
                        selectedPortfolio={selectedPortfolio}
                        currency={auto.currency}
                        excessValue={auto.excessValue}
                        isIssuedRecordMode={isIssuedRecordMode}
                        isIssuedLifecycle={isIssuedLifecycle}
                        endorsementDraftRiskTransactionId={endorsementDraftRiskTransactionId}
                        viewingVersionId={viewingVersionId}
                        setViewingVersionId={setViewingVersionId}
                        viewingRiskTransactionId={viewingRiskTransactionId}
                        setViewingRiskTransactionId={setViewingRiskTransactionId}
                        viewingRiskTransactionSnapshot={viewingRiskTransactionSnapshot}
                        latestIssuedRiskTransactionId={latestIssuedRiskTransactionId}
                        policyVersions={policyVersions}
                        setShowRestoreVersionModal={setShowRestoreVersionModal}
                        setShowCreateEndorsementModal={setShowCreateEndorsementModal}
                        setEndorsementEffectiveDate={setEndorsementEffectiveDate}
                        setEndorsementReason={setEndorsementReason}
                        handleCancelEndorsementDraft={handleCancelEndorsementDraft}
                        isCancellingEndorsementDraft={isCancellingEndorsementDraft}
                        isBindingEndorsementDraft={isBindingEndorsementDraft}
                        isIssuingEndorsement={isIssuingEndorsement}
                      />

                      {isManualProposalProduct && (
                        <ManualProposalEditor
                          qd={auto.qd}
                          productType={productType}
                          coverageSelection={coverageSelection}
                          lockedMarketName={lockedMarketName}
                          currency={auto.currency}
                          premiumLocked={Boolean(auto.premiumLocked || isIssuedRecordMode || isIssuedLikeStatus)}
                          patchQuoteData={auto.patchQuoteData}
                          onRecalculate={handleReRate}
                          isReRating={isReRating}
                          onSendToClient={(isIssuedRecordMode || isIssuedLikeStatus) ? undefined : handleIssueQuote}
                          isSendingToClient={isIssuingQuote}
                        />
                      )}

                      {!isIssuedRecordMode && !isManualProposalProduct && (
                        <PremiumPricingBreakdown
                          primary={auto.primary}
                          breakdown={auto.breakdown}
                          qd={auto.qd}
                          cost={auto.cost}
                          currency={auto.currency}
                          fmt={auto.fmt}
                          premiumLocked={auto.premiumLocked}
                          patchQuoteData={auto.patchQuoteData}
                          feeSteps={auto.feeSteps}
                          coverageDirty={Boolean(coverageDirty)}
                          needsUwReason={auto.needsUwReason}
                          setShowPricingSteps={setShowPricingSteps}
                          getLimitText={auto.getLimitText}
                          onRecalculate={handleReRate}
                          isReRating={isReRating}
                        />
                      )}

                      {/* Actions */}
                      {!isIssuedRecordMode && !isManualProposalProduct && (
                        <PremiumActions
                          selectedPortfolio={{ ...asRecord(selectedPortfolio), id: String(selectedPortfolio?.id || '') }}
                          viewingVersionId={viewingVersionId}
                          viewingRiskTransactionSnapshot={viewingRiskTransactionSnapshot}
                          viewingRiskTransactionId={viewingRiskTransactionId}
                          issueReadiness={issueReadiness}
                          quoteSentAt={quoteSentAt}
                          quoteSentKey={quoteSentKey}
                          canSaveQuoteVersion={canSaveQuoteVersion}
                          handleReRate={handleReRate}
                          isReRating={isReRating}
                          handleSaveQuoteVersion={handleSaveQuoteVersion}
                          isSavingQuoteVersion={isSavingQuoteVersion}
                          handleUnlockBoundMode={handleUnlockBoundMode}
                          isUnlockingBoundMode={isUnlockingBoundMode}
                          setEndorsementEffectiveDate={setEndorsementEffectiveDate}
                          setEndorsementReason={setEndorsementReason}
                          setShowCreateEndorsementModal={setShowCreateEndorsementModal}
                          handleIssueQuote={handleIssueQuote}
                          isIssuingQuote={isIssuingQuote}
                          quoteActionDisabledReason={quoteActionDisabledReason}
                          handleBindCoverage={handleBindCoverage}
                          isBindingCoverage={isBindingCoverage}
                          handleIssuePolicyFinal={handleIssuePolicyFinal}
                          isIssuingPolicyFinal={isIssuingPolicyFinal}
                          handleBindEndorsementDraft={handleBindEndorsementDraft}
                          isBindingEndorsementDraft={isBindingEndorsementDraft}
                          handleIssueEndorsement={handleIssueEndorsement}
                          isIssuingEndorsement={isIssuingEndorsement}
                          isCancellationEndorsement={auto.isCancellationEndorsement}
                          quoteActionLabel={isManualProposalProduct ? 'Send to client' : 'Send quote'}
                          hidePricingControls={isManualProposalProduct}
                          forceShowQuoteAction={isManualProposalProduct}
                          canBindAuthority={canBindAuthority}
                          canIssueAuthority={canIssueAuthority}
                        />
                      )}

                      {!isManualProposalProduct && (
                        <PremiumNotes
                          selectedPortfolio={{ ...asRecord(selectedPortfolio), id: String(selectedPortfolio?.id || '') }}
                          isIssuedRecordMode={isIssuedRecordMode}
                          viewingVersionId={viewingVersionId}
                          viewingRiskTransactionId={viewingRiskTransactionId}
                          isEndorsementMode={isEndorsementMode}
                          issueReadiness={issueReadiness}
                          issueReadinessLoading={issueReadinessLoading}
                          handleReRate={handleReRate}
                          handleSendQuestionnaire={handleSendQuestionnaire}
                          reloadCurrentPolicy={reloadCurrentPolicy}
                          refreshIssueReadiness={refreshIssueReadiness}
                          openQuoteWizard={openQuoteWizard}
                        />
                      )}
        </>
      </div>
    </div>
  );
}

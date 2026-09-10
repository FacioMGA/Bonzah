import React from 'react';
import { policiesClient as api } from '@/src/modules/policies/api/policiesClient';
import { logger } from '@/src/shared/lib/logger';
import { asSnapshot, isStartDateWithinWindow } from '../model/premiumUtils';
import { asRecord } from '@/src/shared/lib/record';
import { needsPricingAdjustmentReason } from '../domain/adjustments';
import { effectiveCoverageSelectionFromPolicy } from '../model/manualProposal';
import type { PolicyRecord, PolicyStateSetter, UnknownRecordSetter } from '../../model/policy';

type UnknownRecord = Record<string, unknown>;
type PricingStep = { id?: string;[key: string]: unknown };

type UsePremiumControllerArgs = {
  selectedPortfolio?: PolicyRecord | null;
  displayedPortfolio?: PolicyRecord | null;
  endorsementDraftRiskTransactionId?: string | null;
  viewingRiskTransactionSnapshot?: UnknownRecord | null;
  mbeTemplates?: UnknownRecord[];
  setCoverageDirty: (value: boolean) => void;
  setCanSaveQuoteVersion: (value: boolean) => void;
  clearQuoteSentIndicator: () => void;
  setSelectedPortfolio: PolicyStateSetter;
  setViewingRiskTransactionSnapshot: UnknownRecordSetter;
};

export function usePremiumController(args: UsePremiumControllerArgs) {
  const {
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
  } = args;

  const targetP = React.useMemo(
    () => asRecord(displayedPortfolio || selectedPortfolio),
    [displayedPortfolio, selectedPortfolio]
  );
  const qr = React.useMemo(() => asRecord(targetP.quoteResponse), [targetP.quoteResponse]);
  const qd = React.useMemo(() => asRecord(targetP.quoteData), [targetP.quoteData]);
  const primary = React.useMemo(() => asRecord(qr.primaryOption), [qr.primaryOption]);
  const cost = React.useMemo(() => asRecord(primary.costDetails), [primary.costDetails]);
  const breakdown = React.useMemo(() => asRecord(primary.breakdown), [primary.breakdown]);
  const currency = String(asRecord(selectedPortfolio)?.originalCurrency || 'EUR');

  const isEndorsementWorkspaceTop = Boolean(endorsementDraftRiskTransactionId);
  const inception = isEndorsementWorkspaceTop
    ? asRecord(viewingRiskTransactionSnapshot).effectiveDate
    : asRecord(selectedPortfolio).inceptionDate || asRecord(selectedPortfolio).start;
  const expiry = isEndorsementWorkspaceTop
    ? asRecord(viewingRiskTransactionSnapshot).expiryDate
    : asRecord(selectedPortfolio).expiryDate || asRecord(selectedPortfolio).end;

  const fmt = (n: unknown) => {
    const v = Number(n || 0);
    if (!Number.isFinite(v)) return '';
    return v.toFixed(2);
  };
  const insuredValue = qd.insuredValue || qd.vehicleValue ? fmt(Number(qd.insuredValue || qd.vehicleValue || 0)) : '—';
  const excessValue = (() => {
    const n = parseInt(String(qd.requiredExcess || '').replace(/[^0-9]/g, '') || '0', 10);
    return Number.isFinite(n) && n > 0 ? n : 250;
  })();

  const coverageSelection = effectiveCoverageSelectionFromPolicy(targetP);
  const coverageSelectionRecord = asRecord(coverageSelection);
  const paramsByCodeSource = coverageSelectionRecord.params;
  const paramsByCode = React.useMemo(
    () => ((paramsByCodeSource && typeof paramsByCodeSource === 'object')
      ? (paramsByCodeSource as UnknownRecord)
      : {}),
    [paramsByCodeSource]
  );

  const tplByCode = React.useMemo(
    () => new Map((mbeTemplates || []).map((t) => [String(asRecord(t).code), t] as const)),
    [mbeTemplates]
  );
  const getLimitText = React.useCallback((code: string): string => {
    const t = asRecord(tplByCode.get(code));
    if (!t) return '—';
    const p = { ...asRecord(t.default_params), ...asRecord(paramsByCode?.[code]) };
    const limitEntries = Object.entries(p)
      .filter(([k]) => k.includes('limit') || k.includes('max'))
      .filter(([, v]) => typeof v === 'number' || (typeof v === 'string' && !isNaN(Number(v))))
      .map(([k, v]) => {
        const label = k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).replace(/Eur$/, '').trim();
        return `${label}: ${currency}${Number(v).toLocaleString()}`;
      });
    return limitEntries.join(' / ') || '—';
  }, [paramsByCode, tplByCode, currency]);

  const calculationTrace = asRecord(primary.calculationTrace);
  const stepList = Array.isArray(calculationTrace.steps) ? calculationTrace.steps : [];
  const feeSteps = stepList.filter((s) =>
    String((s as PricingStep)?.id || '').startsWith('endorsement.premium.'),
  );

  const statusUpper = String(selectedPortfolio?.status || '').toUpperCase();
  const selectedPortfolioRecord = asRecord(selectedPortfolio);
  const policyLocked = Boolean(selectedPortfolioRecord.isLocked || asRecord(selectedPortfolioRecord.policy).isLocked);
  const isEndorsementWorkspace = Boolean(endorsementDraftRiskTransactionId);
  const draftSnapshot = asSnapshot(
    asRecord(viewingRiskTransactionSnapshot).snapshotDraft
    || asRecord(viewingRiskTransactionSnapshot).snapshot
  );
  const endorsementWorkspace = asRecord(draftSnapshot.endorsementWorkspace);
  const isCancellationEndorsement = String(endorsementWorkspace.reasonCode || '').toUpperCase() === 'CANCELLATION';
  const premiumLocked = !isEndorsementWorkspace && (policyLocked || ['ISSUED', 'ACTIVE', 'BOUND', 'BOUND_DRAFT_ISSUED'].includes(statusUpper));

  const cancellationEffectiveDateValue =
    String(asRecord(viewingRiskTransactionSnapshot).effectiveDate || endorsementWorkspace.effectiveDate || '').trim();
  const startDate = inception ? new Date(String(inception)) : null;
  const endDate = expiry ? new Date(String(expiry)) : null;
  const startISO = startDate && !Number.isNaN(startDate.getTime()) ? startDate.toISOString().slice(0, 10) : '';
  const todayDate = new Date();
  todayDate.setHours(0, 0, 0, 0);
  const maxStartDate = new Date(todayDate);
  maxStartDate.setDate(maxStartDate.getDate() + 45);
  const minStartISO = todayDate.toISOString().slice(0, 10);
  const maxStartISO = maxStartDate.toISOString().slice(0, 10);
  const endISO = endDate && !Number.isNaN(endDate.getTime()) ? endDate.toISOString().slice(0, 10) : '';
  const cancellationEffectiveDate = cancellationEffectiveDateValue ? new Date(cancellationEffectiveDateValue) : null;
  const cancellationEndISO =
    cancellationEffectiveDate && !Number.isNaN(cancellationEffectiveDate.getTime())
      ? cancellationEffectiveDate.toISOString().slice(0, 10)
      : '';
  const periodEndISO = isCancellationEndorsement ? (cancellationEndISO || endISO) : endISO;
  const periodEndDate = periodEndISO ? new Date(periodEndISO) : null;
  const periodDays =
    startDate && periodEndDate && !Number.isNaN(startDate.getTime()) && !Number.isNaN(periodEndDate.getTime())
      ? Math.max(1, Math.round((periodEndDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)))
      : null;
  const needsUwReason = needsPricingAdjustmentReason(qd);

  const patchQuoteData = React.useCallback(async (nextQuoteData: UnknownRecord) => {
    if (!selectedPortfolio?.id) return;
    setCoverageDirty(true);
    setCanSaveQuoteVersion(false);
    clearQuoteSentIndicator();
    setSelectedPortfolio((prev) => ({ ...asRecord(prev), quoteData: nextQuoteData }));
    if (endorsementDraftRiskTransactionId) {
      try {
        await api.patchEndorsementDraft(String(selectedPortfolio.id), String(endorsementDraftRiskTransactionId), { quoteData: nextQuoteData });
      } catch (e) {
        logger.error('Failed to save endorsement draft inputs', e);
      }
      return;
    }
    try {
      await api.submitUWForm(String(selectedPortfolio.id), { quoteDataUpdates: nextQuoteData });
    } catch (e) {
      logger.error('Failed to save premium inputs', e);
      throw e;
    }
  }, [
    clearQuoteSentIndicator,
    endorsementDraftRiskTransactionId,
    selectedPortfolio?.id,
    setCoverageDirty,
    setCanSaveQuoteVersion,
    setSelectedPortfolio,
  ]);

  const updatePolicyDates = React.useCallback(async (nextStartISO: string, nextEndISO: string) => {
    if (!selectedPortfolio?.id) return;
    const s = new Date(nextStartISO);
    const e = new Date(nextEndISO);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return;
    setCoverageDirty(true);
    setCanSaveQuoteVersion(false);
    clearQuoteSentIndicator();
    try {
      if (endorsementDraftRiskTransactionId) {
        await api.patchEndorsementDraft(
          String(selectedPortfolio.id),
          String(endorsementDraftRiskTransactionId),
          { effectiveDate: nextStartISO, expiryDate: nextEndISO }
        );
        setViewingRiskTransactionSnapshot((prev) => ({
          ...(prev || {}),
          effectiveDate: s,
          expiryDate: e,
        }));
      } else {
        await api.updatePolicy(String(selectedPortfolio.id), { inceptionDate: s, expiryDate: e });
      }
    } catch (err) {
      logger.error('Failed to update policy dates', err);
    }

    patchQuoteData(qd || {});

    if (!endorsementDraftRiskTransactionId) {
      setSelectedPortfolio((prev) => ({
        ...asRecord(prev),
        inceptionDate: s,
        expiryDate: e,
      }));
    }
  }, [
    clearQuoteSentIndicator,
    endorsementDraftRiskTransactionId,
    patchQuoteData,
    qd,
    selectedPortfolio?.id,
    setCoverageDirty,
    setCanSaveQuoteVersion,
    setSelectedPortfolio,
    setViewingRiskTransactionSnapshot,
  ]);

  const updateCancellationEffectiveDate = React.useCallback(async (nextEffectiveISO: string) => {
    if (!selectedPortfolio?.id || !endorsementDraftRiskTransactionId) return;
    const nextEffectiveDate = new Date(nextEffectiveISO);
    if (Number.isNaN(nextEffectiveDate.getTime())) return;
    setCoverageDirty(true);
    setCanSaveQuoteVersion(false);
    clearQuoteSentIndicator();
    try {
      await api.patchEndorsementDraft(
        String(selectedPortfolio.id),
        String(endorsementDraftRiskTransactionId),
        { effectiveDate: nextEffectiveISO }
      );
      setViewingRiskTransactionSnapshot((prev) => ({
        ...(prev || {}),
        effectiveDate: nextEffectiveDate,
      }));
    } catch (err) {
      logger.error('Failed to update cancellation effective date', err);
    }
  }, [
    clearQuoteSentIndicator,
    endorsementDraftRiskTransactionId,
    selectedPortfolio?.id,
    setCoverageDirty,
    setCanSaveQuoteVersion,
    setViewingRiskTransactionSnapshot,
  ]);

  const handleStartDateChange = React.useCallback((nextStart: string) => {
    if (premiumLocked) return;
    if (!nextStart) return;
    if (!isStartDateWithinWindow(nextStart)) return;
    const baseStart = new Date(nextStart);
    const nextEnd = endISO || (() => {
      const d = new Date(baseStart);
      d.setFullYear(d.getFullYear() + 1);
      return d.toISOString().slice(0, 10);
    })();
    void updatePolicyDates(nextStart, nextEnd);
  }, [endISO, premiumLocked, updatePolicyDates]);

  const handlePeriodEndDateChange = React.useCallback((nextDate: string) => {
    if (premiumLocked) return;
    if (!nextDate) return;
    if (isCancellationEndorsement) {
      void updateCancellationEffectiveDate(nextDate);
      return;
    }
    if (!startISO) return;
    void updatePolicyDates(startISO, nextDate);
  }, [
    isCancellationEndorsement,
    premiumLocked,
    startISO,
    updateCancellationEffectiveDate,
    updatePolicyDates,
  ]);

  return {
    targetP,
    qr,
    qd,
    primary,
    cost,
    breakdown,
    currency,
    insuredValue,
    fmt,
    excessValue,
    feeSteps,
    getLimitText,
    premiumLocked,
    isCancellationEndorsement,
    minStartISO,
    maxStartISO,
    startISO,
    periodEndISO,
    periodDays,
    needsUwReason,
    patchQuoteData,
    handleStartDateChange,
    handlePeriodEndDateChange,
  };
}

import type { PolicyRecord } from './policy';
import { asRecord } from '@/src/shared/lib/record';

type UnknownRecord = Record<string, unknown>;

export function selectDisplayedPortfolio(args: {
  selectedPortfolio: PolicyRecord | null;
  viewingRiskTransactionId: string | null;
  viewingRiskTransactionSnapshot: UnknownRecord | null;
  viewingVersionId: string | null;
  toPolicyRecord: (value: unknown) => PolicyRecord;
}): PolicyRecord | null {
  const {
    selectedPortfolio,
    viewingRiskTransactionId,
    viewingRiskTransactionSnapshot,
    viewingVersionId,
    toPolicyRecord,
  } = args;

  if (!selectedPortfolio) return null;

  // RiskTransaction overlay takes precedence.
  if (
    viewingRiskTransactionId &&
    viewingRiskTransactionSnapshot &&
    String(viewingRiskTransactionSnapshot?.riskTransactionId || '') === String(viewingRiskTransactionId)
  ) {
    const snap = asRecord(viewingRiskTransactionSnapshot?.snapshot);
    const txNo = viewingRiskTransactionSnapshot?.transactionNumber;
    const txType = String(viewingRiskTransactionSnapshot?.transactionType || '').toUpperCase();
    const txStatus = String(viewingRiskTransactionSnapshot?.status || '').toUpperCase();

    return toPolicyRecord({
      ...selectedPortfolio,
      ...snap,
      quoteData: snap.quoteData || asRecord(selectedPortfolio).quoteData,
      quoteResponse: snap.quoteResponse || asRecord(selectedPortfolio).quoteResponse,
      coverageSelection: snap.coverageSelection || asRecord(selectedPortfolio).coverageSelection,
      _isRiskTransactionVersion: true,
      _riskTransactionId: viewingRiskTransactionId,
      _riskTransactionNumber: txNo,
      _riskTransactionType: txType,
      _riskTransactionStatus: txStatus,
    });
  }

  // Quote history overlay.
  if (!viewingVersionId || !selectedPortfolio?.quoteHistory) return selectedPortfolio;

  const quoteHistory = Array.isArray(selectedPortfolio.quoteHistory)
    ? (selectedPortfolio.quoteHistory as UnknownRecord[])
    : [];

  const historyItem = quoteHistory.find((h: UnknownRecord) => h?.id === viewingVersionId);
  if (!historyItem) return selectedPortfolio;

  const historySnapshot = asRecord(historyItem.snapshot);

  return toPolicyRecord({
    ...selectedPortfolio,
    ...historySnapshot,
    quoteData: historySnapshot.quoteData || selectedPortfolio.quoteData,
    _isHistorical: true,
    _historicalVersion: historyItem.version,
    _historicalDate: historyItem.archivedAt,
  });
}

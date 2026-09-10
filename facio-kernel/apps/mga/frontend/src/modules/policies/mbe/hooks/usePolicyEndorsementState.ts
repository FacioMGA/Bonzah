import { useEffect, useRef, useState } from 'react';
import type { PolicyUwAnswers } from '../../model/policy';
import { calcExpiryDateFromStart, isBoundLikeStatus, parseDateLoose, toISODateOnly } from '../../model/policyPageHelpers';
import { asRecord } from '@/src/shared/lib/record';

type UnknownRecord = Record<string, unknown>;
type SelectedPortfolio = Record<string, unknown> | null;

type UsePolicyEndorsementStateArgs = {
  selectedPortfolio: SelectedPortfolio;
  uwAnswers: PolicyUwAnswers;
  setUwAnswers: React.Dispatch<React.SetStateAction<PolicyUwAnswers>>;
  setSelectedPortfolio: (value: unknown) => void;
  refreshPolicyDocuments: (policyId: string) => Promise<void>;
  toast: (message: string) => void;
};

export function usePolicyEndorsementState(args: UsePolicyEndorsementStateArgs) {
  const { selectedPortfolio, uwAnswers, setUwAnswers, setSelectedPortfolio, refreshPolicyDocuments, toast } = args;
  const [isEndorsementMode, setIsEndorsementMode] = useState(false);
  const [aggregateLimit, setAggregateLimit] = useState(true);
  const endorsementSnapshotRef = useRef<{
    uwAnswers: PolicyUwAnswers;
    aggregateLimit: boolean;
    selectedPortfolio: UnknownRecord;
  } | null>(null);

  useEffect(() => {
    if (!aggregateLimit) return;
    const limit = Number(uwAnswers.limitPerOccurrence || 0);
    const units = Number(uwAnswers.totalUnits || 0);
    const maxAgg = 10_000_000;
    const nextAgg = Math.min(Math.max(0, Math.round(limit * units)), maxAgg);
    setUwAnswers((prev) => ({ ...prev, aggregateLimit: nextAgg ? String(nextAgg) : '' }));
  }, [aggregateLimit, setUwAnswers, uwAnswers.limitPerOccurrence, uwAnswers.totalUnits]);

  useEffect(() => {
    if (!selectedPortfolio?.id) return;
    if (!isBoundLikeStatus(selectedPortfolio?.status)) {
      setIsEndorsementMode(false);
    }
  }, [selectedPortfolio?.id, selectedPortfolio?.status]);

  const startEndorsement = () => {
    if (!selectedPortfolio?.id) return;
    endorsementSnapshotRef.current = {
      uwAnswers: JSON.parse(JSON.stringify(uwAnswers || {})),
      aggregateLimit,
      selectedPortfolio: {
        inceptionDate: asRecord(selectedPortfolio).inceptionDate,
        expiryDate: asRecord(selectedPortfolio).expiryDate,
        start: asRecord(selectedPortfolio).start,
        end: asRecord(selectedPortfolio).end,
      },
    };
    const start =
      parseDateLoose(uwAnswers.endorsementStartDate) ||
      parseDateLoose(asRecord(selectedPortfolio)?.inceptionDate) ||
      new Date();
    const end = parseDateLoose(uwAnswers.endorsementEndDate) || calcExpiryDateFromStart(start);
    setUwAnswers((prev) => ({
      ...prev,
      endorsementStartDate: toISODateOnly(start),
      endorsementEndDate: toISODateOnly(end),
    }));
    setIsEndorsementMode(true);
  };

  const cancelEndorsement = () => {
    const snap = endorsementSnapshotRef.current;
    if (!snap) {
      setIsEndorsementMode(false);
      return;
    }
    setUwAnswers(snap.uwAnswers);
    setAggregateLimit(snap.aggregateLimit);
    setSelectedPortfolio((prev: unknown) => ({
      ...asRecord(prev),
      ...snap.selectedPortfolio,
    }));
    endorsementSnapshotRef.current = null;
    setIsEndorsementMode(false);
  };

  const bindEndorsement = async () => {
    const selectedId = String(asRecord(selectedPortfolio).id || '').trim();
    if (!selectedId) return;
    await refreshPolicyDocuments(selectedId);
    endorsementSnapshotRef.current = null;
    setIsEndorsementMode(false);
    toast('Endorsement bound (fields locked).');
  };

  return {
    aggregateLimit,
    setAggregateLimit,
    isEndorsementMode,
    startEndorsement,
    cancelEndorsement,
    bindEndorsement,
  };
}

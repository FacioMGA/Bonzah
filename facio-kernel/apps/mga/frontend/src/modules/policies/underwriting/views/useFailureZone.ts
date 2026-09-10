// Failure-zone behaviour signal loader for UnderwritingTab.
// Extracted in sprint follow-up F4c.

import React from 'react';
import { policiesClient as api } from '../../api/policiesClient';
import { asRecord } from '@/src/shared/lib/record';
import {
  cleanSignalMessage,
  formatSimilarCase,
  type FailureZoneEvidence,
  type FailureZoneSignal,
  type FailureZoneView,
} from './UnderwritingTab.types';

export type FailureZoneSignalView = FailureZoneSignal & { message: string };
export type FailureZoneEvidenceView = FailureZoneEvidence & { label: string };

export type UseFailureZoneResult = {
  failureZone: FailureZoneView | null;
  failureZoneLoading: boolean;
  failureSignals: FailureZoneSignalView[];
  similarFailureEvidence: FailureZoneEvidenceView[];
  showFailureZone: boolean;
};

export function useFailureZone(policyId: string | null | undefined): UseFailureZoneResult {
  const [failureZone, setFailureZone] = React.useState<FailureZoneView | null>(null);
  const [failureZoneLoading, setFailureZoneLoading] = React.useState(false);

  React.useEffect(() => {
    const id = String(policyId || '').trim();
    if (!id) {
      setFailureZone(null);
      return;
    }
    let cancelled = false;
    setFailureZoneLoading(true);
    api.getBehaviorFailureZone(id)
      .then((res) => {
        if (cancelled) return;
        setFailureZone(res.success ? (asRecord(res.data) as FailureZoneView) : null);
      })
      .catch(() => {
        if (!cancelled) setFailureZone(null);
      })
      .finally(() => {
        if (!cancelled) setFailureZoneLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [policyId]);

  const failureSignals: FailureZoneSignalView[] = (Array.isArray(failureZone?.signals) ? failureZone.signals : [])
    .map((signal) => ({ ...signal, message: cleanSignalMessage(signal) }))
    .filter((signal) => Boolean(signal.message));
  const similarFailureEvidence: FailureZoneEvidenceView[] =
    (Array.isArray(failureZone?.similarFailureEvidence) ? failureZone.similarFailureEvidence : [])
      .map((item) => ({ ...item, label: formatSimilarCase(item) }))
      .filter((item) => Boolean(item.label));
  const showFailureZone = Boolean(
    !failureZoneLoading
    && failureZone
    && (failureZone.severity === 'alert' || failureZone.severity === 'watch')
    && (failureSignals.length > 0 || similarFailureEvidence.length > 0),
  );

  return { failureZone, failureZoneLoading, failureSignals, similarFailureEvidence, showFailureZone };
}

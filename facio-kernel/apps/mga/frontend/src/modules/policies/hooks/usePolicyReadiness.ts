import { useCallback, useEffect, useState } from 'react';
import { policyCrudApiClient } from '../api/policyCrudApiClient';
import type { PolicyRecord } from '../model/policy';
import { asRecord, type UnknownRecord } from '@/src/shared/lib/record';
import { logger } from '@/src/shared/lib/logger';

type UsePolicyReadinessArgs = {
  selectedPortfolio: PolicyRecord | null;
  activeTab: string;
  endorsementDraftRiskTransactionId: string | null;
};

export type IssueReadinessError = { code: 'NETWORK' | 'PARSE' | 'EMPTY'; message: string };

export function usePolicyReadiness(args: UsePolicyReadinessArgs) {
  const { selectedPortfolio, activeTab, endorsementDraftRiskTransactionId } = args;

  const [issueReadiness, setIssueReadiness] = useState<UnknownRecord | null>(null);
  const [issueReadinessLoading, setIssueReadinessLoading] = useState(false);
  const [issueReadinessError, setIssueReadinessError] = useState<IssueReadinessError | null>(null);

  const refreshIssueReadiness = useCallback(
    async (policyId: string, opts?: { riskTransactionId?: string | null }) => {
      try {
        setIssueReadinessLoading(true);
        setIssueReadinessError(null);
        const rt =
          typeof opts?.riskTransactionId === 'string'
            ? String(opts.riskTransactionId).trim()
            : (endorsementDraftRiskTransactionId ? String(endorsementDraftRiskTransactionId).trim() : '');
        const res = await policyCrudApiClient.getIssueReadiness(policyId, { riskTransactionId: rt || undefined });
        if (res?.success && res?.data) {
          setIssueReadiness(asRecord(res.data));
          return;
        }
        setIssueReadiness(null);
        setIssueReadinessError({
          code: 'EMPTY',
          message: 'Issue-readiness API returned no data',
        });
      } catch (err) {
        logger.warn({ err, policyId }, 'usePolicyReadiness.refreshIssueReadiness failed');
        setIssueReadiness(null);
        setIssueReadinessError({
          code: 'NETWORK',
          message: err instanceof Error ? err.message : 'Failed to load issue-readiness',
        });
      } finally {
        setIssueReadinessLoading(false);
      }
    },
    [endorsementDraftRiskTransactionId]
  );

  const inviteSentAt = String(asRecord(asRecord(selectedPortfolio).customerFlow).inviteSentAt || '').trim();

  useEffect(() => {
    if (!selectedPortfolio?.id) return;
    if (activeTab !== 'Premium' && activeTab !== 'Documents' && activeTab !== 'Underwriting') return;
    void refreshIssueReadiness(selectedPortfolio.id);
  }, [activeTab, inviteSentAt, refreshIssueReadiness, selectedPortfolio?.id]);

  return {
    issueReadiness,
    issueReadinessLoading,
    issueReadinessError,
    refreshIssueReadiness,
  };
}

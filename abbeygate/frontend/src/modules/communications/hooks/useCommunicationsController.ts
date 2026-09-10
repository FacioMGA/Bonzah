import { useCallback, useEffect, useMemo, useState } from 'react';
import { communicationsApiClient } from '../api/communicationsApiClient';
import type {
  CommunicationSummary,
  CommunicationTimelinePayload,
  CommunicationTimelineItem,
  CommunicationUser,
  CrossContextThread,
  FailedDelivery,
  NextActionSuggestion,
  ResolvedRecipient,
} from '../model/types';

type ApiEnvelope<T> = { success?: boolean; data?: T; error?: { message?: string } };

function unwrap<T>(value: unknown, fallback: T): T {
  if (value && typeof value === 'object' && 'data' in (value as ApiEnvelope<T>)) {
    return ((value as ApiEnvelope<T>).data as T) ?? fallback;
  }
  return (value as T) ?? fallback;
}

function errorMessage(value: unknown, fallback: string): string {
  if (value && typeof value === 'object' && 'error' in (value as ApiEnvelope<unknown>)) {
    return String((value as ApiEnvelope<unknown>).error?.message || fallback);
  }
  return fallback;
}

export function useCommunicationsController(args: {
  entityType: string;
  entityId: string;
}) {
  const { entityType, entityId } = args;
  const [timeline, setTimeline] = useState<CommunicationTimelineItem[]>([]);
  const [users, setUsers] = useState<CommunicationUser[]>([]);
  const [recipients, setRecipients] = useState<ResolvedRecipient[]>([]);
  const [summary, setSummary] = useState<CommunicationSummary[]>([]);
  const [failedDeliveries, setFailedDeliveries] = useState<FailedDelivery[]>([]);
  const [nextActions, setNextActions] = useState<NextActionSuggestion[]>([]);
  const [crossContext, setCrossContext] = useState<CrossContextThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const [
        timelineRes,
        recipientsRes,
        summaryRes,
        failedRes,
        nextActionsRes,
        crossContextRes,
      ] = await Promise.all([
        communicationsApiClient.listTimeline({ entityType, entityId }),
        communicationsApiClient.listRecipients({ entityType, entityId }),
        communicationsApiClient.getSummary({ entityType, entityId }),
        communicationsApiClient.getFailedDeliveries({ entityType, entityId }),
        communicationsApiClient.getNextActions({ entityType, entityId }),
        communicationsApiClient.getCrossContext({ entityType, entityId }),
      ]);

      const envelopes = [timelineRes, recipientsRes, summaryRes, failedRes, nextActionsRes, crossContextRes] as Array<ApiEnvelope<unknown>>;
      const failedEnvelope = envelopes.find((item) => item && typeof item === 'object' && item.success === false);
      if (failedEnvelope) {
        throw new Error(String(failedEnvelope.error?.message || 'Failed to load communications workspace'));
      }

      const timelinePayload = unwrap<CommunicationTimelinePayload>(timelineRes, { items: [], users: [] });
      setTimeline(timelinePayload.items || []);
      setUsers(timelinePayload.users || []);
      setRecipients(unwrap<ResolvedRecipient[]>(recipientsRes, []));
      setSummary(unwrap<CommunicationSummary[]>(summaryRes, []));
      setFailedDeliveries(unwrap<FailedDelivery[]>(failedRes, []));
      setNextActions(unwrap<NextActionSuggestion[]>(nextActionsRes, []));
      setCrossContext(unwrap<CrossContextThread[]>(crossContextRes, []));
    } catch (err) {
      setError(errorMessage(err, 'Failed to load communications workspace'));
    } finally {
      setLoading(false);
    }
  }, [entityId, entityType]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const summaryStats = useMemo(() => {
    const totalMessages = summary.reduce((acc, item) => acc + item.messageCount, 0);
    const totalFailed = summary.reduce((acc, item) => acc + item.failedDeliveryCount, 0);
    const pendingFollowUps = summary.filter((item) => item.needsFollowUp).length;
    return { totalMessages, totalFailed, pendingFollowUps };
  }, [summary]);

  return {
    timeline,
    users,
    recipients,
    summary,
    failedDeliveries,
    nextActions,
    crossContext,
    summaryStats,
    loading,
    error,
    refresh: fetchData,
  };
}

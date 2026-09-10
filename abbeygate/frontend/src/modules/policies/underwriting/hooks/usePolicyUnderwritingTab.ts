import { useCallback, useState } from 'react';
import { asRecord } from '@/src/shared/lib/record';
import { policyQuestionnaireLastSentKey } from '../../model/policyStorage';
import type { QuestionnaireStatus } from './usePolicyFollowUps';

export type { QuestionnaireStatus } from './usePolicyFollowUps';

type UsePolicyUnderwritingTabArgs = {
  selectedPortfolio: unknown;
};

/**
 * Read a value from `selectedPortfolio.quoteData` by RHF dot path.
 *
 * Phase 2.5 cutover: this used to fall back to the legacy root-level
 * proposer aliases (`firstName`, `email`, `telephone`, …) via a
 * `canonicalPolicyholderFallback` switch. After the
 * `20260427153132_canonicalize_travel_proposer` Prisma migration, every
 * stored TRAVEL row uses the canonical nested shape and the HTTP boundary
 * rejects any patch that tries to reintroduce the legacy aliases — so
 * the fallback became unreachable for real data and was deleted. If a
 * value is genuinely missing the BO field renderer shows it as empty,
 * which is the correct underwriter signal.
 */
function getAtPath(source: unknown, path: string): unknown {
  if (!path) return undefined;
  return path.split('.').filter(Boolean).reduce<unknown>((current, part) => asRecord(current)[part], source);
}

export function usePolicyUnderwritingTab(args: UsePolicyUnderwritingTabArgs) {
  const { selectedPortfolio } = args;
  const [qStatus, setQStatus] = useState<QuestionnaireStatus>('Draft');
  const [questionnaireLastSentAt, setQuestionnaireLastSentAt] = useState<Date | null>(null);

  const readQuestionnaireLastSentAt = useCallback((policyId: string): Date | null => {
    try {
      const raw = localStorage.getItem(policyQuestionnaireLastSentKey(policyId));
      if (!raw) return null;
      const d = new Date(raw);
      return isNaN(d.getTime()) ? null : d;
    } catch {
      return null;
    }
  }, []);

  const getQuestionValue = useCallback((key: unknown) => {
    const qd = asRecord(asRecord(selectedPortfolio)?.quoteData);
    const fieldKey = String(key || '');
    const exact = getAtPath(qd, fieldKey);
    if (typeof exact !== 'undefined') return exact;
    if (Object.prototype.hasOwnProperty.call(qd, fieldKey)) return qd[fieldKey];
    return undefined;
  }, [selectedPortfolio]);

  return {
    qStatus,
    setQStatus,
    questionnaireLastSentAt,
    setQuestionnaireLastSentAt,
    readQuestionnaireLastSentAt,
    getQuestionValue,
  };
}

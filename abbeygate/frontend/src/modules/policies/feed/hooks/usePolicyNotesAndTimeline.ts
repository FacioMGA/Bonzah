import { useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { usePolicyFollowUps } from '../../underwriting/hooks/usePolicyFollowUps';
import type { PolicyRecord, PolicyUwAnswers, UwAnswersSetter } from '../../model/policy';

import type { QuestionnaireStatus } from '../../underwriting/hooks/usePolicyFollowUps';

type UsePolicyNotesAndTimelineArgs = {
  selectedPortfolio: PolicyRecord | null;
  uwAnswers: PolicyUwAnswers;
  setUwAnswers: UwAnswersSetter;
  setQStatus: Dispatch<SetStateAction<QuestionnaireStatus>>;
  setIsSending: Dispatch<SetStateAction<boolean>>;
  setToastMessage: (message: string) => void;
  setShowToast: (show: boolean) => void;
};

export function usePolicyNotesAndTimeline(args: UsePolicyNotesAndTimelineArgs) {
  const [quoteSentAt, setQuoteSentAt] = useState<Date | null>(null);
  const [quoteSentKey, setQuoteSentKey] = useState<string>('');

  const clearQuoteSentIndicator = () => {
    setQuoteSentAt(null);
    setQuoteSentKey('');
  };

  const followUps = usePolicyFollowUps(args);

  return {
    ...followUps,
    quoteSentAt,
    quoteSentKey,
    setQuoteSentAt,
    setQuoteSentKey,
    clearQuoteSentIndicator,
  };
}

import type React from 'react';

export type UnknownRecord = Record<string, unknown>;

export type PolicyFollowUpItem = {
  question?: string;
  note?: string;
  fieldKey?: string;
  stepKey?: string;
  type?: string;
};

export type PolicyUwAnswers = UnknownRecord & {
  followUpRequests?: PolicyFollowUpItem[];
  outstandingRequests?: PolicyFollowUpItem[];
};

export type PolicyRecord = UnknownRecord & {
  id?: string;
  policyId?: string;
  policyNumber?: string;
  productType?: string;
  status?: string;
  isNew?: boolean;
  isLocked?: boolean;
  bo_status?: string | null;
  programId?: string;
  binderId?: string;
  complianceState?: 'PASS' | 'WARN' | 'FAIL' | string;
  complianceProfile?: 'PRODUCTION_STRICT' | 'SEEDED_RELAXED' | string;
  complianceReasons?: string[];
  name?: string;
  quoteData?: UnknownRecord;
  quoteResponse?: UnknownRecord;
  underwritingAnalysis?: UnknownRecord;
  contact?: UnknownRecord;
  policy?: { isLocked?: boolean } | null;
};

export type PolicyStateSetter = React.Dispatch<React.SetStateAction<PolicyRecord | null>>;
export type UnknownRecordSetter = React.Dispatch<React.SetStateAction<UnknownRecord | null>>;
export type UwAnswersSetter = React.Dispatch<React.SetStateAction<PolicyUwAnswers>>;

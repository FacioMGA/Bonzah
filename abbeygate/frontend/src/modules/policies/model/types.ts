import type { PolicyRecord } from '@/src/modules/policies/model/policy';

export type {
  PolicyRecord,
  PolicyUwAnswers,
} from '@/src/modules/policies/model/policy';

export type PolicyPageViewModel = {
  selectedPolicyId: string | null;
  activeTab: string;
  isDetailRoute: boolean;
};

export type PolicyHolderViewModel = {
  selectedPortfolio: import('./policy').PolicyRecord | null;
  isEditing: boolean;
  loading: boolean;
  formErrors: Record<string, string>;
  readOnly: boolean;
  showValidation: boolean;
  endorsementDraftRiskTransactionId?: string | null;
};

export type PolicyPageVM = {
  selectedPortfolio: PolicyRecord | null;
};

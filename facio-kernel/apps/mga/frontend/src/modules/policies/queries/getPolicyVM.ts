import type { PolicyRecord } from '../model/policy';
import type { PolicyHolderViewModel, PolicyPageViewModel } from '../model/types';
import { asRecord } from '@/src/shared/lib/record';

type BuildPolicyPageViewModelArgs = {
  selectedPortfolio: PolicyRecord | null;
  activeTab: string;
  routeId: string | undefined;
};

type BuildPolicyHolderViewModelArgs = {
  selectedPortfolio: PolicyRecord | null;
  isEditing: boolean;
  loading: boolean;
  formErrors: Record<string, string>;
  readOnly: boolean;
  showValidation: boolean;
  endorsementDraftRiskTransactionId?: string | null;
};

export function toPolicyRecord(value: unknown): PolicyRecord {
  const raw = asRecord(value);
  return {
    ...raw,
    id: raw.id ? String(raw.id) : undefined,
    policyId: raw.policyId ? String(raw.policyId) : undefined,
    policyNumber: raw.policyNumber ? String(raw.policyNumber) : undefined,
    productType: raw.productType ? String(raw.productType) : undefined,
    status: raw.status ? String(raw.status) : undefined,
    name: raw.name ? String(raw.name) : undefined,
    programId: raw.programId ? String(raw.programId) : undefined,
    binderId: raw.binderId ? String(raw.binderId) : undefined,
    quoteData: asRecord(raw.quoteData),
    quoteResponse: asRecord(raw.quoteResponse),
    contact: asRecord(raw.contact),
  };
}

export function getPolicyVM(selectedPortfolio: PolicyRecord | null): {
  selectedPortfolio: PolicyRecord | null;
} {
  return {
    selectedPortfolio,
  };
}

export function buildPolicyPageViewModel(args: BuildPolicyPageViewModelArgs): PolicyPageViewModel {
  const { selectedPortfolio, activeTab, routeId } = args;
  return {
    selectedPolicyId: selectedPortfolio?.id ? String(selectedPortfolio.id) : null,
    activeTab: String(activeTab || 'Policy Holder'),
    isDetailRoute: Boolean(routeId && routeId !== 'new'),
  };
}

export function buildPolicyHolderViewModel(args: BuildPolicyHolderViewModelArgs): PolicyHolderViewModel {
  return {
    selectedPortfolio: args.selectedPortfolio,
    isEditing: args.isEditing,
    loading: args.loading,
    formErrors: args.formErrors,
    readOnly: args.readOnly,
    showValidation: args.showValidation,
    endorsementDraftRiskTransactionId: args.endorsementDraftRiskTransactionId ?? null,
  };
}

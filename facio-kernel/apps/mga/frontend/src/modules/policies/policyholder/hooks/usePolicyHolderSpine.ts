import type React from 'react';
import { useMemo } from 'react';
import { Policyholder } from '../views/PolicyholderTab';
import { buildPolicyHolderViewModel } from '../../queries/getPolicyVM';

type PolicyholderProps = React.ComponentProps<typeof Policyholder>;

type UsePolicyHolderSpineArgs = {
  selectedPortfolio: PolicyholderProps['selectedPortfolio'];
  isEditing: boolean;
  formErrors: Record<string, string>;
  showValidation: boolean;
  readOnly: boolean;
  endorsementDraftRiskTransactionId?: string | null;
  countryOptions: PolicyholderProps['countryOptions'];
  loading: boolean;
  setSelectedPortfolio: PolicyholderProps['setSelectedPortfolio'];
  setIsEditing: PolicyholderProps['setIsEditing'];
  validateField: PolicyholderProps['validateField'];
  clearFieldError: PolicyholderProps['clearFieldError'];
  setFieldError: PolicyholderProps['setFieldError'];
  endorsementFieldChanged: PolicyholderProps['endorsementFieldChanged'];
  handleSavePolicy: PolicyholderProps['handleSavePolicy'];
  handleSavePolicyHolder: PolicyholderProps['handleSavePolicyHolder'];
  handleCancelPolicyHolder: PolicyholderProps['handleCancelPolicyHolder'];
  loadPolicyDetails: PolicyholderProps['loadPolicyDetails'];
};

export function usePolicyHolderSpine(args: UsePolicyHolderSpineArgs) {
  const {
    selectedPortfolio,
    isEditing,
    formErrors,
    showValidation,
    readOnly,
    endorsementDraftRiskTransactionId,
    countryOptions,
    loading,
    setSelectedPortfolio,
    setIsEditing,
    validateField,
    clearFieldError,
    setFieldError,
    endorsementFieldChanged,
    handleSavePolicy,
    handleSavePolicyHolder,
    handleCancelPolicyHolder,
    loadPolicyDetails,
  } = args;

  const vm = useMemo(
    () => ({
      ...buildPolicyHolderViewModel({
        selectedPortfolio,
        isEditing,
        loading,
        formErrors,
        readOnly,
        showValidation,
        endorsementDraftRiskTransactionId,
      }),
      countryOptions,
    }),
    [
      countryOptions,
      endorsementDraftRiskTransactionId,
      formErrors,
      isEditing,
      loading,
      readOnly,
      selectedPortfolio,
      showValidation,
    ]
  );

  const actions = useMemo(
    () => ({
      setSelectedPortfolio,
      setIsEditing,
      validateField,
      clearFieldError,
      setFieldError,
      endorsementFieldChanged,
      handleSavePolicy,
      handleSavePolicyHolder,
      handleCancelPolicyHolder,
      loadPolicyDetails,
    }),
    [
      clearFieldError,
      endorsementFieldChanged,
      handleSavePolicy,
      handleSavePolicyHolder,
      handleCancelPolicyHolder,
      loadPolicyDetails,
      setFieldError,
      setIsEditing,
      setSelectedPortfolio,
      validateField,
    ]
  );

  return { vm, actions };
}

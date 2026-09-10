import { policiesClient as api } from '../api/policiesClient';

type UnknownRecord = Record<string, unknown>;

export function createEndorsementDraft(policyId: string, payload: { effectiveDate: string; reason?: string; reasonCode?: string }) {
  return api.createEndorsementDraft(policyId, payload);
}

export function patchEndorsementDraft(policyId: string, riskTransactionId: string, patch: UnknownRecord) {
  return api.patchEndorsementDraft(policyId, riskTransactionId, patch);
}

export function rateEndorsementDraft(policyId: string, riskTransactionId: string) {
  return api.rateEndorsementDraft(policyId, riskTransactionId);
}

export function bindEndorsementDraft(policyId: string, riskTransactionId: string) {
  return api.bindEndorsementDraft(policyId, riskTransactionId);
}

export function cancelEndorsementDraft(policyId: string, riskTransactionId: string) {
  return api.cancelEndorsementDraft(policyId, riskTransactionId);
}

export function issueEndorsement(
  policyId: string,
  riskTransactionId: string,
  payload?: { confirmManualRefundAck?: boolean }
) {
  return api.issueEndorsement(policyId, riskTransactionId, payload);
}

export function saveEndorsementVersion(
  policyId: string,
  payload: { sourceRiskTransactionId: string }
) {
  return api.saveEndorsementVersion(policyId, payload);
}

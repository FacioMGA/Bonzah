/**
 * bindPolicy — Policy bind/coverage commands
 *
 * Delegates to policyCrudApiClient. No direct http access.
 */
import { policyCrudApiClient } from '../api/policyCrudApiClient';

export function bindPolicy(policyId: string) {
  return policyCrudApiClient.bindPolicy(policyId);
}

export function bindCoverage(policyId: string) {
  return policyCrudApiClient.bindCoverage(policyId);
}

export function generateDraftPolicyPack(policyId: string, riskTransactionId?: string | null) {
  return policyCrudApiClient.generateDocuments(policyId, { docPack: 'DRAFT_POLICY_PACK', riskTransactionId });
}

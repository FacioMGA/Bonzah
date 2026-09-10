/**
 * issuePolicy — Policy issuance commands
 *
 * Delegates to policyCrudApiClient. No direct http access.
 */
import { policyCrudApiClient } from '../api/policyCrudApiClient';

export function issuePolicy(policyId: string) {
  return policyCrudApiClient.issuePolicy(policyId);
}

export function unlockBoundMode(policyId: string) {
  return policyCrudApiClient.unlockBoundMode(policyId);
}

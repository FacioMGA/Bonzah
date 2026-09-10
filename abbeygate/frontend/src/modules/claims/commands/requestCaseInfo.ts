import { claimsApiClient as claimsApi } from '@/src/modules/claims/api/claimsApiClient';

export async function requestCaseInfo(claimId: string, payload: { message: string }) {
  return claimsApi.createClaimInfoRequest(claimId, payload);
}

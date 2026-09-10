import { claimsApiClient as claimsApi } from '@/src/modules/claims/api/claimsApiClient';

export async function confirmFnol(claimId: string) {
  return claimsApi.confirmFnol(claimId);
}

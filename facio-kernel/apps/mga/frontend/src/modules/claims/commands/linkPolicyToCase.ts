import { claimsApiClient as claimsApi } from '@/src/modules/claims/api/claimsApiClient';

export async function linkPolicyToCase(claimId: string, policyId: string, linkReason = 'Manual BO link') {
  return claimsApi.executeClaimWorksheetCommand(claimId, {
    type: 'LINK_POLICY',
    payload: { policyId, linkReason },
  });
}

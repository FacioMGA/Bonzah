import { claimsApiClient as claimsApi } from '@/src/modules/claims/api/claimsApiClient';
import type { DevelopmentType, DevFormState } from '@/src/modules/claims/model/types';
import { buildDevelopmentPayload } from '@/src/modules/claims/desk/model/payloadBuilders';

export async function applyDevelopment(
  claimId: string,
  commandType: DevelopmentType,
  devForm: DevFormState,
) {
  const payload = buildDevelopmentPayload(commandType, devForm);
  return claimsApi.executeClaimWorksheetCommand(claimId, { type: commandType, payload });
}

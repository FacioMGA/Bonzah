import { claimsApiClient as claimsApi } from '@/src/modules/claims/api/claimsApiClient';

type SaveIntakeArgs = {
  hasExistingIntake: boolean;
  fnol: Record<string, unknown>;
  changes: Array<{ path: string; from: unknown; to: unknown }>;
};

export async function requestFnolClarification(
  claimId: string,
  payload: { fieldsRequested: string[]; message: string },
) {
  return claimsApi.requestFnolClarification(claimId, payload);
}

export async function resendFnolLink(claimId: string) {
  return claimsApi.sendFnolLink(claimId);
}

export async function saveIntakeDetails(claimId: string, args: SaveIntakeArgs) {
  if (args.hasExistingIntake) {
    return claimsApi.amendFnol(claimId, { fnol: args.fnol, changes: args.changes });
  }
  return claimsApi.executeClaimWorksheetCommand(claimId, { type: 'SUBMIT_FNOL', payload: { fnol: args.fnol } });
}

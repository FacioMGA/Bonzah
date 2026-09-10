import { claimsApiClient as claimsApi } from '@/src/modules/claims/api/claimsApiClient';

type CreateCaseArgs = {
  policyId: string | null;
  description?: string;
  caseIntakeDraft?: {
    reporterType?: string;
    contactName?: string;
    contactPhone?: string;
    contactEmail?: string;
    contactDetails?: string;
    shortDescription?: string;
    dateOfLoss?: string;
    location?: string;
    locationDetails?: {
      address?: string;
      city?: string;
      state?: string;
      zip?: string;
      country?: string;
    };
    insuredName?: string;
  };
};

export async function createCase(args: CreateCaseArgs) {
  return claimsApi.createClaimWorksheet(args);
}

/**
 * Policy Versions API Client — Sub-Domain (CHAMPS)
 *
 * Owns: version history listing, risk transaction snapshot retrieval.
 * Read-model-ish boundary — distinct from CRUD and endorsements.
 */
import { http } from '@/src/shared/api/http';
import type { ApiResponse, UnknownRecord } from '@/src/shared/api/types';

export const policyVersionsApiClient = {
    async listPolicyVersions(policyId: string): Promise<ApiResponse<UnknownRecord[]>> {
        return http.request<UnknownRecord[]>(`policies/${policyId}/versions`);
    },

    async getPolicyVersionSnapshot(policyId: string, riskTransactionId: string): Promise<ApiResponse<UnknownRecord>> {
        return http.request<UnknownRecord>(`policies/${policyId}/versions/${riskTransactionId}/snapshot`);
    },
};

export type PolicyVersionsApiClient = typeof policyVersionsApiClient;

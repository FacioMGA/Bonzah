/**
 * Endorsements API Client — Sub-Domain (CHAMPS)
 *
 * Owns: list endorsements, draft CRUD, rate, bind, cancel, issue.
 */
import { http } from '@/src/shared/api/http';
import type { UnknownRecord } from '@/src/shared/api/types';

export const endorsementsApiClient = {
    async listEndorsements(policyId: string) {
        return http.request(`policies/${policyId}/endorsement-instances`);
    },

    async createEndorsementDraft(policyId: string, payload: { effectiveDate: string; reason?: string; reasonCode?: string }) {
        return http.request(`policies/${policyId}/endorsements/draft`, {
            method: 'POST',
            body: JSON.stringify(payload),
        });
    },

    async patchEndorsementDraft(policyId: string, riskTransactionId: string, patch: UnknownRecord) {
        return http.request(`policies/${policyId}/endorsements/${riskTransactionId}/draft`, {
            method: 'PATCH',
            body: JSON.stringify(patch || {}),
        });
    },

    async rateEndorsementDraft(policyId: string, riskTransactionId: string, payload?: { overrideExcess?: number }) {
        return http.request(`policies/${policyId}/endorsements/${riskTransactionId}/rate`, {
            method: 'POST',
            body: JSON.stringify(payload || {}),
        });
    },

    async bindEndorsementDraft(policyId: string, riskTransactionId: string) {
        return http.request(`policies/${policyId}/endorsements/${riskTransactionId}/bind`, {
            method: 'POST',
        });
    },

    async cancelEndorsementDraft(policyId: string, riskTransactionId: string) {
        return http.request(`policies/${policyId}/endorsements/${riskTransactionId}/cancel`, {
            method: 'POST',
        });
    },

    async issueEndorsement(policyId: string, riskTransactionId: string, payload?: { confirmManualRefundAck?: boolean }) {
        return http.request(`policies/${policyId}/endorsements/${riskTransactionId}/issue`, {
            method: 'POST',
            body: JSON.stringify(payload || {}),
        });
    },

    async saveEndorsementVersion(policyId: string, payload: { sourceRiskTransactionId: string }) {
        return http.request(`policies/${policyId}/endorsements/save-version`, {
            method: 'POST',
            body: JSON.stringify(payload),
        });
    },
};

export type EndorsementsApiClient = typeof endorsementsApiClient;

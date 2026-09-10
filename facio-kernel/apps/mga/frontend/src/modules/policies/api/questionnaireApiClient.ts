/**
 * Questionnaire API Client — Sub-Domain (CHAMPS)
 *
 * Owns: UW form get/submit (BO authenticated), send questionnaire,
 *       follow-up batch, request-info.
 * Does NOT own pricing/premium calculation — that's pricingApiClient.
 *
 * Note: there is no public/magic-token UW form route. The previous
 * `getPublicUWForm` / `submitPublicUWForm` methods served the deleted
 * QuestionnaireWorkspace (B2B portfolio program that never shipped) and
 * were removed in Phase 2 of the questionnaire consolidation.
 */
import { http } from '@/src/shared/api/http';
import type { UnknownRecord } from '@/src/shared/api/types';

export const questionnaireApiClient = {
    async getUWForm(policyId: string) {
        return http.request(`policies/${policyId}/uw-form`);
    },

    async submitUWForm(policyId: string, formData: UnknownRecord) {
        return http.request(`policies/${policyId}/uw-form`, {
            method: 'POST',
            body: JSON.stringify(formData),
        });
    },

    async sendQuestionnaire(policyId: string, payload?: { questionnaireId?: string; kind?: 'initial' | 'resend' }) {
        return http.request(`policies/${policyId}/send-questionnaire`, {
            method: 'POST',
            body: JSON.stringify(payload || {}),
        });
    },

    async sendFollowUpBatch(policyId: string, requests: UnknownRecord[]) {
        return http.request(`policies/${policyId}/send-follow-up-batch`, {
            method: 'POST',
            body: JSON.stringify({ requests }),
        });
    },

    async requestInfo(policyId: string, payload: { message?: string; requestedStep?: string }) {
        return http.request(`policies/${policyId}/uw/request-info`, {
            method: 'POST',
            body: JSON.stringify(payload || {}),
        });
    },
};

export type QuestionnaireApiClient = typeof questionnaireApiClient;

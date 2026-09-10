/**
 * Cancellation API Client — Sub-Domain (CHAMPS)
 *
 * Owns: request cancellation, approve, reject.
 * Cancellations are semantically distinct from generic endorsements —
 * they have their own approval flow and billing/refund interactions.
 */
import { http } from '@/src/shared/api/http';

export const cancellationApiClient = {
    async requestPolicyCancellation(policyId: string, payload: { reason?: string; requestedEffectiveDate?: string }) {
        return http.request(`policies/${policyId}/cancellation/request`, {
            method: 'POST',
            body: JSON.stringify(payload || {}),
        });
    },

    async approveCancellation(policyId: string, payload?: { effectiveDate?: string }) {
        return http.request(`policies/${policyId}/cancellation/approve`, {
            method: 'POST',
            body: JSON.stringify(payload || {}),
        });
    },

    async rejectCancellation(policyId: string, payload?: { reason?: string }) {
        return http.request(`policies/${policyId}/cancellation/reject`, {
            method: 'POST',
            body: JSON.stringify(payload || {}),
        });
    },
};

export type CancellationApiClient = typeof cancellationApiClient;

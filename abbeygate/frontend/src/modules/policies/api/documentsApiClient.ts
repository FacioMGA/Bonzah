/**
 * Documents API Client — Domain-Scoped (CHAMPS)
 *
 * Canonical import for document-related API calls.
 * Owns: upload, public upload, policy documents listing, email, feed.
 *
 * Calls http.request() directly.
 */
import { http } from '@/src/shared/api/http';

type UnknownRecord = Record<string, unknown>;

export const documentsApiClient = {
    async uploadDocument(file: File) {
        const formData = new FormData();
        formData.append('file', file);
        return http.request<{ url: string; filename: string }>('documents/upload', {
            method: 'POST',
            body: formData,
            headers: {},
        });
    },

    async uploadPublicDocument(file: File) {
        const formData = new FormData();
        formData.append('file', file);
        return http.request<{ url: string; filename: string }>('public/documents/upload', {
            method: 'POST',
            body: formData,
            headers: {},
        });
    },

    async listPolicyDocuments(policyId: string) {
        return http.request<UnknownRecord[]>(`policies/${policyId}/documents`);
    },

    async emailPolicyDocuments(policyId: string, documentIds: string[]) {
        return http.request<{ sent: boolean; toEmail: string; count: number }>(`policies/${policyId}/documents/email`, {
            method: 'POST',
            body: JSON.stringify({ documentIds }),
        });
    },

    async getPolicyFeed(policyId: string) {
        return http.request<UnknownRecord[]>(`policies/${policyId}/feed`);
    },
};

export type DocumentsApiClient = typeof documentsApiClient;

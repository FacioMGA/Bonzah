/**
 * Policy CRUD API Client — Sub-Domain (CHAMPS)
 *
 * Owns: list, get, create, update, delete, createFromQuote, bind, bindCoverage,
 *       issuePolicy, unlockBoundMode, generateDocuments, getPolicyBundle,
 *       getIssueReadiness, getPublicSessionToken, createQuoteSession,
 *       patchQuoteSession, rateQuote, saveQuoteHistory,
 *       manualUwApproval, indexHealth, addUnit, generateCertificate,
 *       deleteDeclarationBatch.
 */
import { http } from '@/src/shared/api/http';
import type { ApiResponse, UnknownRecord } from '@/src/shared/api/types';

export type ApiPolicyRecord = UnknownRecord & {
    id: string;
    policyId?: string;
    policyNumber?: string;
    productType?: string;
    status?: string;
    bo_status?: string | null;
    statusSortRank?: number | null;
    bo_statusSortRank?: number | null;
    quoteData?: UnknownRecord;
    quoteResponse?: UnknownRecord;
};

function parseRecord(value: unknown): UnknownRecord {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : {};
}

function resolvePublicSessionBase(productType: string): string {
    const code = String(productType || '').trim().toLowerCase();
    return `public/${code}/session`;
}

export const policyCrudApiClient = {
    async listPolicies(filters?: {
        status?: string;
        statusIn?: string[];
        needsAttention?: boolean;
        q?: string;
        projection?: string;
        productType?: string;
        page?: number;
        pageSize?: number;
        paging?: 'cursor';
        cursor?: string | null;
        limit?: number;
        includeTotal?: boolean;
        sortField?: string;
        sortDir?: 'asc' | 'desc';
        sortField2?: string;
        sortDir2?: 'asc' | 'desc';
        sortField3?: string;
        sortDir3?: 'asc' | 'desc';
        viewId?: string;
        filterOps?: Record<string, string>;
    }): Promise<ApiResponse<ApiPolicyRecord[]> & { pagination?: unknown }> {
        const params = new URLSearchParams();
        if (filters?.status) params.append('status', filters.status);
        if (filters?.statusIn?.length) params.append('statusIn', filters.statusIn.join(','));
        if (typeof filters?.needsAttention === 'boolean' && filters.needsAttention) params.append('needsAttention', '1');
        if (filters?.q) params.append('q', filters.q);
        if (filters?.projection) params.append('projection', filters.projection);
        if (filters?.productType) params.append('productType', filters.productType);
        if (filters?.page) params.append('page', filters.page.toString());
        if (filters?.pageSize) params.append('pageSize', filters.pageSize.toString());
        if (filters?.paging === 'cursor') params.append('paging', 'cursor');
        if (filters?.cursor) params.append('cursor', String(filters.cursor));
        if (filters?.limit) params.append('limit', String(filters.limit));
        if (filters?.includeTotal) params.append('includeTotal', '1');
        if (filters?.sortField) params.append('sortField', String(filters.sortField));
        if (filters?.sortDir) params.append('sortDir', String(filters.sortDir));
        if (filters?.sortField2) params.append('sortField2', String(filters.sortField2));
        if (filters?.sortDir2) params.append('sortDir2', String(filters.sortDir2));
        if (filters?.sortField3) params.append('sortField3', String(filters.sortField3));
        if (filters?.sortDir3) params.append('sortDir3', String(filters.sortDir3));
        if (filters?.viewId) params.append('viewId', String(filters.viewId));
        if (filters?.filterOps && typeof filters.filterOps === 'object') {
            for (const [k, v] of Object.entries(filters.filterOps)) {
                if (!k) continue;
                const value = String(v || '').trim();
                if (!value) continue;
                params.append(k, value);
            }
        }
        return http.request<ApiPolicyRecord[]>(`policies?${params.toString()}`) as Promise<ApiResponse<ApiPolicyRecord[]> & { pagination?: unknown }>;
    },

    async getPolicy(id: string): Promise<ApiResponse<ApiPolicyRecord>> {
        return http.request<ApiPolicyRecord>(`policies/${id}`);
    },

    async createPolicy(policyData: UnknownRecord) {
        return http.request('policies', {
            method: 'POST',
            body: JSON.stringify(policyData),
        });
    },

    async updatePolicy(id: string, data: { inceptionDate?: Date; expiryDate?: Date; status?: string }) {
        return http.request(`policies/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    },

    async deletePolicy(policyId: string) {
        return http.request(`policies/${policyId}`, {
            method: 'DELETE',
        });
    },

    async createPolicyFromQuote(quoteData: UnknownRecord, quoteResponse: UnknownRecord, paymentInfo?: UnknownRecord, quoteToken?: string) {
        const quoteResponseRecord = parseRecord(quoteResponse);
        const tok =
            quoteToken ||
            (typeof quoteResponseRecord.quoteToken === 'string' ? quoteResponseRecord.quoteToken : undefined);
        return http.request('policies/create-from-quote', {
            method: 'POST',
            body: JSON.stringify({ quoteData, quoteToken: tok, quoteResponse, paymentInfo }),
        });
    },

    async bindPolicy(policyId: string) {
        return http.request(`policies/${policyId}/bind`, {
            method: 'POST',
        });
    },

    async getPolicyListIndexHealth() {
        return http.request<{
            indexedPolicies: number;
            totalPolicies: number;
            coveragePct: number;
            displayCompletePolicies: number;
            displayCompletenessPct: number;
            backfillRemainingCount: number;
            partialResults: boolean;
        }>('policies/index-health');
    },

    async addUnit(policyId: string, unitData: UnknownRecord) {
        return http.request(`policies/${policyId}/units`, {
            method: 'POST',
            body: JSON.stringify(unitData),
        });
    },

    async generateCertificate(policyId: string) {
        return http.request(`policies/${policyId}/certificate`, {
            method: 'POST',
        });
    },

    async deleteDeclarationBatch(batchId: string) {
        return http.request(`declarations/${batchId}`, {
            method: 'DELETE',
        });
    },

    async assignPolicyProgramBinder(policyId: string, programId: string, binderId: string) {
        return http.request<UnknownRecord>(`policies/${policyId}/program-binder`, {
            method: 'PUT',
            body: JSON.stringify({ programId, binderId }),
        });
    },

    async bindCoverage(policyId: string) {
        return http.request<{ riskTransactionId?: string }>(`policies/${policyId}/bind-coverage`, {
            method: 'POST',
        });
    },

    async generateDocuments(policyId: string, opts?: { docPack?: string; riskTransactionId?: string | null }) {
        return http.request(`policies/${policyId}/documents/generate`, {
            method: 'POST',
            body: JSON.stringify(opts || {}),
        });
    },

    async issuePolicy(policyId: string) {
        return http.request(`policies/${policyId}/issue-policy`, {
            method: 'POST',
        });
    },

    async getExternalIssuanceRequirements(policyId: string) {
        return http.request<{
            canComplete: boolean;
            requiresUpload: boolean;
            documentTypes: string[];
        }>(`policies/${policyId}/external-issuance-requirements`);
    },

    async completeExternalIssuance(policyId: string, documents: Array<{ type: string; file: File }>) {
        const formData = new FormData();
        formData.append('documentTypes', JSON.stringify(documents.map(({ type }) => type)));
        for (const { file } of documents) formData.append('documents', file);
        return http.request(`policies/${policyId}/complete-external-issuance`, {
            method: 'POST',
            body: formData,
        });
    },

    async unlockBoundMode(policyId: string) {
        return http.request(`policies/${policyId}/unlock-bound-mode`, {
            method: 'POST',
        });
    },

    // ── Policy bundle + readiness ──

    async getPolicyBundle(policyId: string) {
        return http.request<{ history?: Array<{ id?: string; transactionType?: string; status?: string; effectiveDate?: string; expiryDate?: string; transactionNumber?: string; pricingFinal?: string | object }> }>(`policies/${policyId}/bundle`);
    },

    async getIssueReadiness(policyId: string, opts?: { channel?: string; riskTransactionId?: string }) {
        const params = new URLSearchParams();
        params.append('channel', opts?.channel || 'bo');
        if (opts?.riskTransactionId) params.append('riskTransactionId', opts.riskTransactionId);
        return http.request(`policies/${policyId}/issue-readiness?${params.toString()}`);
    },

    async getBehaviorFailureZone(policyId: string) {
        return http.request<UnknownRecord>(`behavior/policies/${encodeURIComponent(policyId)}/failure-zone`);
    },

    // ── Public auto session (BO quote wizard) ──

    async getPublicSessionToken(policyId: string) {
        return http.request<{ publicSessionToken?: string; productType?: string }>(`policies/${encodeURIComponent(policyId)}/public-session-token`, { method: 'POST' });
    },

    async createQuoteSession(productType: string, payload?: { origin?: string }) {
        return http.request<{ policyId?: string; publicSessionToken?: string }>(resolvePublicSessionBase(productType), {
            method: 'POST',
            body: JSON.stringify(payload || { origin: 'bo' }),
        });
    },

    async patchQuoteSession(productType: string, publicId: string, payload: Record<string, unknown>) {
        return http.request(`${resolvePublicSessionBase(productType)}/${publicId}`, {
            method: 'PATCH',
            body: JSON.stringify(payload),
        });
    },

    async rateQuote(productType: string, publicId: string, payload?: { quoteData?: unknown }) {
        return http.request<{ status?: string }>(`${resolvePublicSessionBase(productType)}/${publicId}/rate`, {
            method: 'POST',
            body: JSON.stringify(payload || {}),
        });
    },

    // ── Misc ──

    async saveQuoteHistory(policyId: string) {
        return http.request(`policies/${policyId}/quote-history/save`, { method: 'POST' });
    },

    async manualUwApproval(policyId: string) {
        return http.request(`policies/${policyId}/manual-uw-approval`, { method: 'POST' });
    },

    async listMbeTemplates(scope: { productType?: string; policyId?: string; programId?: string }) {
        const params = new URLSearchParams();
        if (scope.productType) params.set('productType', scope.productType);
        if (scope.policyId) params.set('policyId', scope.policyId);
        if (scope.programId) params.set('programId', scope.programId);
        const q = params.toString();
        if (!q) {
            return { success: false, error: { message: 'listMbeTemplates requires productType, policyId, or programId' } } as const;
        }
        return http.request<unknown[]>(`mbe/templates?${q}`);
    },

    async getCoverageSelection(policyId: string) {
        return http.request(`policies/${encodeURIComponent(policyId)}/coverage-selection`);
    },

    async getCoverageOptionsView(policyId: string) {
        return http.request(`policies/${encodeURIComponent(policyId)}/coverage-options-view`);
    },

    async saveCoverageSelection(policyId: string, payload: Record<string, unknown>) {
        return http.request<Record<string, unknown>>(`policies/${encodeURIComponent(policyId)}/coverage-selection`, {
            method: 'PUT',
            body: JSON.stringify(payload),
        });
    },

    async initCoverageSelection(policyId: string) {
        return http.request<Record<string, unknown>>(`policies/${encodeURIComponent(policyId)}/coverage-selection/init`, {
            method: 'POST',
            body: JSON.stringify({}),
        });
    },

    async restoreQuoteVersion(policyId: string, versionId: string) {
        return http.request(`policies/${policyId}/quote-history/${versionId}/restore`, { method: 'POST' });
    },

    async getPolicyFeed(policyId: string) {
        return http.request<unknown[]>(`policies/${policyId}/feed`);
    },
};

export type PolicyCrudApiClient = typeof policyCrudApiClient;

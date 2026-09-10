/**
 * Claims API Client — Domain-Scoped (CHAMPS)
 *
 * Canonical import for all claims-related API calls.
 * Owns: CRUD, FNOL, worksheet commands, claim forms, developments,
 *       assignments, reserves, info requests, public FNOL.
 *
 * Calls http.request() directly — does NOT depend on the monolithic ApiClient class.
 */
import { http } from '@/src/shared/api/http';
import type { ApiResponse } from '@/src/shared/api/types';
import type { ClaimWorksheetCommandPayload } from '@/src/modules/claims/model/claimWorksheetCommands';
import type { ClaimsContractDto } from '@/src/modules/claims/intake/model/clientFnol.types';
import type { ClaimStatutoryTimetableResult } from '@/src/modules/claims/model/statutoryTimetableTypes';

type UnknownRecord = Record<string, unknown>;

// ─── Client ───

export const claimsApiClient = {
    // ── Core CRUD ──

    async submitClaim(claimData: UnknownRecord) {
        return http.request('claims', {
            method: 'POST',
            body: JSON.stringify(claimData),
        });
    },

    async getClaim(id: string) {
        return http.request(`claims/${id}`);
    },

    async listClaims(filters?: {
        status?: string;
        statusIn?: string[];
        policyId?: string;
        include?: string[];
        page?: number;
        pageSize?: number;
        search?: string;
        sortBy?: string;
        sortDir?: 'asc' | 'desc';
    }): Promise<ApiResponse<unknown[]> & { pagination?: { total?: number } }> {
        const params = new URLSearchParams();
        if (filters?.status) params.append('status', filters.status);
        if (filters?.statusIn?.length) params.append('statusIn', filters.statusIn.join(','));
        if (filters?.policyId) params.append('policyId', filters.policyId);
        if (filters?.include?.length) params.append('include', filters.include.join(','));
        if (filters?.page) params.append('page', filters.page.toString());
        if (filters?.pageSize) params.append('pageSize', filters.pageSize.toString());
        if (filters?.search) params.append('search', filters.search);
        if (filters?.sortBy) params.append('sortBy', filters.sortBy);
        if (filters?.sortDir) params.append('sortDir', filters.sortDir);
        return http.request<unknown[]>(`claims?${params.toString()}`) as Promise<ApiResponse<unknown[]> & { pagination?: { total?: number } }>;
    },

    async adjudicateClaim(id: string, decision: UnknownRecord) {
        return http.request(`claims/${id}/adjudicate`, {
            method: 'PUT',
            body: JSON.stringify(decision),
        });
    },

    async getClaimContract(claimId: string) {
        return http.request(`claims/${claimId}/contract`);
    },

    // ── FNOL ──

    async submitFnol(policyId: string, payload: { form: UnknownRecord }) {
        return http.request(`policies/${policyId}/claims`, {
            method: 'POST',
            body: JSON.stringify(payload || {}),
        });
    },

    async getPolicyClaimsContract(policyId: string) {
        return http.request<{ contract?: ClaimsContractDto }>(`policies/${policyId}/claims/contract`);
    },

    async submitFnolFinal(claimId: string, payload: { form: UnknownRecord }) {
        return http.request(`claims/${claimId}/fnol/submit`, {
            method: 'POST',
            body: JSON.stringify(payload || {}),
        });
    },

    async sendFnolLink(claimId: string, payload?: { email?: string }) {
        return http.request<{ sent: boolean; recipientEmail: string; fnolLink: string }>(`claims/${claimId}/fnol-link/send`, {
            method: 'POST',
            body: JSON.stringify(payload || {}),
        });
    },

    // ── Public FNOL ──

    async getPublicFnolContext(token: string) {
        return http.request<{
            claimId: string;
            claimNumber: string;
            policyId: string;
            policyNumber: string | null;
            policyHolderName: string;
            policyHolderContact: string;
            quoteData: Record<string, unknown>;
            driverInfo: Record<string, unknown>;
            vehicleInfo: Record<string, unknown>;
            expiresAt: string | null;
            contract?: Record<string, unknown>;
        }>(`public/fnol/${encodeURIComponent(token)}/context`);
    },

    async submitPublicFnol(token: string, payload: { form: Record<string, unknown> }) {
        return http.request<{ claimId: string; submitted: boolean }>(`public/fnol/${encodeURIComponent(token)}/submit`, {
            method: 'POST',
            body: JSON.stringify(payload || {}),
        });
    },

    // ── Worksheet ──

    async getClaimWorksheet(id: string) {
        return http.request(`claims/${id}/worksheet`);
    },

    async getClaimStatutoryTimetable(id: string) {
        return http.request<ClaimStatutoryTimetableResult>(`claims/${id}/statutory-timetable`);
    },

    async createClaimWorksheet(input: {
        policyId?: string | null;
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
        worksheet?: {
            certificateReference?: string;
            dateOfLossFrom?: string;
            dateOfLossTo?: string;
            lossCountry?: string;
            causeOfLossCode?: string;
            lossDescription?: string;
            originalCurrency?: string;
            openedAt?: string;
            referredToUw?: boolean;
        };
    }) {
        return http.request('claims', {
            method: 'POST',
            body: JSON.stringify(input || {}),
        });
    },

    async executeClaimWorksheetCommand(claimId: string, payload: ClaimWorksheetCommandPayload) {
        return http.request(`claims/${claimId}/commands`, {
            method: 'POST',
            body: JSON.stringify(payload || {}),
        });
    },

    async confirmFnol(claimId: string, payload?: { version?: number }) {
        return claimsApiClient.executeClaimWorksheetCommand(claimId, {
            type: 'CONFIRM_FNOL',
            payload: payload || {},
        });
    },

    async requestFnolClarification(claimId: string, payload: { fieldsRequested: string[]; message?: string; requestId?: string }) {
        return claimsApiClient.executeClaimWorksheetCommand(claimId, {
            type: 'REQUEST_FNOL_CLARIFICATION',
            payload,
        });
    },

    async amendFnol(claimId: string, payload: { fnol: UnknownRecord; changes?: Array<{ path: string; from: unknown; to: unknown }> }) {
        return claimsApiClient.executeClaimWorksheetCommand(claimId, {
            type: 'AMEND_FNOL',
            payload,
        });
    },

    async recordFnolClarificationReceived(claimId: string, payload: { requestId?: string; message?: string }) {
        return claimsApiClient.executeClaimWorksheetCommand(claimId, {
            type: 'FNOL_CLARIFICATION_RECEIVED',
            payload,
        });
    },

    // ── Claim Form ──

    async submitClaimForm(claimId: string, payload: { claimType?: string; form: UnknownRecord }) {
        return http.request(`claims/${claimId}/form`, {
            method: 'PATCH',
            body: JSON.stringify(payload || {}),
        });
    },

    async sendClaimFormPackage(claimId: string) {
        return http.request(`claims/${claimId}/claim-form-package/send`, {
            method: 'POST',
        });
    },

    async getClaimFormPackage(claimId: string) {
        return http.request(`claims/${claimId}/claim-form-package`);
    },

    async openClaimFormPackage(claimId: string) {
        return http.request(`claims/${claimId}/claim-form-package/open`, {
            method: 'POST',
        });
    },

    async submitClaimFormPackage(claimId: string, payload: { responses: Record<string, unknown> }) {
        return http.request(`claims/${claimId}/claim-form-package/submit`, {
            method: 'POST',
            body: JSON.stringify(payload || {}),
        });
    },

    // ── Info Requests ──

    async respondToClaimInfoRequest(claimId: string, requestId: string, payload: { message: string; documents?: UnknownRecord[] }) {
        return http.request(`claims/${claimId}/info-requests/${requestId}/respond`, {
            method: 'POST',
            body: JSON.stringify(payload || {}),
        });
    },

    async createClaimInfoRequest(claimId: string, payload: { message: string }) {
        return http.request(`claims/${claimId}/info-requests`, {
            method: 'POST',
            body: JSON.stringify(payload || {}),
        });
    },

    // ── Developments ──

    async createClaimDevelopment(
        claimId: string,
        payload: {
            type: 'RESERVE_UPDATE' | 'CASE_SETTLEMENT' | 'APPOINTMENT' | 'INFO_REQUEST' | 'ASSIGNMENT' | 'LAWSUIT' | 'NOTE';
            templateId?: string;
            payload?: Record<string, unknown>;
            attachments?: string[];
        },
    ) {
        return http.request(`claims/${claimId}/developments`, {
            method: 'POST',
            body: JSON.stringify(payload || {}),
        });
    },

    async approveClaimDevelopment(claimId: string, developmentId: string) {
        return http.request(`claims/${claimId}/developments/${developmentId}/approve`, {
            method: 'POST',
        });
    },

    async rejectClaimDevelopment(claimId: string, developmentId: string, payload: { reason: string }) {
        return http.request(`claims/${claimId}/developments/${developmentId}/reject`, {
            method: 'POST',
            body: JSON.stringify(payload || {}),
        });
    },

    async revertClaimDevelopment(claimId: string, developmentId: string) {
        return http.request(`claims/${claimId}/developments/${developmentId}/revert`, {
            method: 'POST',
        });
    },

    async addClaimDevelopmentComment(claimId: string, developmentId: string, payload: { message: string; parentId?: string }) {
        return http.request(`claims/${claimId}/developments/${developmentId}/comments`, {
            method: 'POST',
            body: JSON.stringify(payload || {}),
        });
    },

    async attachClaimDevelopmentDocuments(claimId: string, developmentId: string, payload: { documentIds: string[] }) {
        return http.request(`claims/${claimId}/developments/${developmentId}/attachments`, {
            method: 'POST',
            body: JSON.stringify(payload || {}),
        });
    },

    // ── Assignments & Reserves ──

    async addClaimAssignment(
        claimId: string,
        payload: {
            role: 'lawyer' | 'adjuster' | 'estimator' | 'other';
            pro: { name: string; company?: string; email?: string; phone?: string };
            notes?: string;
        },
    ) {
        return http.request(`claims/${claimId}/assignments`, {
            method: 'POST',
            body: JSON.stringify(payload || {}),
        });
    },

    async addClaimReserve(
        claimId: string,
        payload: {
            type: 'IBNR' | 'CASE_RESERVE' | 'PAID' | 'RECOVERY' | 'ADJUSTMENT';
            amount: number;
            currency: string;
            notes?: string;
        },
    ) {
        return http.request(`claims/${claimId}/reserves`, {
            method: 'POST',
            body: JSON.stringify(payload || {}),
        });
    },

    // ── Claim Memory (ADR-0041) ──
    // Read the cached ClaimMemoryProjection for the Claim Workspace
    // co-pilot card.  Returns `status: 'absent'` when no projection row
    // exists yet (handler should show "Click Refresh to compute" CTA).
    async getClaimMemory(claimId: string) {
        return http.request<{
            claimId: string;
            status: 'absent' | 'present';
            stalenessWarning: boolean;
            projection: {
                summary: string | null;
                summaryCitations: unknown[];
                memoryObject: UnknownRecord;
                similarClaims: Array<{
                    claimId: string;
                    score: number;
                    reasons: Array<{ code: string; detail?: string }>;
                    generatedAt: string;
                }>;
                graphSignals: UnknownRecord;
                refreshStatus: 'pending' | 'refreshing' | 'fresh' | 'stale' | 'failed';
                refreshError: string | null;
                lastRefreshedAt: string | null;
                updatedAt: string;
            } | null;
        }>(`claims/${claimId}/memory`);
    },

    async refreshClaimMemory(claimId: string) {
        return http.request<{ claimId: string; enqueued: boolean; message: string }>(
            `claims/${claimId}/memory/refresh`,
            { method: 'POST' },
        );
    },

    // ADR-0044 — retrieval-grounded, read-only ask over claim memory.
    // The answer is always cited and the LLM cannot mutate state.
    async askClaimMemory(claimId: string, question: string) {
        return http.request<{
            answer: string;
            citations: Array<{
                threadId?: string;
                messageId?: string;
                documentId?: string;
                quote: string;
            }>;
            mode: 'llm' | 'extractive' | 'no_evidence';
            channelsUsed: string[];
            passageCount: number;
        }>(`claims/${claimId}/memory/ask`, {
            method: 'POST',
            body: JSON.stringify({ question }),
        });
    },
};

export type ClaimsApiClient = typeof claimsApiClient;

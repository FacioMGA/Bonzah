/**
 * Programs & Binders API Client — Domain-Scoped (CHAMPS)
 *
 * Canonical import for all program and binder API calls.
 * Owns: program CRUD, UW config, rating models, binder CRUD, usage, publishing.
 *
 * Calls http.request() directly — does NOT depend on the monolithic ApiClient class.
 */
import { http } from '@/src/shared/api/http';
import type {
    PersistedRatingModel,
    PricingStage,
    RatingMatrix,
} from '@/src/modules/programs/model/programs';

type UnknownRecord = Record<string, unknown>;

// ─── Programs ───

export const programsApiClient = {
    // ── Program CRUD ──

    async listPrograms() {
        return http.request<UnknownRecord[]>('programs');
    },

    async getProgram(id: string) {
        return http.request<UnknownRecord>(`programs/${id}`);
    },

    async createProgram(data: UnknownRecord) {
        return http.request<UnknownRecord>('programs', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async updateProgram(id: string, data: UnknownRecord) {
        return http.request<UnknownRecord>(`programs/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    },

    // ── Rating ──

    async getProgramRatingMatrix(id: string) {
        return http.request<RatingMatrix>(`programs/${id}/rating-matrix`);
    },

    async getProgramRatingModel(id: string) {
        return http.request<PersistedRatingModel>(`programs/${id}/rating-model`);
    },

    async saveProgramRatingModel(
        id: string,
        data: { stages: PricingStage[]; tables: RatingMatrix; source?: string; name?: string; notes?: string },
    ) {
        return http.request<PersistedRatingModel>(`programs/${id}/rating-model`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    },

    async publishProgramRatingModel(id: string, binderProductAuthorityIds: string[]) {
        return http.request<PersistedRatingModel>(`programs/${id}/rating-model/publish`, {
            method: 'POST',
            body: JSON.stringify({ binderProductAuthorityIds }),
        });
    },

    // ── Binder CRUD ──

    async listBinders() {
        return http.request<UnknownRecord[]>('binders');
    },

    async getBinder(id: string) {
        return http.request<UnknownRecord>(`binders/${id}`);
    },

    async createBinder(data: UnknownRecord) {
        return http.request<UnknownRecord>('binders', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async updateBinder(id: string, data: UnknownRecord) {
        return http.request<UnknownRecord>(`binders/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    },

    async uploadBinder(file: File) {
        const formData = new FormData();
        formData.append('file', file);
        return http.request<UnknownRecord>('binders/upload', {
            method: 'POST',
            body: formData,
        });
    },

    // ── Binder Operations ──

    async getBinderUsage(id: string) {
        return http.request<UnknownRecord>(`binders/${id}/usage`);
    },

    async simulateBinderCheck(
        id: string,
        data: {
            territory?: string;
            riskLocationCountry?: string;
            insuredDomicileCountry?: string;
            vehicleValue?: number;
        }
    ) {
        return http.request<UnknownRecord>(`binders/${id}/simulate-check`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async publishBinder(id: string) {
        return http.request<UnknownRecord>(`binders/${id}/publish`, { method: 'POST' });
    },
};

export type ProgramsApiClient = typeof programsApiClient;

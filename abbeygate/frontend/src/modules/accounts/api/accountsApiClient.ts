/**
 * Accounts API Client — Domain-Scoped (CHAMPS)
 *
 * Canonical import for account (policy holder account) API calls.
 * Owns: list, get, create, update, delete.
 *
 * Calls http.request() directly.
 */
import { http } from '@/src/shared/api/http';

type UnknownRecord = Record<string, unknown>;

export const accountsApiClient = {
    async listAccountIntelligence(params?: {
        cursor?: string | null;
        limit?: number;
        search?: string;
        sortField?: 'state' | 'lastActivityAt' | 'totalPremium' | 'accountName';
        sortDir?: 'asc' | 'desc';
    }) {
        const sp = new URLSearchParams();
        if (params?.cursor) sp.set('cursor', String(params.cursor));
        if (typeof params?.limit === 'number') sp.set('limit', String(params.limit));
        if (params?.search) sp.set('search', String(params.search));
        if (params?.sortField) sp.set('sortField', String(params.sortField));
        if (params?.sortDir) sp.set('sortDir', String(params.sortDir));
        sp.set('mode', 'recordList');
        const qs = sp.toString();
        return http.request(qs ? `accounts/intelligence?${qs}` : 'accounts/intelligence');
    },

    async getAccountIntelligence(id: string) {
        return http.request(`accounts/${id}/intelligence`);
    },

    async listAccounts(params?: { cursor?: string | null; limit?: number; search?: string; sortField?: string; sortDir?: 'asc' | 'desc' }) {
        const sp = new URLSearchParams();
        if (params?.cursor) sp.set('cursor', String(params.cursor));
        if (typeof params?.limit === 'number') sp.set('limit', String(params.limit));
        if (params?.search) sp.set('search', String(params.search));
        if (params?.sortField) sp.set('sortField', String(params.sortField));
        if (params?.sortDir) sp.set('sortDir', String(params.sortDir));
        sp.set('mode', 'recordList');
        const qs = sp.toString();
        return http.request(qs ? `accounts?${qs}` : 'accounts');
    },

    async getAccount(id: string) {
        return http.request(`accounts/${id}`);
    },

    async createAccount(data: UnknownRecord) {
        return http.request('accounts', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async updateAccount(id: string, data: UnknownRecord) {
        return http.request(`accounts/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    },

    async deleteAccount(id: string) {
        return http.request(`accounts/${id}`, {
            method: 'DELETE',
        });
    },

    async listAccounts360(params?: {
        cursor?: string | null;
        limit?: number;
        search?: string;
        sortField?: 'accountName' | 'lastActivityAt' | 'healthScore' | 'annualizedPremium';
        sortDir?: 'asc' | 'desc';
    }) {
        const sp = new URLSearchParams();
        if (params?.cursor) sp.set('cursor', String(params.cursor));
        if (typeof params?.limit === 'number') sp.set('limit', String(params.limit));
        if (params?.search) sp.set('search', String(params.search));
        if (params?.sortField) sp.set('sortField', String(params.sortField));
        if (params?.sortDir) sp.set('sortDir', String(params.sortDir));
        sp.set('mode', 'recordList');
        const qs = sp.toString();
        return http.request(qs ? `accounts360?${qs}` : 'accounts360');
    },

    async getAccount360Overview(id: string) {
        return http.request(`accounts360/${id}/overview`);
    },

    async getAccount360Policies(id: string) {
        return http.request(`accounts360/${id}/policies`);
    },

    async getAccount360Claims(id: string) {
        return http.request(`accounts360/${id}/claims`);
    },

    async getAccount360Billing(id: string) {
        return http.request(`accounts360/${id}/billing`);
    },

    async getAccount360Documents(id: string) {
        return http.request(`accounts360/${id}/documents`);
    },

    async getAccount360Communications(id: string) {
        return http.request(`accounts360/${id}/communications`);
    },

    async getAccount360Contacts(id: string) {
        return http.request(`accounts360/${id}/contacts`);
    },

    async getAccount360Feed(id: string, params?: { cursor?: string | null; limit?: number }) {
        const sp = new URLSearchParams();
        if (params?.cursor) sp.set('cursor', String(params.cursor));
        if (typeof params?.limit === 'number') sp.set('limit', String(params.limit));
        const qs = sp.toString();
        return http.request(qs ? `accounts360/${id}/feed?${qs}` : `accounts360/${id}/feed`);
    },

    async getAccount360Notes(id: string) {
        return http.request(`accounts360/${id}/notes`);
    },

    async createAccount360Note(id: string, data: { body: string }) {
        return http.request(`accounts360/${id}/notes`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },
};

export type AccountsApiClient = typeof accountsApiClient;

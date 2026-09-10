/**
 * Settings & Reporting API Client — Domain-Scoped (CHAMPS)
 *
 * Canonical import for settings and dashboard API calls.
 * Owns: global settings, template settings, email template settings,
 *       key-value settings, dashboard.
 *
 * Calls http.request() / http.requestBinary() directly.
 */
import { http } from '@/src/shared/api/http';
import type { ApiResponse } from '@/src/shared/api/types';

type UnknownRecord = Record<string, unknown>;

export interface DashboardData {
    units: {
        active: number;
        total?: number;
    };
    gwp: number;
    egwpi: number;
    exceptions: {
        pendingClaims: number;
        failedDeclarations?: number;
    };
    history?: {
        name: string;
        gwp: number;
        claims: number;
    }[];
    accounts?: {
        name: string;
        units: number;
        status: string;
        gwp: string;
        ex: number;
    }[];
    claimsKpis?: Record<string, unknown>;
}

export const settingsApiClient = {
    // ── Global Settings ──

    async getGlobalSettings() {
        return http.request<UnknownRecord>('settings/global_commissions');
    },

    async updateGlobalSettings(settings: UnknownRecord) {
        return http.request('settings/global_commissions', {
            method: 'POST',
            body: JSON.stringify(settings),
        });
    },

    // ── Template Settings ──

    async getTemplateSettings() {
        return http.request<UnknownRecord>('settings/templates');
    },

    async updateTemplateSettings(settings: UnknownRecord) {
        return http.request('settings/templates', {
            method: 'POST',
            body: JSON.stringify(settings),
        });
    },

    async uploadTemplate(file: File, type: 'quote' | 'certificate' | 'invoice' | 'bordereaux') {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('type', type);
        return http.request<UnknownRecord>('settings/templates/upload', {
            method: 'POST',
            body: formData,
        });
    },

    // ── Email Template Settings ──

    async getEmailTemplateSettings() {
        return http.request('settings/email_templates');
    },

    async updateEmailTemplateSettings(data: { sendgridAutoQuoteInitialTemplateId?: string; sendgridAutoQuoteResendTemplateId?: string }) {
        return http.request('settings/email_templates', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    // ── Key-Value Settings ──

    async getSettings(key: string) {
        return http.request<unknown>(`settings/${key}`);
    },

    async saveSettings(key: string, value: unknown) {
        return http.request(`settings/${key}`, {
            method: 'POST',
            body: JSON.stringify(value),
        });
    },

    // ── Reporting ──

    async getDashboard(period?: { start?: string; end?: string; mode?: 'MTD' | 'FULL'; programId?: string }): Promise<ApiResponse<DashboardData>> {
        const params = new URLSearchParams();
        if (period?.start) params.append('period.start', period.start);
        if (period?.end) params.append('period.end', period.end);
        if (period?.mode) params.append('mode', period.mode);
        if (period?.programId) params.append('programId', period.programId);
        return http.request<DashboardData>(`reports/dashboard?${params.toString()}`);
    },

};

export type SettingsApiClient = typeof settingsApiClient;

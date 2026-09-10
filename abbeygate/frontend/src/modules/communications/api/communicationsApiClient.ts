/**
 * Communications API Client — Domain-Scoped (CHAMPS)
 *
 * Owns: templates, threads, messages, recipients for the communications subsystem.
 */
import { http } from '@/src/shared/api/http';
import type {
    CommunicationAttachment,
    CommunicationSummary,
    CommunicationThread,
    CommunicationTemplate,
    CommunicationTimelinePayload,
    CrossContextThread,
    DeliveryAttempt,
    FailedDelivery,
    NextActionSuggestion,
    ResolvedRecipient,
    TemplateRenderPreview,
    TemplateVariableDescriptor,
} from '../model/types';

export const communicationsApiClient = {
    async listTemplates(filters?: { channel?: string }) {
        const params = new URLSearchParams();
        if (filters?.channel) params.append('channel', filters.channel);
        return http.request<CommunicationTemplate[]>(`templates?${params.toString()}`);
    },

    async listThreads(filters: { entityType: string; entityId: string }) {
        const params = new URLSearchParams({
            entityType: filters.entityType,
            entityId: filters.entityId,
        });
        return http.request<CommunicationThread[]>(`communications/threads?${params.toString()}`);
    },

    async sendMessage(payload: {
        entityType: string;
        entityId: string;
        primaryPartyId?: string;
        direction: string;
        channel: string;
        provider: string;
        communicationType?: string;
        fromActor?: string;
        toRecipients: string[];
        subject?: string;
        body?: string;
        attachments?: CommunicationAttachment[];
        status: string;
        templateId?: string;
        templateVariables?: Record<string, unknown>;
        renderedBody?: string;
        renderedSubject?: string;
        missingVariables?: string[];
    }) {
        return http.request('communications/messages', {
            method: 'POST',
            body: JSON.stringify(payload),
        });
    },

    async listRecipients(filters: { entityType: string; entityId: string }) {
        const params = new URLSearchParams({
            entityType: filters.entityType,
            entityId: filters.entityId,
        });
        return http.request<ResolvedRecipient[]>(`communications/recipients?${params.toString()}`);
    },

    async listTimeline(filters: { entityType: string; entityId: string }) {
        const params = new URLSearchParams({
            entityType: filters.entityType,
            entityId: filters.entityId,
        });
        return http.request<CommunicationTimelinePayload>(`communications/timeline?${params.toString()}`);
    },

    async getTemplateVariables(templateId: string) {
        return http.request<TemplateVariableDescriptor>(`templates/${templateId}/variables`);
    },

    async renderTemplate(payload: { templateId: string; variables: Record<string, unknown> }) {
        return http.request<TemplateRenderPreview>('templates/render', {
            method: 'POST',
            body: JSON.stringify(payload),
        });
    },

    async retryMessage(messageId: string) {
        return http.request(`communications/messages/${messageId}/retry`, {
            method: 'POST',
        });
    },

    async getDeliveryAttempts(messageId: string) {
        return http.request<DeliveryAttempt[]>(`communications/messages/${messageId}/delivery-attempts`);
    },

    async getFailedDeliveries(filters: { entityType: string; entityId: string }) {
        const params = new URLSearchParams({
            entityType: filters.entityType,
            entityId: filters.entityId,
        });
        return http.request<FailedDelivery[]>(`communications/failed-deliveries?${params.toString()}`);
    },

    async getSummary(filters: { entityType: string; entityId: string }) {
        const params = new URLSearchParams({
            entityType: filters.entityType,
            entityId: filters.entityId,
        });
        return http.request<CommunicationSummary[]>(`communications/summary?${params.toString()}`);
    },

    async generateDraft(payload: { entityType: string; entityId: string; threadId?: string; intent?: string }) {
        return http.request('communications/draft', {
            method: 'POST',
            body: JSON.stringify(payload),
        });
    },

    async getNextActions(filters: { entityType: string; entityId: string }) {
        const params = new URLSearchParams({
            entityType: filters.entityType,
            entityId: filters.entityId,
        });
        return http.request<NextActionSuggestion[]>(`communications/next-actions?${params.toString()}`);
    },

    async getCrossContext(filters: { entityType: string; entityId: string }) {
        const params = new URLSearchParams({
            entityType: filters.entityType,
            entityId: filters.entityId,
        });
        return http.request<CrossContextThread[]>(`communications/cross-context?${params.toString()}`);
    },

    async requestApproval(messageId: string, reason?: string) {
        return http.request(`communications/messages/${messageId}/request-approval`, {
            method: 'POST',
            body: JSON.stringify({ reason }),
        });
    },

    async approveMessage(messageId: string, reason?: string) {
        return http.request(`communications/messages/${messageId}/approve`, {
            method: 'POST',
            body: JSON.stringify({ reason }),
        });
    },

    async rejectMessage(messageId: string, reason?: string) {
        return http.request(`communications/messages/${messageId}/reject`, {
            method: 'POST',
            body: JSON.stringify({ reason }),
        });
    },

    async uploadAttachments(files: File[]) {
        const formData = new FormData();
        files.forEach((file) => formData.append('files', file));
        return http.request<CommunicationAttachment[]>('communications/attachments', {
            method: 'POST',
            body: formData,
        });
    },
};

export type CommunicationsApiClient = typeof communicationsApiClient;

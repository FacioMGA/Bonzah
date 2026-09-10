/**
 * BO client for OAuth-client (DCR-registered) management (ADR-0040 §6).
 * Hits /api/bo/mcp/oauth-clients behind the BO JWT.
 */
import { http } from '@/src/shared/api/http';

export interface OAuthClientListEntry {
    client_id: string;
    client_name: string;
    client_uri: string | null;
    redirect_uris: string[];
    scopes: string[];
    registration_kind: 'dcr' | 'predefined';
    is_public: boolean;
    created_at: string;
    revoked_at: string | null;
}

interface ApiEnvelope<T> {
    success: boolean;
    data?: T;
    error?: { code: string; message: string };
}

export const oauthClientsApi = {
    async list(): Promise<OAuthClientListEntry[]> {
        const raw = (await http.request<unknown>('mcp/oauth-clients')) as unknown as ApiEnvelope<OAuthClientListEntry[]>;
        return raw.data ?? [];
    },

    async revoke(clientId: string): Promise<void> {
        await http.request<unknown>(`mcp/oauth-clients/${clientId}/revoke`, { method: 'POST' });
    },
};

/**
 * BO client for MCP API key management (ADR-0036 amendment).
 * Hits /api/bo/mcp/keys behind the BO JWT.
 */
import { http } from '@/src/shared/api/http';

export type McpKeyFamily = 'config' | 'operator';

export interface McpApiKeyListEntry {
    id: string;
    name: string;
    family: McpKeyFamily | 'unknown';
    accountId: string;
    permissions: string[];
    isActive: boolean;
    createdAt: string;
    lastUsedAt: string | null;
    expiresAt: string | null;
}

export interface IssuedMcpKey {
    apiKeyId: string;
    name: string;
    family: McpKeyFamily;
    permissions: string[];
    rawKey: string;
    operatingTenantSlug: string;
    mountPath: '/api/v1/mcp/config' | '/api/v1/mcp/operator';
    expiresAt: string | null;
}

export interface ApiEnvelope<T> {
    success: boolean;
    data?: T;
    error?: { code: string; message: string };
}

export const mcpKeysApi = {
    async list(): Promise<McpApiKeyListEntry[]> {
        const raw = (await http.request<unknown>('mcp/keys')) as unknown as ApiEnvelope<McpApiKeyListEntry[]>;
        return raw.data ?? [];
    },

    async issue(args: {
        name: string;
        family: McpKeyFamily;
        includePublishSandbox: boolean;
        includeOperatorMutate?: boolean;
    }): Promise<IssuedMcpKey> {
        const raw = (await http.request<unknown>('mcp/keys', {
            method: 'POST',
            body: JSON.stringify(args),
        })) as unknown as ApiEnvelope<IssuedMcpKey>;
        if (!raw.success || !raw.data) {
            throw new Error(raw.error?.message ?? 'Failed to issue MCP key');
        }
        return raw.data;
    },

    async revoke(id: string): Promise<void> {
        await http.request<unknown>(`mcp/keys/${id}/revoke`, { method: 'POST' });
    },
};

/**
 * BO client for the operator MCP action history (ADR-0039 §9).
 * Hits /api/bo/mcp/actions behind the BO JWT.
 */
import { http } from '@/src/shared/api/http';

export interface OperatorActionListEntry {
    id: string;
    occurred_at: string;
    action: string;
    actor_id: string;
    actor_name: string | null;
    entity_type: string;
    entity_id: string;
    diff: unknown;
}

interface ApiEnvelope<T> {
    success: boolean;
    data?: T;
    error?: { code: string; message: string };
}

export interface OperatorActionFilter {
    limit?: number;
    actorId?: string;
    actionPrefix?: string;
    entityId?: string;
    occurredAfter?: string;
}

export const mcpActionsApi = {
    async list(filter: OperatorActionFilter = {}): Promise<OperatorActionListEntry[]> {
        const params = new URLSearchParams();
        if (filter.limit !== undefined) params.set('limit', String(filter.limit));
        if (filter.actorId) params.set('actorId', filter.actorId);
        if (filter.actionPrefix) params.set('actionPrefix', filter.actionPrefix);
        if (filter.entityId) params.set('entityId', filter.entityId);
        if (filter.occurredAfter) params.set('occurredAfter', filter.occurredAfter);
        const suffix = params.toString();
        const path = `mcp/actions${suffix ? `?${suffix}` : ''}`;
        const raw = (await http.request<unknown>(path)) as unknown as ApiEnvelope<OperatorActionListEntry[]>;
        return raw.data ?? [];
    },
};

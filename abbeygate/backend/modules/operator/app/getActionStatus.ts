import type { McpContext } from '../../mcp/domain/mcpContext.js';
import { listRecentOperatorActions } from '../infra/repositories/operatorAuditRepo.js';

export interface GetActionStatusInput {
    limit?: number;
}

export interface RecentActionEntry {
    action_id: string;
    occurred_at: string;
    action_name: string;
    entity_type: string;
    entity_id: string;
    summary: string | null;
    status: string | null;
}

export interface GetActionStatusOutput {
    actor_id: string;
    count: number;
    actions: RecentActionEntry[];
}

/**
 * Reads recent `OPERATOR.*` AuditAction rows for the calling identity
 * (`actorId = apikey:<id>` from the MCP context). Lets a remote agent
 * answer "what did I do recently?" without scraping server logs.
 *
 * Tenant scoping is enforced by `tenantScopedPrisma` inside the repo —
 * the agent only sees actions performed in its own operating tenant.
 */
export async function getActionStatus(
    input: GetActionStatusInput,
    ctx: McpContext,
): Promise<GetActionStatusOutput> {
    const rows = await listRecentOperatorActions({
        actorId: ctx.userId,
        limit: input.limit,
    });
    return {
        actor_id: ctx.userId,
        count: rows.length,
        actions: rows.map((r) => {
            const diff = r.diff as Record<string, unknown> | null;
            return {
                action_id: r.id,
                occurred_at: r.occurredAt.toISOString(),
                action_name: r.actionName,
                entity_type: r.entityType,
                entity_id: r.entityId,
                summary: typeof diff?.summary === 'string' ? diff.summary : null,
                status: typeof diff?.status === 'string' ? diff.status : null,
            };
        }),
    };
}

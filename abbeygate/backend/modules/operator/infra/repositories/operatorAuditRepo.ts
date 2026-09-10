/**
 * Tenant-scoped reader for `AuditAction` rows produced by operator MCP
 * tool calls. The Prisma write happens inside `recordMcpAudit` (shared
 * MCP funnel); this repo only reads back for `operator.get_action_status`.
 *
 * Operator MCP module guard
 * (`tools/quality/check-operator-mcp-no-direct-db-writes.mjs`) ensures
 * THIS is the only file in `backend/modules/operator/` that touches
 * `tenantScopedPrisma.auditAction.*` and that there are no other
 * `create|update|delete|upsert` calls in the module at all.
 */
import { tenantScopedPrisma } from '../../../../platform/db/connection.js';

export interface OperatorActionRow {
    id: string;
    occurredAt: Date;
    actionName: string;
    actorId: string;
    actorName: string | null;
    entityType: string;
    entityId: string;
    diff: unknown;
}

export async function listRecentOperatorActions(args: {
    actorId: string;
    limit?: number;
}): Promise<OperatorActionRow[]> {
    const rows = await tenantScopedPrisma.auditAction.findMany({
        where: {
            actorId: args.actorId,
            actionName: { startsWith: 'OPERATOR.' },
        },
        orderBy: { occurredAt: 'desc' },
        take: Math.min(Math.max(args.limit ?? 20, 1), 100),
    });
    return rows.map((r) => ({
        id: r.id,
        occurredAt: r.occurredAt,
        actionName: r.actionName,
        actorId: r.actorId,
        actorName: r.actorName,
        entityType: r.entityType,
        entityId: r.entityId,
        diff: r.diff,
    }));
}

/**
 * BO-facing variant (no actor scoping). Surfaces all `OPERATOR.*` audit
 * rows for the current tenant so the Action History view can show every
 * key's activity. Used by `GET /api/bo/mcp/actions` (operator MCP V2,
 * ADR-0039 §9).
 */
export interface OperatorActionFilter {
    limit?: number;
    /** Filter to a specific apikey:<id>. */
    actorId?: string;
    /** Filter by event name prefix (e.g. 'OPERATOR.QUOTE_'). */
    actionPrefix?: string;
    /** Filter by entityId (policy or risk transaction). */
    entityId?: string;
    /** ISO date floor; rows on or after this timestamp. */
    occurredAfter?: string;
}

export async function listOperatorActions(filter: OperatorActionFilter = {}): Promise<OperatorActionRow[]> {
    const where: Record<string, unknown> = {
        actionName: { startsWith: filter.actionPrefix || 'OPERATOR.' },
    };
    if (filter.actorId) where.actorId = filter.actorId;
    if (filter.entityId) where.entityId = filter.entityId;
    if (filter.occurredAfter) where.occurredAt = { gte: new Date(filter.occurredAfter) };
    const rows = await tenantScopedPrisma.auditAction.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        take: Math.min(Math.max(filter.limit ?? 50, 1), 200),
    });
    return rows.map((r) => ({
        id: r.id,
        occurredAt: r.occurredAt,
        actionName: r.actionName,
        actorId: r.actorId,
        actorName: r.actorName,
        entityType: r.entityType,
        entityId: r.entityId,
        diff: r.diff,
    }));
}

/**
 * BO router for operator-MCP audit visibility (ADR-0039 §9 / operator
 * MCP V2). Mounted at `/api/bo/mcp/actions` behind the BO surface
 * gate + `operator:read` permission.
 *
 * The Action History view ([`OperatorActionHistoryView.tsx`]) hits
 * this endpoint to surface every operator agent's writes — quote
 * patches, previews, sends, endorsement drafts. Sourced from the
 * canonical `AuditAction` table (operator tools write `OPERATOR.*`
 * rows via the shared MCP funnel).
 */
import { Router } from 'express';
import { z } from 'zod';
import { typedHandler } from '../../../platform/http/typedHandler.js';
import { requirePermission } from '../../accessControl/http/permissionMiddleware.js';
import { listOperatorActions } from '../../operator/app/listOperatorActions.js';

const router = Router();

const ListQuerySchema = z
    .object({
        limit: z.string().regex(/^\d+$/).optional(),
        actorId: z.string().trim().min(1).optional(),
        actionPrefix: z.string().trim().min(1).max(40).optional(),
        entityId: z.string().trim().min(1).optional(),
        occurredAfter: z.string().datetime().optional(),
    })
    .strict();

router.get(
    '/',
    requirePermission('operator', 'read'),
    typedHandler({ query: ListQuerySchema }, async (req, res) => {
        const query = req.query;
        const limitNum = query.limit ? Number.parseInt(query.limit, 10) : undefined;
        const rows = await listOperatorActions({
            limit: limitNum && Number.isFinite(limitNum) ? Math.min(Math.max(limitNum, 1), 200) : undefined,
            actorId: query.actorId,
            actionPrefix: query.actionPrefix,
            entityId: query.entityId,
            occurredAfter: query.occurredAfter,
        });
        res.json({
            success: true,
            data: rows.map((r) => ({
                id: r.id,
                occurred_at: r.occurredAt.toISOString(),
                action: r.actionName,
                actor_id: r.actorId,
                actor_name: r.actorName,
                entity_type: r.entityType,
                entity_id: r.entityId,
                diff: r.diff,
            })),
        });
    }),
);

export default router;

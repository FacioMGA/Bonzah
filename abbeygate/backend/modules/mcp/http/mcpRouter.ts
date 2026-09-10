import crypto from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { typedHandler } from '../../../platform/http/typedHandler.js';
import { logger } from '../../../platform/utils/logger.js';
import { getCorrelationId } from '../../../platform/observability/context.js';
import { getTenantConfig } from '../../../platform/tenant/tenantConfig.js';
import { resolveEffectivePermissionsForUser } from '../../accessControl/app/permissionService.js';
import { executeToolCall } from '../app/executeToolCall.js';
import { toolRegistry } from '../app/toolRegistry.js';
import { httpSseTransport } from '../app/httpSseTransport.js';
import { McpToolError } from '../app/toolError.js';
import type { McpContext } from '../app/mcpContext.js';

/**
 * HTTP/SSE router for Config MCP V1 (ADR-0036).
 *
 * Routes:
 *   GET  /api/mcp/config/catalog          — list registered tools
 *   POST /api/mcp/config/invoke           — single tool call (JSON in, JSON out)
 *   POST /api/mcp/config/stream           — SSE: streams `tool_call` + `tool_result` events
 *                                            for a manager turn (single tool today; agent loop
 *                                            iteration lands in Phase 1)
 *
 * This is the ONLY HTTP surface for MCP protocol responses
 * (canonical-ownership row "AI agent tool surface"). Any other module
 * exposing MCP responses outside `/api/mcp/*` is a drift.
 */

async function buildContextFromRequest(
    req: Request,
    body: { sessionId?: string; channel?: McpContext['channel'] },
): Promise<McpContext> {
    const userId = req.user?.id;
    if (!userId) {
        throw new McpToolError({
            code: 'UNAUTHORIZED',
            message: 'Authenticated user is required for MCP tool dispatch.',
        });
    }
    // resolveEffectivePermissionsForUser returns the same shape used by
    // requirePermission(); flatten to the dotted string the registry expects.
        const resolved = await resolveEffectivePermissionsForUser(userId, req.user?.role);
    const permissions = resolved.map((p) => p.key);
    return {
        tenantId: getTenantConfig().id,
        userId,
        role: req.user?.role === 'CUSTOMER' ? 'USER' : 'USER',
        permissions,
        channel: body.channel || 'web',
        sessionId: body.sessionId || crypto.randomUUID(),
        requestId: crypto.randomUUID(),
        correlationId: getCorrelationId() || crypto.randomUUID(),
    };
}

const router = Router();

// GET /catalog — list tools the calling user is allowed to see.
router.get('/catalog', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } });
            return;
        }
        const resolved = await resolveEffectivePermissionsForUser(userId, req.user?.role);
        const allowedKeys = new Set(resolved.map((p) => p.key));
        const catalog = toolRegistry.list()
            .filter((t) => allowedKeys.has(t.requiredPermission))
            .map((t) => ({
                name: t.name,
                family: t.family,
                description: t.description,
                requiredPermission: t.requiredPermission,
                auditClass: t.auditClass,
            }));
        res.json({ success: true, catalog });
    } catch (err) {
        next(err);
    }
});

// POST /invoke — single tool call. Body parsed by InvokeBodySchema
// (z.object below) via the canonical `typedHandler` wrapper (ADR-0028).
const InvokeBodySchema = z
    .object({
        toolName: z.string().min(1),
        input: z.unknown(),
        sessionId: z.string().min(1).optional(),
        channel: z.enum(['web', 'whatsapp', 'internal-demo', 'cursor', 'claude-desktop']).optional(),
    })
    .strict();

router.post(
    '/invoke',
    typedHandler({ body: InvokeBodySchema }, async (req, res, _next) => {
        // body already narrowed + validated by InvokeBodySchema.parse (z.object)
        // in the canonical typedHandler wrapper above.
        const body = req.body;
        const ctx = await buildContextFromRequest(req, body);
        try {
            const { output } = await executeToolCall(body.toolName, body.input, ctx);
            res.json(httpSseTransport.serializeSuccess(body.toolName, output));
        } catch (err) {
            const envelope = httpSseTransport.serializeError(body.toolName, err);
            const status = err instanceof McpToolError
                ? mcpStatusForCode(err.code)
                : 500;
            res.status(status).json(envelope);
        }
    }),
);

// POST /stream — SSE: stream multiple tool calls as events so the BO
// conversation panel can render each step as it happens. Body parsed by
// StreamBodySchema (z.object below) via the canonical typedHandler wrapper.
const StreamBodySchema = z
    .object({
        toolCalls: z
            .array(
                z.object({
                    toolName: z.string().min(1),
                    input: z.unknown(),
                }),
            )
            .min(1)
            .max(10),
        sessionId: z.string().min(1).optional(),
        channel: z.enum(['web', 'whatsapp', 'internal-demo', 'cursor', 'claude-desktop']).optional(),
    })
    .strict();

router.post(
    '/stream',
    typedHandler({ body: StreamBodySchema }, async (req, res, _next) => {
        // body already narrowed + validated by StreamBodySchema.parse (z.object)
        // in the canonical typedHandler wrapper above.
        const body = req.body;
        const ctx = await buildContextFromRequest(req, body);

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders?.();

        const writeEvent = (event: string, data: unknown) => {
            res.write(`event: ${event}\n`);
            res.write(`data: ${JSON.stringify(data)}\n\n`);
        };

        writeEvent('session_started', { sessionId: ctx.sessionId });

        for (const call of body.toolCalls) {
            writeEvent('tool_call', { toolName: call.toolName });
            try {
                const { output } = await executeToolCall(call.toolName, call.input, ctx);
                writeEvent('tool_result', httpSseTransport.serializeSuccess(call.toolName, output));
            } catch (err) {
                writeEvent('tool_error', httpSseTransport.serializeError(call.toolName, err));
                logger.warn({ err, toolName: call.toolName, sessionId: ctx.sessionId }, 'mcp.stream.tool_failed');
            }
        }

        writeEvent('session_finished', { sessionId: ctx.sessionId });
        res.end();
    }),
);

function mcpStatusForCode(code: string): number {
    switch (code) {
        case 'UNAUTHORIZED':
            return 403;
        case 'VALIDATION_ERROR':
        case 'UNKNOWN_FIELD_REFERENCE':
        case 'INVALID_OVERRIDE':
        case 'DUPLICATE_KEY':
            return 400;
        case 'DRAFT_NOT_FOUND':
            return 404;
        case 'PUBLISH_BLOCKED':
        case 'REQUIRES_ENGINEERING':
            return 422;
        default:
            return 500;
    }
}

export default router;

/**
 * BO router for issuing / listing / revoking Config MCP API keys
 * (ADR-0036 amendment). Mounted at `/api/bo/mcp/keys` behind the BO
 * surface gate. Configuration keys can stage and validate drafts; complete
 * programme-definition publication remains a BO action.
 *
 * Returns the raw `facio_…` token from POST ONCE; never recoverable.
 */
import { Router } from 'express';
import { z } from 'zod';
import { typedHandler } from '../../../platform/http/typedHandler.js';
import { requirePermission } from '../../accessControl/http/permissionMiddleware.js';
import {
    issueMcpApiKey,
    listMcpApiKeys,
    revokeMcpApiKey,
} from '../app/issueMcpApiKey.js';

const router = Router();

const IssueBodySchema = z
    .object({
        name: z.string().trim().min(1).max(120),
        family: z.enum(['config', 'operator']),
        accountId: z.string().trim().min(1).optional(),
        includePublishSandbox: z.boolean().optional(),
        includeOperatorMutate: z.boolean().optional(),
        expiresAt: z
            .string()
            .datetime()
            .optional()
            .transform((s) => (s ? new Date(s) : undefined)),
    })
    .strict();

const RevokeParamsSchema = z
    .object({
        id: z.string().trim().min(1),
    })
    .strict();

/**
 * Per-action permission map: which BO permission gates issuance of
 * each family's keys. Reading is `configuration.read` for both because
 * the BO MCP keys page lives under the Config MCP module's URL today;
 * a future per-family BO page can split this if needed.
 */
function requirePermissionForFamily(family: 'config' | 'operator', action: 'draft' | 'read') {
    if (action === 'read') {
        return requirePermission('configuration', 'read');
    }
    return family === 'operator'
        ? requirePermission('operator', 'comm')
        : requirePermission('configuration', 'draft');
}

// POST /api/bo/mcp/keys — issue a new key. Body parsed by IssueBodySchema (z.object) above.
router.post(
    '/',
    // Route-level guard: any BO user with EITHER configuration.draft OR
    // operator.comm gets past. The body-specific guard runs inside the
    // handler against the resolved `family` field.
    requirePermission('configuration', 'draft'),
    typedHandler({ body: IssueBodySchema }, async (req, res) => {
        const body = req.body;
        // Per-family permission check.
        const familyRequiredPermission =
            body.family === 'operator' ? 'operator.comm' : 'configuration.draft';
        const hasFamily = (req.resolvedPermissions || []).some(
            (p) => p.key === familyRequiredPermission,
        );
        if (!hasFamily) {
            res.status(403).json({
                success: false,
                error: {
                    code: 'PERMISSION_DENIED',
                    message: `Issuing a "${body.family}" MCP key requires ${familyRequiredPermission}.`,
                },
            });
            return;
        }
        // Issuing a key with publishSandbox requires the actor to have
        // that permission themselves — defense-in-depth on top of the
        // route-level guard. Only valid for config family.
        if (body.includePublishSandbox) {
            if (body.family !== 'config') {
                res.status(400).json({
                    success: false,
                    error: {
                        code: 'VALIDATION_ERROR',
                        message: 'publish_sandbox opt-in is only valid on the "config" family.',
                    },
                });
                return;
            }
            const has = (req.resolvedPermissions || []).some(
                (p) => p.key === 'configuration.publish_sandbox',
            );
            if (!has) {
                res.status(403).json({
                    success: false,
                    error: {
                        code: 'PERMISSION_DENIED',
                        message:
                            'Only operators with configuration.publish_sandbox may issue keys that include it.',
                    },
                });
                return;
            }
        }
        // Operator MCP V2 (ADR-0039): operator.mutate opt-in. Same
        // defense-in-depth posture as publish_sandbox — issuer must
        // hold the permission themselves.
        if (body.includeOperatorMutate) {
            if (body.family !== 'operator') {
                res.status(400).json({
                    success: false,
                    error: {
                        code: 'VALIDATION_ERROR',
                        message: 'operator.mutate opt-in is only valid on the "operator" family.',
                    },
                });
                return;
            }
            const has = (req.resolvedPermissions || []).some(
                (p) => p.key === 'operator.mutate',
            );
            if (!has) {
                res.status(403).json({
                    success: false,
                    error: {
                        code: 'PERMISSION_DENIED',
                        message:
                            'Only operators with operator.mutate may issue keys that include it.',
                    },
                });
                return;
            }
        }
        const result = await issueMcpApiKey({
            name: body.name,
            family: body.family,
            accountId: body.accountId,
            includePublishSandbox: body.includePublishSandbox,
            includeOperatorMutate: body.includeOperatorMutate,
            expiresAt: body.expiresAt ?? null,
        });
        res.status(201).json({ success: true, data: result });
    }),
);

// GET /api/bo/mcp/keys — list issued keys (no token returned). Includes
// both Config and Operator MCP keys; each row carries its `family`.
router.get('/', requirePermissionForFamily('config', 'read'), async (_req, res, next) => {
    try {
        const keys = await listMcpApiKeys();
        res.json({ success: true, data: keys });
    } catch (err) {
        next(err);
    }
});

// POST /api/bo/mcp/keys/:id/revoke — flip isActive=false. Params parsed
// by RevokeParamsSchema (z.object) above via typedHandler.
router.post(
    '/:id/revoke',
    requirePermission('configuration', 'draft'),
    typedHandler({ params: RevokeParamsSchema }, async (req, res) => {
        await revokeMcpApiKey(req.params.id);
        res.status(204).end();
    }),
);

export default router;

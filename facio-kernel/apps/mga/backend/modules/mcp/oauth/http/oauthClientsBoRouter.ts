/**
 * BO management surface for OAuth clients (ADR-0040 §6 — Phase C).
 *
 * Mounted at `/api/bo/mcp/oauth-clients` behind the BO surface gate
 * + a permission check (configuration.read for view, operator.comm
 * for revoke — symmetric with the key issuance UI). Lists
 * DCR-registered clients for the current tenant and lets the operator
 * revoke them.
 *
 * NO write surface for new clients — DCR handles registration. A
 * "register manually" form would be V3 (predefined clients).
 */
import { Router } from 'express';
import { z } from 'zod';
import { typedHandler } from '../../../../platform/http/typedHandler.js';
import { AuditLogger } from '../../../../platform/audit/logger.js';
import { requirePermission } from '../../../accessControl/http/permissionMiddleware.js';
import {
    findOAuthClientByClientId,
    listOAuthClients,
    revokeOAuthClient,
} from '../infra/oauthClientRepository.js';

const router = Router();

const RevokeParamsSchema = z.object({ clientId: z.string().trim().min(1) }).strict();

router.get('/', requirePermission('configuration', 'read'), async (_req, res, next) => {
    try {
        const rows = await listOAuthClients();
        res.json({
            success: true,
            data: rows.map((r) => ({
                client_id: r.clientId,
                client_name: r.clientName,
                client_uri: r.clientUri,
                redirect_uris: r.redirectUris,
                scopes: r.scopes,
                registration_kind: r.registrationKind,
                is_public: r.clientSecretHash === null,
                created_at: r.createdAt.toISOString(),
                revoked_at: r.revokedAt ? r.revokedAt.toISOString() : null,
            })),
        });
    } catch (err) {
        next(err);
    }
});

router.post(
    '/:clientId/revoke',
    requirePermission('configuration', 'draft'),
    typedHandler({ params: RevokeParamsSchema }, async (req, res) => {
        const existing = await findOAuthClientByClientId(req.params.clientId);
        if (!existing) {
            res.status(404).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'OAuth client not found in this tenant.' },
            });
            return;
        }
        await revokeOAuthClient(req.params.clientId);
        const actor = req.user;
        void AuditLogger.log(
            existing.id,
            'OAUTH_CLIENT',
            'OAUTH.CLIENT_REVOKED',
            actor?.id || 'system',
            actor?.role ? 'USER' : 'SYSTEM',
            {
                clientId: req.params.clientId,
                clientName: existing.clientName,
                revokedByUser: actor?.id || 'system',
            },
            typeof actor?.name === 'string' ? actor.name : undefined,
        );
        res.status(204).end();
    }),
);

export default router;

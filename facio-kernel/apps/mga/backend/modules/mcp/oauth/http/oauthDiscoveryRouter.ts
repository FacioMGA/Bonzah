import { requireSupportedOAuthDeployment } from './platformAvailability.js';
/**
 * OAuth discovery endpoints (ADR-0040 §2 — Phase A).
 *
 * Mounted at the ROOT of the tenant host (NOT under /api) per RFC 9728
 * §3.1 + the OpenAI Apps SDK auth spec — ChatGPT looks at
 * `https://<tenant>/.well-known/...` first. The router applies
 * `resolveOperatingTenant` so every metadata response is correctly
 * tenant-scoped.
 *
 * No auth required on any of these endpoints — they are PUBLIC
 * discovery surfaces by design.
 */
import { Router, type Request, type Response } from 'express';
import { logger } from '../../../../platform/utils/logger.js';
import { resolveOperatingTenant } from '../../../../platform/http/middleware/resolveTenant.js';
import {
    buildAuthorizationServerMetadata,
    buildProtectedResourceMetadata,
} from '../app/buildMetadata.js';

const router = Router();

// Tenant ALS context required by every metadata endpoint
// (buildAuthorizationServerMetadata + buildProtectedResourceMetadata
// both read getTenantConfig().publicBaseUrl). Scoping is enforced at
// the MOUNT level: this router is mounted at `/.well-known` in
// backend/index.ts so the middleware only runs for `.well-known/*`
// requests, never for `/health` or any other root-level handler
// (root cause of the 2026-05-28 18:24 UTC + 18:49 UTC deploy
// timeouts — Kubernetes /health probe got 403 TENANT_UNRESOLVED).
router.use(requireSupportedOAuthDeployment);
router.use(resolveOperatingTenant);

// Cache-friendly: metadata never changes per-tenant, but the tenant ALS
// context drives the response so we cannot cache across tenants. Use
// short Cache-Control to let MCP clients re-fetch if anything changes.
const METADATA_CACHE_HEADER = 'public, max-age=300';

function jsonMetadata(res: Response, body: unknown): void {
    res.set('Cache-Control', METADATA_CACHE_HEADER);
    res.set('Content-Type', 'application/json; charset=utf-8');
    res.status(200).json(body);
}

// Paths are RELATIVE to the `/.well-known` mount in backend/index.ts.
// Full URLs: /.well-known/oauth-authorization-server, etc.
router.get('/oauth-authorization-server', (_req: Request, res: Response) => {
    try {
        jsonMetadata(res, buildAuthorizationServerMetadata());
    } catch (err) {
        logger.error({ err }, 'mcp.oauth.discovery.authorization_server_failed');
        res.status(500).json({ error: 'server_error' });
    }
});

router.get('/oauth-protected-resource', (_req: Request, res: Response) => {
    try {
        jsonMetadata(res, buildProtectedResourceMetadata());
    } catch (err) {
        logger.error({ err }, 'mcp.oauth.discovery.protected_resource_failed');
        res.status(500).json({ error: 'server_error' });
    }
});

router.get(
    '/oauth-protected-resource/api/v1/mcp/operator',
    (_req: Request, res: Response) => {
        try {
            jsonMetadata(res, buildProtectedResourceMetadata('operator'));
        } catch (err) {
            logger.error({ err }, 'mcp.oauth.discovery.protected_resource_operator_failed');
            res.status(500).json({ error: 'server_error' });
        }
    },
);

router.get(
    '/oauth-protected-resource/api/v1/mcp/config',
    (_req: Request, res: Response) => {
        try {
            jsonMetadata(res, buildProtectedResourceMetadata('config'));
        } catch (err) {
            logger.error({ err }, 'mcp.oauth.discovery.protected_resource_config_failed');
            res.status(500).json({ error: 'server_error' });
        }
    },
);

export const oauthDiscoveryRouter = router;

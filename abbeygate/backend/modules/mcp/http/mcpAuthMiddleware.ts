/**
 * Unified MCP auth middleware (ADR-0040 §3 — V2.1 Phase B).
 *
 * Single entry point for both authentication paths on the MCP mounts:
 *   - `Authorization: Bearer facio_<hex>` → existing ApiKey validation
 *     (V1, ADR-0036 amendment #1)
 *   - `Authorization: Bearer at_<hex>`    → OAuth access token (V2.1)
 *
 * BOTH branches produce identical `req.user + req.resolvedPermissions`
 * so every downstream consumer — `authorizeToolCall`, `recordMcpAudit`,
 * the wire-name translator, every per-tool `requiredPermission` check —
 * keeps working unchanged.
 *
 * Single funnel: this file is the ONLY place that may produce
 * `req.resolvedPermissions` for MCP routes. Pinned by
 * `tools/quality/check-mcp-auth-single-funnel.mjs`.
 *
 * 401 responses emit `WWW-Authenticate: Bearer realm=..., error=...,
 * resource_metadata=...` per RFC 9728 §5.1 — without `resource_metadata`,
 * ChatGPT cannot complete OAuth discovery and silently filters every
 * tool out (root cause of the 2026-05-28 demo failure).
 */
import type { NextFunction, Request, Response } from 'express';
import { ApiKeyService } from '../../../platform/auth/apiKeyService.js';
import { getTenantConfig } from '../../../platform/tenant/tenantConfig.js';
import { logger } from '../../../platform/utils/logger.js';
import type { ResolvedPermission } from '../../accessControl/app/permissions.js';
import { protectedResourceMetadataUrl } from '../oauth/app/buildMetadata.js';
import { validateAccessToken } from '../oauth/infra/oauthAccessTokenStore.js';
import { resolveResourceParameter } from '../oauth/domain/resource.js';

const FACIO_PREFIX = 'facio_';
const OAUTH_PREFIX = 'at_';

function extractToken(req: Request): string | null {
    const auth = String(req.headers['authorization'] || '').trim();
    if (auth.toLowerCase().startsWith('bearer ')) {
        const token = auth.slice(7).trim();
        if (token) return token;
    }
    const apiKeyHeader = String(req.headers['x-api-key'] || '').trim();
    if (apiKeyHeader) return apiKeyHeader;
    return null;
}

function resourceMetadataForRequest(req: Request): string {
    // Use originalUrl (the full request path the client sent) — NOT
    // req.path, which is relative to the router mount and would be
    // '/' here. Without this, the WWW-Authenticate header points at
    // the root protected-resource metadata which returns the issuer
    // host as the `resource` value, ChatGPT then uses that issuer host
    // as the OAuth `resource` parameter, and /oauth/authorize +
    // /oauth/token reject with `invalid_target` (2026-05-29 09:11 UTC
    // ChatGPT connector failure).
    const fullPath = String(req.originalUrl || req.url || '');
    if (fullPath.includes('/mcp/operator')) return protectedResourceMetadataUrl('operator');
    if (fullPath.includes('/mcp/config')) return protectedResourceMetadataUrl('config');
    return protectedResourceMetadataUrl();
}

function buildWwwAuthenticate(req: Request, error: string, errorDescription?: string): string {
    const parts = [
        'Bearer realm="facio-mcp"',
        `error="${error}"`,
    ];
    if (errorDescription) parts.push(`error_description="${errorDescription}"`);
    parts.push(`resource_metadata="${resourceMetadataForRequest(req)}"`);
    return parts.join(', ');
}

function reject401(req: Request, res: Response, error: string, message: string): void {
    res
        .status(401)
        .setHeader('WWW-Authenticate', buildWwwAuthenticate(req, error, message))
        .json({ success: false, error: { code: 'UNAUTHORIZED', message } });
}

function reject403(res: Response, message: string): void {
    res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message } });
}

export async function authenticateMcpRequest(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    const token = extractToken(req);
    if (!token) {
        reject401(req, res, 'missing_token', 'Missing MCP credential. Use Authorization: Bearer <token>.');
        return;
    }

    if (token.startsWith(OAUTH_PREFIX)) {
        await validateOAuthBranch(token, req, res, next);
        return;
    }
    if (token.startsWith(FACIO_PREFIX)) {
        await validateFacioBranch(token, req, res, next);
        return;
    }
    reject401(req, res, 'invalid_token', `MCP token must start with "${FACIO_PREFIX}" or "${OAUTH_PREFIX}".`);
}

async function validateFacioBranch(
    token: string,
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const validated = await ApiKeyService.validateKeyForMcp(token);
        if (!validated) {
            reject401(req, res, 'invalid_token', 'Invalid or expired MCP API key.');
            return;
        }
        const resolvedTenant = getTenantConfig();
        if (validated.operatingTenant.id !== resolvedTenant.id) {
            logger.warn(
                {
                    keyTenant: validated.operatingTenant.id,
                    resolvedTenant: resolvedTenant.id,
                    requestPath: req.path,
                },
                'mcp.apikey.tenant_mismatch',
            );
            reject403(res, 'MCP key is bound to a different operating tenant than this request.');
            return;
        }
        const looksLikeOperator = (validated.permissions || []).some((p) => p.startsWith('operator.'));
        req.user = {
            id: `apikey:${validated.apiKeyId}`,
            role: looksLikeOperator ? 'OPERATOR_AGENT' : 'CONFIG_AGENT',
        };
        const perms: ResolvedPermission[] = (validated.permissions || []).map((key) => ({ key }));
        req.resolvedPermissions = perms;

        if (perms.length === 0) {
            logger.warn(
                { apiKeyId: validated.apiKeyId, requestPath: req.path },
                'mcp.apikey.validated_no_permissions',
            );
        } else {
            logger.info(
                {
                    apiKeyId: validated.apiKeyId,
                    inferredFamily: looksLikeOperator ? 'operator' : 'config',
                    permissionCount: perms.length,
                    permissions: perms.map((p) => p.key),
                    requestPath: req.path,
                },
                'mcp.apikey.validated',
            );
        }
        next();
    } catch (err) {
        logger.error({ err }, 'mcp.apikey.validation_failed');
        res
            .status(500)
            .json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'MCP key validation failed.' } });
    }
}

async function validateOAuthBranch(
    token: string,
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const payload = await validateAccessToken(token);
        if (!payload) {
            reject401(req, res, 'invalid_token', 'Invalid or expired OAuth access token.');
            return;
        }
        const resolvedTenant = getTenantConfig();
        if (payload.operatingTenantId !== resolvedTenant.id) {
            logger.warn(
                {
                    tokenTenant: payload.operatingTenantId,
                    resolvedTenant: resolvedTenant.id,
                    requestPath: req.path,
                    clientId: payload.clientId,
                },
                'mcp.oauth.tenant_mismatch',
            );
            reject403(res, 'OAuth token is bound to a different operating tenant than this request.');
            return;
        }
        // RFC 8707 — token is bound to one MCP mount. Presenting it at
        // the other mount is a cross-resource violation.
        const requestedResource = resolveResourceParameter(payload.resource);
        const currentMount = req.path.includes('/mcp/operator')
            ? 'operator'
            : req.path.includes('/mcp/config')
              ? 'config'
              : null;
        if (requestedResource && currentMount && requestedResource.mount !== currentMount) {
            logger.warn(
                {
                    tokenResource: payload.resource,
                    currentMount,
                    clientId: payload.clientId,
                    requestPath: req.path,
                },
                'mcp.oauth.cross_resource_use_rejected',
            );
            reject403(
                res,
                `OAuth token is bound to ${requestedResource.mount} but presented at ${currentMount} mount.`,
            );
            return;
        }
        const looksLikeOperator = payload.scopes.some((s) => s.startsWith('operator.'));
        req.user = {
            id: `oauth_client:${payload.clientId}`,
            role: looksLikeOperator ? 'OPERATOR_AGENT' : 'CONFIG_AGENT',
        };
        const perms: ResolvedPermission[] = payload.scopes.map((key) => ({ key }));
        req.resolvedPermissions = perms;

        logger.info(
            {
                clientId: payload.clientId,
                grantingUserId: payload.userId,
                inferredFamily: looksLikeOperator ? 'operator' : 'config',
                scopes: payload.scopes,
                resource: payload.resource,
                requestPath: req.path,
            },
            'mcp.oauth.validated',
        );
        next();
    } catch (err) {
        logger.error({ err }, 'mcp.oauth.validation_failed');
        res
            .status(500)
            .json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'OAuth token validation failed.' } });
    }
}

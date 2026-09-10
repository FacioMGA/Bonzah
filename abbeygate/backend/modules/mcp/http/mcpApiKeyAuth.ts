/**
 * MCP API-key auth middleware (ADR-0036 amendment).
 *
 * Bridges the existing `ApiKey` infrastructure (`facio_<hex>` tokens
 * validated by `ApiKeyService.validateKey`) onto the canonical
 * `McpContext` shape that the ToolRegistry funnel
 * (`executeToolCall` → `authorizeToolCall` → `recordMcpAudit`) expects.
 *
 * Identity model: an MCP-authenticated request carries NO User; it
 * carries a `facio_…` token whose stored `ApiKey.permissions` array
 * was populated at issuance time from `CONFIG_AGENT_BASELINE` plus
 * optional opt-ins. We synthesise:
 *
 *   req.user             = { id: 'apikey:<id>', role: 'CONFIG_AGENT' }
 *   req.resolvedPermissions = ApiKey.permissions as ResolvedPermission[]
 *   req.apiAccount       = the linked Account (for compatibility with
 *                          existing v1 routes that may read it)
 *
 * Accepts the token via either header (in order):
 *   - `Authorization: Bearer facio_…`   (preferred — what Claude / ChatGPT send)
 *   - `x-api-key: facio_…`              (legacy header, matches /api/v1/* pattern)
 *
 * Fails closed: missing token → 401 with WWW-Authenticate hint;
 * invalid/inactive/expired token → 401; key bound to a different
 * operating tenant than the resolved request tenant → 403.
 */
import type { Request, Response, NextFunction } from 'express';
import { ApiKeyService } from '../../../platform/auth/apiKeyService.js';
import { logger } from '../../../platform/utils/logger.js';
import { getTenantConfig } from '../../../platform/tenant/tenantConfig.js';
import type { ResolvedPermission } from '../../accessControl/app/permissions.js';
import { protectedResourceMetadataUrl } from '../oauth/app/buildMetadata.js';

const TOKEN_PREFIX = 'facio_';

/**
 * Mount-aware Protected Resource Metadata URL (ADR-0040 §2 + RFC 9728).
 * MCP clients (ChatGPT especially) read this URL to discover the
 * authorization server. WITHOUT this header, ChatGPT cannot complete
 * OAuth discovery and silently filters every tool out (the symptom
 * we hit 2026-05-28).
 */
function resourceMetadataForRequest(req: Request): string {
    if (req.path.includes('/mcp/operator')) return protectedResourceMetadataUrl('operator');
    if (req.path.includes('/mcp/config')) return protectedResourceMetadataUrl('config');
    return protectedResourceMetadataUrl();
}

function buildWwwAuthenticate(req: Request, realm: string, error: string): string {
    return [
        `Bearer realm="${realm}"`,
        `error="${error}"`,
        `resource_metadata="${resourceMetadataForRequest(req)}"`,
    ].join(', ');
}

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

export async function authenticateMcpApiKey(req: Request, res: Response, next: NextFunction): Promise<void> {
    const token = extractToken(req);
    if (!token) {
        res
            .status(401)
            .setHeader('WWW-Authenticate', buildWwwAuthenticate(req, 'facio-mcp', 'missing_token'))
            .json({
                success: false,
                error: {
                    code: 'UNAUTHORIZED',
                    message:
                        'Missing MCP credential. Send Authorization: Bearer facio_… (V1) or OAuth access token (V2.1).',
                },
            });
        return;
    }
    if (!token.startsWith(TOKEN_PREFIX)) {
        // V2.1 hint: OAuth access tokens (`at_…`) will route here once
        // the unified `mcpAuthMiddleware` lands in Phase B. Until then,
        // Bearer keys MUST carry the `facio_` prefix.
        res
            .status(401)
            .setHeader('WWW-Authenticate', buildWwwAuthenticate(req, 'facio-mcp', 'invalid_token'))
            .json({
                success: false,
                error: { code: 'UNAUTHORIZED', message: `MCP token must begin with "${TOKEN_PREFIX}".` },
            });
        return;
    }

    try {
        const validated = await ApiKeyService.validateKeyForMcp(token);
        if (!validated) {
            res
                .status(401)
                .setHeader('WWW-Authenticate', buildWwwAuthenticate(req, 'facio-mcp', 'invalid_token'))
                .json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired MCP API key.' } });
            return;
        }

        // Cross-tenant guard: the key's operating tenant MUST match the
        // tenant resolved for this HTTP request (host / X-Tenant-Slug /
        // JWT chain in `resolveTenant.ts`). A key issued for tenant CY
        // must not be usable against `abbeygate-pt.facio.io`.
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
            res.status(403).json({
                success: false,
                error: {
                    code: 'UNAUTHORIZED',
                    message: 'MCP key is bound to a different operating tenant than this request.',
                },
            });
            return;
        }

        // Synthesise an MCP-shaped identity. `userId` reads as
        // `apikey:<id>` in AuditAction rows so operators can trace
        // every MCP call to the originating credential. Family inferred
        // from the key's permissions so the synthetic role is correct
        // for downstream audit shaping (operator keys → OPERATOR_AGENT,
        // config keys → CONFIG_AGENT).
        const looksLikeOperator = (validated.permissions || []).some((p) => p.startsWith('operator.'));
        req.user = {
            id: `apikey:${validated.apiKeyId}`,
            role: looksLikeOperator ? 'OPERATOR_AGENT' : 'CONFIG_AGENT',
        };
        const perms: ResolvedPermission[] = (validated.permissions || []).map((key) => ({ key }));
        req.resolvedPermissions = perms;

        // Diagnostic log for remote-MCP onboarding (Claude / ChatGPT
        // first-connection debugging). Logs at info because the volume
        // is bounded by remote tool calls and we explicitly want this
        // visible when a customer reports "ChatGPT sees the app but no
        // tools".
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

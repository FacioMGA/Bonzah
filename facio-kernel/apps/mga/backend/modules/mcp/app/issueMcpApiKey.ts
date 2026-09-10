import { Prisma } from '@prisma/client';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import { getTenantConfig } from '../../../platform/tenant/tenantConfig.js';
import { logger } from '../../../platform/utils/logger.js';
import {
    CONFIG_AGENT_BASELINE,
    CONFIG_AGENT_OPTIONAL,
    OPERATOR_AGENT_BASELINE,
    OPERATOR_AGENT_OPTIONAL,
} from '../../accessControl/domain/permissionTaxonomy.js';
import { McpToolError } from '../domain/toolError.js';
import crypto from 'node:crypto';

/**
 * Issue a Config MCP API key bound to the current operating tenant + a
 * specific Account. The raw `facio_…` token is returned ONCE and never
 * stored — the hash is what lives in `ApiKey.keyHash`. The key's
 * `permissions` column drives what tools the remote agent sees and may
 * call (ADR-0036 amendment).
 *
 * Permission policy:
 *   - Every key carries the CONFIG_AGENT_BASELINE
 *     (configuration.{read,draft,validate,simulate}).
 *   - Per-key opt-ins from CONFIG_AGENT_OPTIONAL must be explicit
 *     (today: configuration.publish_sandbox).
 *   - configuration.publish_production is NEVER issued in V1 (ADR-0036).
 *
 * Tenant binding is taken from the resolved operating-tenant ALS
 * context — the caller cannot specify a different tenant.
 */
export type McpKeyFamily = 'config' | 'operator';

export interface IssueMcpApiKeyInput {
    name: string;
    /**
     * Which MCP family this key authenticates against. Selects the
     * baseline + optional permission set and (downstream) which URL
     * the BO surfaces in the issued-key callout.
     */
    family: McpKeyFamily;
    /**
     * Optional Account to bind the key to (Prisma FK requires one). If
     * omitted, the first Account in the operating tenant is used —
     * acceptable for V1 demo where MCP keys are tenant-scoped and the
     * Account dimension is not surfaced through the MCP protocol.
     */
    accountId?: string;
    /** Config-family opt-in: `configuration.publish_sandbox`. */
    includePublishSandbox?: boolean;
    /** Operator-family opt-in (V2, ADR-0039): `operator.mutate`. */
    includeOperatorMutate?: boolean;
    expiresAt?: Date | null;
}

export interface IssueMcpApiKeyOutput {
    apiKeyId: string;
    name: string;
    family: McpKeyFamily;
    permissions: string[];
    /** Returned ONCE — store immediately, never recoverable from the API. */
    rawKey: string;
    operatingTenantSlug: string;
    /** Mount the customer should hit with this token. */
    mountPath: '/api/v1/mcp/config' | '/api/v1/mcp/operator';
    expiresAt: Date | null;
}

export async function issueMcpApiKey(input: IssueMcpApiKeyInput): Promise<IssueMcpApiKeyOutput> {
    const trimmedName = String(input.name || '').trim();
    if (!trimmedName) {
        throw new McpToolError({ code: 'VALIDATION_ERROR', message: 'name is required' });
    }
    let trimmedAccountId = String(input.accountId || '').trim();
    if (!trimmedAccountId) {
        // V1 default: bind the key to the first Account in the tenant.
        // The Prisma FK is required; MCP protocol does not surface Account.
        const fallback = await tenantScopedPrisma.account.findFirst({
            orderBy: { createdAt: 'asc' },
            select: { id: true },
        });
        if (!fallback) {
            throw new McpToolError({
                code: 'INTERNAL_ERROR',
                message: 'No Account in tenant — cannot bind MCP API key.',
            });
        }
        trimmedAccountId = fallback.id;
    }

    const family: McpKeyFamily = input.family;
    const scopedAccount = await tenantScopedPrisma.account.findUnique({ where: { id: trimmedAccountId }, select: { id: true } });
    if (!scopedAccount) throw new McpToolError({ code: 'UNAUTHORIZED', message: 'The key account must belong to this workspace.' });
    const permissions: string[] = family === 'operator'
        ? [...OPERATOR_AGENT_BASELINE]
        : [...CONFIG_AGENT_BASELINE];
    if (input.includePublishSandbox) {
        if (family !== 'config') {
            throw new McpToolError({
                code: 'INVALID_OVERRIDE',
                message: 'publish_sandbox opt-in is only valid on the "config" family.',
            });
        }
        if (!CONFIG_AGENT_OPTIONAL.includes('configuration.publish_sandbox')) {
            throw new McpToolError({
                code: 'INVALID_OVERRIDE',
                message: 'configuration.publish_sandbox is not in CONFIG_AGENT_OPTIONAL.',
            });
        }
        permissions.push('configuration.publish_sandbox');
    }
    if (input.includeOperatorMutate) {
        if (family !== 'operator') {
            throw new McpToolError({
                code: 'INVALID_OVERRIDE',
                message: 'operator.mutate opt-in is only valid on the "operator" family.',
            });
        }
        if (!OPERATOR_AGENT_OPTIONAL.includes('operator.mutate')) {
            throw new McpToolError({
                code: 'INVALID_OVERRIDE',
                message: 'operator.mutate is not in OPERATOR_AGENT_OPTIONAL.',
            });
        }
        permissions.push('operator.mutate');
    }

    const rawKey = `facio_${crypto.randomBytes(32).toString('hex')}`;
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const tenant = getTenantConfig();

    const data: Prisma.ApiKeyUncheckedCreateInput = {
        operatingTenantId: tenant.id,
        accountId: trimmedAccountId,
        name: trimmedName,
        keyHash,
        permissions,
        expiresAt: input.expiresAt ?? null,
    };

    const apiKey = await tenantScopedPrisma.apiKey.create({ data });

    logger.info(
        { apiKeyId: apiKey.id, family, accountId: trimmedAccountId, permissions, tenantSlug: tenant.tenantSlug },
        'mcp.apikey.issued',
    );

    return {
        apiKeyId: apiKey.id,
        name: apiKey.name,
        family,
        permissions,
        rawKey,
        operatingTenantSlug: tenant.tenantSlug,
        mountPath: family === 'operator' ? '/api/v1/mcp/operator' : '/api/v1/mcp/config',
        expiresAt: apiKey.expiresAt,
    };
}

export interface McpApiKeySummary {
    id: string;
    name: string;
    family: McpKeyFamily | 'unknown';
    accountId: string;
    permissions: string[];
    isActive: boolean;
    createdAt: Date;
    lastUsedAt: Date | null;
    expiresAt: Date | null;
}

function classifyKeyFamily(permissions: string[]): McpKeyFamily | 'unknown' {
    if (permissions.some((p) => p.startsWith('operator.'))) return 'operator';
    if (permissions.some((p) => p.startsWith('configuration.'))) return 'config';
    return 'unknown';
}

export async function listMcpApiKeys(): Promise<McpApiKeySummary[]> {
    const rows = await tenantScopedPrisma.apiKey.findMany({
        // Any MCP key — Config or Operator (both families' permissions
        // begin with their family name). Legacy /api/v1 keys with
        // `permissions = []` are filtered out.
        where: {
            permissions: {
                hasSome: [...CONFIG_AGENT_BASELINE, ...OPERATOR_AGENT_BASELINE],
            },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
    });
    return rows.map((r) => ({
        id: r.id,
        name: r.name,
        family: classifyKeyFamily(r.permissions),
        accountId: r.accountId,
        permissions: r.permissions,
        isActive: r.isActive,
        createdAt: r.createdAt,
        lastUsedAt: r.lastUsedAt,
        expiresAt: r.expiresAt,
    }));
}

export async function revokeMcpApiKey(apiKeyId: string): Promise<void> {
    await tenantScopedPrisma.apiKey.update({
        where: { id: apiKeyId },
        data: { isActive: false },
    });
    logger.info({ apiKeyId }, 'mcp.apikey.revoked');
}

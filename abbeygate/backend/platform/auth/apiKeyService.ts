import type { Prisma } from '@prisma/client';
import { getTenantConfig } from '../tenant/tenantConfig.js';
import { tenantScopedPrisma } from '../db/connection.js';
import crypto from 'crypto';
import { logger } from '../utils/logger.js';

export class ApiKeyService {
    /**
     * Generates a new API Key for a third-party account.
     * Returns the raw key (only shown once) and stores the hash.
     */
    static async createApiKey(accountId: string, name: string) {
        // Generate a secure, random crypto key
        const rawKey = `facio_${crypto.randomBytes(32).toString('hex')}`;

        // Hash it for DB storage (sha256 is sufficient and fast for high-throughput API keys)
        const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

        const apiKeyData: Prisma.ApiKeyUncheckedCreateInput = {
            operatingTenantId: getTenantConfig().id,
            accountId,
            name,
            keyHash,
        };
        const apiKey = await tenantScopedPrisma.apiKey.create({ data: apiKeyData });

        logger.info({ accountId, apiKeyId: apiKey.id }, 'New API key generated');

        // Return the raw key strictly ONCE
        return {
            id: apiKey.id,
            name: apiKey.name,
            rawKey,
        };
    }

    /**
     * Validates a raw API key against the database.
     * Returns the linked Account if valid.
     */
    static async validateKey(rawKey: string) {
        if (!rawKey || !rawKey.startsWith('facio_')) {
            return null;
        }

        const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

        const apiKey = await tenantScopedPrisma.apiKey.findUnique({
            where: { keyHash },
            include: { account: true },
        });

        if (!apiKey || !apiKey.isActive) {
            return null;
        }

        // Optional: Check expiration
        if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
            return null;
        }

        // Update lastUsedAt asynchronously so we don't block the request
        tenantScopedPrisma.apiKey.update({
            where: { id: apiKey.id },
            data: { lastUsedAt: new Date() },
        }).catch((err: unknown) => {
            logger.error({ err, keyId: apiKey.id }, 'Failed to update lastUsedAt for API Key');
        });

        return apiKey.account;
    }

    /**
     * MCP-specific key validation (ADR-0036 amendment). Returns the full
     * ApiKey row + linked Account so the MCP transport adapter can
     * synthesise an McpContext (apiKeyId for audit traceability,
     * permissions for the authorization gate, operating tenant for the
     * cross-tenant guard).
     *
     * Like `validateKey`, the read is tenant-scoped via the canonical
     * Prisma extension — a key issued for tenant CY is invisible from a
     * PT-tenant request. The mcpApiKeyAuth middleware adds a defensive
     * second check.
     */
    static async validateKeyForMcp(rawKey: string): Promise<{
        apiKeyId: string;
        permissions: string[];
        operatingTenant: { id: string; tenantSlug: string };
        account: { id: string; operatingTenantId: string };
    } | null> {
        if (!rawKey || !rawKey.startsWith('facio_')) return null;
        const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

        const apiKey = await tenantScopedPrisma.apiKey.findUnique({
            where: { keyHash },
            include: { account: true, operatingTenant: { select: { id: true, tenantSlug: true } } },
        });
        if (!apiKey || !apiKey.isActive) return null;
        if (apiKey.expiresAt && apiKey.expiresAt < new Date()) return null;

        // Async lastUsedAt update; never blocks the request.
        tenantScopedPrisma.apiKey
            .update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } })
            .catch((err: unknown) => logger.error({ err, keyId: apiKey.id }, 'mcp.apikey.lastUsedAt_update_failed'));

        return {
            apiKeyId: apiKey.id,
            permissions: apiKey.permissions,
            operatingTenant: apiKey.operatingTenant,
            account: { id: apiKey.account.id, operatingTenantId: apiKey.account.operatingTenantId },
        };
    }
}

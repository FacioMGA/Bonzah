import type { Prisma } from '@prisma/client';
import { Prisma as PrismaNs } from '@prisma/client';
import { prisma } from '../../../platform/db/connection.js';
import { logger } from '../../../platform/utils/logger.js';

/**
 * Ensures a SYNTHETIC sandbox tenant exists for Config MCP publish
 * targets. Idempotent — safe to call from `runNonHttpBootstraps`.
 *
 * Out of scope: provisioning SYNTHETIC tenants for end-user sandboxes
 * (Phase 4 — full multi-sandbox UX). V1 ships one shared demo sandbox.
 */
export const CONFIG_MCP_DEMO_SANDBOX_SLUG = 'abbeygate-config-mcp-sandbox';
const SYNTHETIC_TENANT_ID = '00000000-0000-4000-8000-00000000ffff';

export async function ensureConfigMcpDemoSandboxTenant(): Promise<void> {
    const existing = await prisma.tenant.findUnique({
        where: { tenantSlug: CONFIG_MCP_DEMO_SANDBOX_SLUG },
        select: { id: true, kind: true },
    });
    if (existing) {
        if (existing.kind !== 'SYNTHETIC') {
            logger.warn(
                { tenantSlug: CONFIG_MCP_DEMO_SANDBOX_SLUG, kind: existing.kind },
                'config.demo_sandbox.kind_mismatch — refusing to mutate existing non-synthetic tenant',
            );
        }
        return;
    }
    try {
        const emptyIpt: Prisma.InputJsonValue = {};
        await prisma.tenant.create({
            data: {
                id: SYNTHETIC_TENANT_ID,
                tenantSlug: CONFIG_MCP_DEMO_SANDBOX_SLUG,
                kind: 'SYNTHETIC',
                status: 'ACTIVE',
                countryCode: 'CY',
                country: 'Cyprus',
                currency: 'EUR',
                iptJson: emptyIpt,
                adminFee: new PrismaNs.Decimal(0),
                legalPack: 'cy',
                publicBaseUrl: 'https://config-mcp.sandbox.abbeygate.test',
                fromEmail: 'noreply@sandbox.abbeygate.test',
                priorityCountries: ['CY'],
                allowedRiskCountries: ['Cyprus'],
                defaultNationality: 'Cypriot',
                defaultDriversLicenseCountry: 'Cyprus',
                defaultBrokerName: 'Abbeygate Config MCP Sandbox',
            },
        });
        logger.info({ tenantSlug: CONFIG_MCP_DEMO_SANDBOX_SLUG }, 'config.demo_sandbox.seeded');
    } catch (err) {
        logger.warn({ err }, 'config.demo_sandbox.seed_failed');
    }
}

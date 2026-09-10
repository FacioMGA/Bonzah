/**
 * Config MCP — `config.ping` smoke test (ADR-0036).
 *
 * Mirror of `operator.ping`. Zero-side-effect tool used to confirm
 * end-to-end Config MCP connectivity from a remote client.
 *
 * `requiredPermission: 'configuration.read'` because every Config MCP
 * key issued via the BO carries `configuration.read` in its baseline.
 */
import type { McpContext } from '../../mcp/domain/mcpContext.js';
import { getTenantConfig } from '../../../platform/tenant/tenantConfig.js';

export interface ConfigPingOutput {
    ok: true;
    app: string;
    environment: string;
    tenant_slug: string;
    permissions: string[];
    server_time: string;
}

export async function configPing(_input: Record<string, never>, ctx: McpContext): Promise<ConfigPingOutput> {
    const tenant = getTenantConfig();
    return {
        ok: true,
        app: 'facio-config-mcp',
        environment: tenant.tenantSlug,
        tenant_slug: tenant.tenantSlug,
        permissions: ctx.permissions,
        server_time: new Date().toISOString(),
    };
}

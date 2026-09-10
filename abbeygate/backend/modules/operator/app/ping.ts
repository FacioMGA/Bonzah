/**
 * Operator MCP — `operator.ping` smoke test (ADR-0036 amendment #2).
 *
 * Zero-side-effect tool used to confirm end-to-end Operator MCP
 * connectivity from a remote client (Claude / ChatGPT / Cursor):
 * auth → permission resolution → tools/list discovery → tools/call →
 * envelope serialisation → audit row.
 *
 * `requiredPermission: 'operator.read'` because every Operator MCP key
 * issued via the BO carries `operator.read` in its baseline — if ping
 * is NOT visible in the catalog or fails to call, the key was issued
 * without baseline permissions and the runbook says re-issue.
 */
import type { McpContext } from '../../mcp/domain/mcpContext.js';
import { getTenantConfig } from '../../../platform/tenant/tenantConfig.js';
import { buildOperatorActionContext } from '../domain/operatorContext.js';
import type { OperatorSuccessEnvelope } from '../domain/operatorEnvelope.js';

export type OperatorPingOutput = OperatorSuccessEnvelope<{
    app: string;
    environment: string;
    tenant_slug: string;
    permissions: string[];
    server_time: string;
}>;

export async function operatorPing(_input: Record<string, never>, ctx: McpContext): Promise<OperatorPingOutput> {
    const action = buildOperatorActionContext(ctx);
    const tenant = getTenantConfig();
    return {
        ok: true,
        status: 'completed',
        action_id: action.actionId,
        correlation_id: action.correlationId,
        summary: `Operator MCP up. Tenant ${tenant.tenantSlug}; ${ctx.permissions.length} permission(s) on this key.`,
        entities: { tenantId: tenant.id },
        next_actions: ['operator.list_underwriting_queue', 'operator.search_customers'],
        extra: {
            app: 'facio-operator-mcp',
            environment: tenant.tenantSlug,
            tenant_slug: tenant.tenantSlug,
            permissions: ctx.permissions,
            server_time: new Date().toISOString(),
        },
    };
}

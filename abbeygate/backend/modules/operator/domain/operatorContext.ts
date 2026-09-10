import crypto from 'node:crypto';
import { getTenantConfig } from '../../../platform/tenant/tenantConfig.js';
import type { McpContext } from '../../mcp/domain/mcpContext.js';

/**
 * Operator-action-shaped context derived from the MCP funnel's
 * `McpContext` plus tenant + auto-generated `action_id` /
 * `correlation_id` so every operator envelope can stamp them.
 *
 * Created once per tool invocation by the operator tools' `.tool.ts`
 * adapters. NOT a second registry — every operator tool's `run`
 * receives the canonical `McpContext` and immediately builds this.
 */
export interface OperatorActionContext {
    mcp: McpContext;
    actionId: string;
    correlationId: string;
    tenantSlug: string;
}

export function buildOperatorActionContext(mcp: McpContext): OperatorActionContext {
    return {
        mcp,
        actionId: `act_${crypto.randomUUID()}`,
        correlationId: mcp.correlationId,
        tenantSlug: getTenantConfig().tenantSlug,
    };
}

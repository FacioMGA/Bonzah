/**
 * Pins the audit envelope shape that operator tools produce via the
 * shared `recordMcpAudit` funnel:
 *
 *   - actionName  : "OPERATOR.TOOL_CALLED.<dotted.tool.name>"
 *   - entityType  : "OPERATOR_ACTION"  (no draft-id branching like Config MCP)
 *   - diff        : carries toolFamily=operator + sessionId + inputHash + summary
 *
 * Plus the `OperatorEnvelope` success shape every operator tool returns.
 */
import { describe, expect, it } from 'vitest';
import { buildOperatorActionContext } from '../domain/operatorContext.js';
import type { OperatorSuccessEnvelope } from '../domain/operatorEnvelope.js';
import { runWithOperatingTenant } from '../../../platform/tenant/tenantAls.js';
import type { TenantConfig } from '../../../platform/tenant/tenantConfig.js';
import type { McpContext } from '../../mcp/domain/mcpContext.js';

function tenant(): TenantConfig {
    return {
        id: '00000000-0000-0000-0000-000000000001',
        tenantSlug: 'abbeygate-cy',
        countryCode: 'CY',
        country: 'Cyprus',
        currency: 'EUR',
        ipt: {},
        adminFee: 0,
        publicBaseUrl: 'https://example.test',
        fromEmail: 'noreply@example.test',
        brandLogo: { white: '', blue: '' },
        legalPack: 'cy',
    };
}

function makeCtx(): McpContext {
    return {
        tenantId: '00000000-0000-0000-0000-000000000001',
        userId: 'apikey:abc',
        role: 'USER',
        permissions: ['operator.read', 'operator.comm', 'operator.analytics'],
        channel: 'cursor',
        sessionId: 'session-1',
        requestId: 'req-1',
        correlationId: 'cid-1',
    };
}

describe('buildOperatorActionContext', () => {
    it('stamps a unique action_id and propagates the McpContext correlationId', () => {
        const mcp = makeCtx();
        const action = runWithOperatingTenant(tenant(), () => buildOperatorActionContext(mcp));
        expect(action.mcp.userId).toBe('apikey:abc');
        expect(action.correlationId).toBe(mcp.correlationId);
        expect(action.actionId).toMatch(/^act_[0-9a-f-]{8,}/);
        expect(action.tenantSlug).toBe('abbeygate-cy');
    });
});

describe('OperatorSuccessEnvelope', () => {
    it('carries the canonical fields downstream tools serialise into MCP CallToolResult.structuredContent', () => {
        const envelope: OperatorSuccessEnvelope<{ matches: number }> = {
            ok: true,
            status: 'completed',
            action_id: 'act_x',
            correlation_id: 'corr_x',
            summary: 'ok',
            entities: { policyHolderId: 'ph-1' },
            next_actions: ['operator.get_customer_context'],
            extra: { matches: 3 },
        };
        expect(envelope.ok).toBe(true);
        expect(envelope.status).toBe('completed');
        expect(envelope.entities.policyHolderId).toBe('ph-1');
        expect(envelope.next_actions).toContain('operator.get_customer_context');
        expect(envelope.extra?.matches).toBe(3);
    });
});

/**
 * Shared pre-flight gates for operator MCP V2 mutate tools (ADR-0039).
 *
 * Each gate returns either `{ ok: true, ctx }` with derived action
 * context, or an `OperatorErrorEnvelope` ready to return from the tool.
 * Centralising them here keeps the .ts files thin and makes the
 * "needs operator.mutate" / "needs valid policy" decisions consistent.
 */
import type { McpContext } from '../../mcp/domain/mcpContext.js';
import { buildOperatorActionContext, type OperatorActionContext } from '../domain/operatorContext.js';
import type { OperatorErrorEnvelope } from '../domain/operatorEnvelope.js';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';

export type MutateGateResult<TCtx> =
    | { ok: true; action: OperatorActionContext; data: TCtx }
    | { ok: false; envelope: OperatorErrorEnvelope };

export function requireMutatePermission<TCtx = unknown>(
    ctx: McpContext,
    extra?: TCtx,
): MutateGateResult<TCtx | undefined> {
    const action = buildOperatorActionContext(ctx);
    const has = (ctx.permissions || []).includes('operator.mutate');
    if (!has) {
        return {
            ok: false,
            envelope: {
                ok: false,
                status: 'error',
                summary: 'This API key cannot mutate quotes or endorsements.',
                error: {
                    code: 'PERMISSION_DENIED',
                    message:
                        'operator.mutate not granted. Issue a new MCP key with the "Allow quote/endorsement mutation" opt-in.',
                },
            },
        };
    }
    return { ok: true, action, data: extra };
}

export async function loadPolicyOrError(
    policyId: string,
): Promise<{ ok: true; policy: { id: string; productType: string | null; status: string | null; binderId: string | null } } | { ok: false; envelope: OperatorErrorEnvelope }> {
    const row = await tenantScopedPrisma.policy.findUnique({
        where: { id: policyId },
        select: { id: true, productType: true, status: true, binderId: true },
    });
    if (!row) {
        return {
            ok: false,
            envelope: {
                ok: false,
                status: 'error',
                summary: `No policy/quote with id "${policyId}".`,
                error: { code: 'NOT_FOUND', message: 'Policy not found in this tenant.' },
            },
        };
    }
    return { ok: true, policy: row };
}

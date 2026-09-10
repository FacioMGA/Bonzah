import crypto from 'node:crypto';
import type { McpContext } from '../domain/mcpContext.js';
import type { AnyToolDescriptor } from '../domain/toolDescriptor.js';
import { AuditLogger, type AuditEventType } from '../../../platform/audit/logger.js';
import { logger } from '../../../platform/utils/logger.js';

/**
 * Every tool invocation lands here exactly once — success or failure
 * (ADR-0036). AuditAction row is the primary signal; the outbox
 * `CONFIG.TOOL_CALLED` event is emitted by the calling module when
 * it makes its own canonical writes (we do not double-emit at the
 * MCP boundary for read-only and simulate-only tools).
 *
 * Sensitive inputs are hashed (inputHash) instead of stored raw to
 * keep audit rows free of PII even when tool inputs include free-text.
 */
export interface RecordMcpAuditArgs {
    tool: AnyToolDescriptor;
    ctx: McpContext;
    status: 'success' | 'error';
    summary: string;
    /** Raw input — hashed before persistence; never stored verbatim. */
    rawInput: unknown;
    /** Optional draft id when the tool operated on a ProductLaunchDraft. */
    draftId?: string;
    /** Optional structured error code for failed calls. */
    errorCode?: string;
}

function hashInput(value: unknown): string {
    try {
        const serialised = JSON.stringify(value ?? null);
        return crypto.createHash('sha256').update(serialised).digest('hex');
    } catch {
        return crypto.createHash('sha256').update('unserialisable').digest('hex');
    }
}

/**
 * Resolve `(actionName, entityType, entityId)` for the audit row from
 * the tool family. Both Config MCP and Operator MCP route through
 * this funnel; new families add a branch here.
 */
function resolveAuditDescriptors(
    family: string,
    toolName: string,
    draftId?: string,
): {
    actionName: AuditEventType;
    entityType: 'POLICY' | 'BINDER' | 'CLAIM' | 'USER' | 'PROGRAM' | 'CONFIG_DRAFT' | 'OPERATOR_ACTION' | 'COMMUNICATION';
    entityId: string;
} {
    if (family === 'operator') {
        return {
            actionName: `OPERATOR.TOOL_CALLED.${toolName}` as AuditEventType,
            entityType: 'OPERATOR_ACTION',
            entityId: 'operator-mcp-tool-call',
        };
    }
    // Default: Config MCP family.
    return {
        actionName: `CONFIG.TOOL_CALLED.${toolName}` as AuditEventType,
        entityType: draftId ? 'CONFIG_DRAFT' : 'PROGRAM',
        entityId: draftId || 'mcp-tool-call',
    };
}

export async function recordMcpAudit(args: RecordMcpAuditArgs): Promise<void> {
    const { tool, ctx, status, summary, rawInput, draftId, errorCode } = args;
    const inputHash = hashInput(rawInput);
    const { actionName, entityType, entityId } = resolveAuditDescriptors(tool.family, tool.name, draftId);

    try {
        await AuditLogger.log(
            entityId,
            entityType,
            actionName,
            ctx.userId || 'system',
            ctx.role === 'USER' ? 'USER' : 'SYSTEM',
            {
                toolFamily: tool.family,
                toolName: tool.name,
                channel: ctx.channel,
                sessionId: ctx.sessionId,
                requestId: ctx.requestId,
                correlationId: ctx.correlationId,
                inputHash,
                status,
                summary,
                errorCode: errorCode || null,
            },
            undefined,
        );
    } catch (err) {
        logger.warn({ err, toolName: tool.name }, 'mcp.audit.write_failed');
    }
}

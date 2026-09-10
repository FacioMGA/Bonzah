import { ZodError } from 'zod';
import { logger } from '../../../platform/utils/logger.js';
import { authorizeToolCall } from './authorizeToolCall.js';
import { recordMcpAudit } from './recordMcpAudit.js';
import { toolRegistry } from './toolRegistry.js';
import type { McpContext } from '../domain/mcpContext.js';
import { McpToolError } from '../domain/toolError.js';

/**
 * Single funnel for every MCP tool invocation (ADR-0036 §4). Order:
 *
 *   1. Resolve the tool descriptor from the registry.
 *   2. authorizeToolCall — fail with UNAUTHORIZED if permission missing.
 *   3. tool.inputSchema.parse — ZodError → VALIDATION_ERROR.
 *   4. tool.run — McpToolError propagates as-is; anything else becomes
 *      INTERNAL_ERROR.
 *   5. recordMcpAudit — exactly one audit row per call, success or fail.
 *
 * Every transport (HTTP/SSE today, stdio later) routes through here.
 */
export interface ExecuteToolCallResult<T = unknown> {
    output: T;
}

export async function executeToolCall(
    toolName: string,
    rawInput: unknown,
    ctx: McpContext,
): Promise<ExecuteToolCallResult> {
    const tool = toolRegistry.get(toolName);
    if (!tool) {
        const error = new McpToolError({
            code: 'VALIDATION_ERROR',
            message: `Unknown MCP tool "${toolName}".`,
        });
        // No tool descriptor → cannot audit at tool level; log only.
        logger.warn({ toolName, sessionId: ctx.sessionId }, 'mcp.tool.unknown');
        throw error;
    }

    let parsedInput: unknown;
    let summary = '';
    let status: 'success' | 'error' = 'error';
    let errorCode: string | undefined;
    let draftId: string | undefined;

    try {
        authorizeToolCall(tool, ctx);

        try {
            parsedInput = tool.inputSchema.parse(rawInput);
        } catch (zerr) {
            if (zerr instanceof ZodError) {
                throw new McpToolError({
                    code: 'VALIDATION_ERROR',
                    message: zerr.issues[0]?.message ?? 'Tool input failed schema validation.',
                    path: zerr.issues[0]?.path.join('.'),
                });
            }
            throw zerr;
        }

        // Capture draftId for audit when the input carries one — purely
        // for audit correlation; the tool itself owns business semantics.
        if (parsedInput && typeof parsedInput === 'object' && 'draftId' in parsedInput) {
            const candidate = (parsedInput as { draftId?: unknown }).draftId;
            if (typeof candidate === 'string') draftId = candidate;
        }

        const output = await tool.run(parsedInput, ctx);
        status = 'success';
        summary = buildSummary(tool.name, output);
        await recordMcpAudit({ tool, ctx, status, summary, rawInput, draftId });
        return { output };
    } catch (err) {
        const mapped = err instanceof McpToolError ? err : new McpToolError({
            code: 'INTERNAL_ERROR',
            message: err instanceof Error ? err.message : 'Unknown error executing tool.',
        });
        errorCode = mapped.code;
        summary = `[${mapped.code}] ${mapped.message}`;
        await recordMcpAudit({ tool, ctx, status, summary, rawInput, draftId, errorCode });
        throw mapped;
    }
}

function buildSummary(toolName: string, output: unknown): string {
    if (!output || typeof output !== 'object') return `${toolName}: ok`;
    const record = output as Record<string, unknown>;
    if (typeof record.summary === 'string') return record.summary;
    if (typeof record.status === 'string') return `${toolName}: ${record.status}`;
    return `${toolName}: ok`;
}

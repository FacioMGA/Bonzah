import type { McpContext } from '../domain/mcpContext.js';
import type { AnyToolDescriptor } from '../domain/toolDescriptor.js';
import { McpToolError } from '../domain/toolError.js';

/**
 * First gate in the executeToolCall funnel (ADR-0036 §4).
 *
 * Fails closed: missing user, missing permission, or absence of the
 * required permission all surface as UNAUTHORIZED. The MCP transport
 * adapter MUST set `ctx.userId` and `ctx.permissions` before calling
 * `executeToolCall`; this is a defense-in-depth check, not the
 * primary auth gate.
 */
export function authorizeToolCall(tool: AnyToolDescriptor, ctx: McpContext): void {
    if (!ctx.userId) {
        throw new McpToolError({
            code: 'UNAUTHORIZED',
            message: 'Authenticated user is required before MCP tool dispatch.',
        });
    }
    if (!Array.isArray(ctx.permissions)) {
        throw new McpToolError({
            code: 'UNAUTHORIZED',
            message: 'Permission set was not resolved before MCP tool dispatch.',
        });
    }
    if (!ctx.permissions.includes(tool.requiredPermission)) {
        throw new McpToolError({
            code: 'UNAUTHORIZED',
            message: `Missing permission "${tool.requiredPermission}" for tool "${tool.name}".`,
            suggestedFix: `Grant the "${tool.requiredPermission}" permission to this user's role.`,
        });
    }
}

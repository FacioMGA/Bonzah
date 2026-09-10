import type { McpContext } from './mcpContext.js';
import type { AnyToolDescriptor } from './toolDescriptor.js';

/**
 * Transport abstraction so the same ToolRegistry serves multiple
 * wire protocols. V1 ships only `httpSseTransport.ts` (mounted at
 * `/api/mcp/config`). A stdio adapter for Cursor / Claude Desktop
 * can be added later under `tools/mcp/` without touching the
 * registry or any individual tool.
 */
export interface ITransport {
    /** Transport identifier surfaced in audit logs and metrics. */
    readonly id: 'http-sse' | 'stdio';

    /**
     * Adapter-side serialisation of a single tool invocation result.
     * Lives on the transport because the protocol envelope differs
     * (REST JSON envelope today vs MCP JSON-RPC later).
     */
    serializeSuccess(toolName: string, output: unknown): unknown;

    /** Adapter-side serialisation of a tool error. */
    serializeError(toolName: string, error: unknown): unknown;
}

/**
 * Adapter-facing snapshot of the registry — the transport reads tool
 * metadata for catalog listing without holding a direct reference to
 * the registry instance (testability).
 */
export interface ToolCatalogSnapshot {
    list(): AnyToolDescriptor[];
    get(name: string): AnyToolDescriptor | undefined;
}

/**
 * Common shape for invocation requests across transports. Adapters
 * map their wire envelope into this and hand it to `executeToolCall`.
 */
export interface ToolInvocation {
    toolName: string;
    input: unknown;
    ctx: McpContext;
}

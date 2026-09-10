import type { ITransport } from '../../domain/transport.js';
import { serializeMcpError, serializeMcpSuccess } from '../../app/serializeMcpResult.js';

/**
 * HTTP/SSE transport for Config MCP V1 (ADR-0036). Mounted by
 * `mcpRouter.ts` at `/api/mcp/config`. Plain REST JSON envelope today
 * (single canonical envelope across catalog + invoke + tool-call
 * streaming); a future stdio adapter under `tools/mcp/` would
 * substitute MCP JSON-RPC frames without touching this file or the
 * registry.
 */
export const httpSseTransport: ITransport = {
    id: 'http-sse',
    serializeSuccess(toolName, output) {
        return serializeMcpSuccess(toolName, output);
    },
    serializeError(toolName, error) {
        return serializeMcpError(toolName, error);
    },
};

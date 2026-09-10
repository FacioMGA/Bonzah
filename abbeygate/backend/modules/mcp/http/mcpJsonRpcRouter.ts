/**
 * Public MCP JSON-RPC router factory (ADR-0036 + amendments).
 *
 * Two mounts share this factory:
 *   - /api/v1/mcp/config   ← family 'config'    (Config MCP V1)
 *   - /api/v1/mcp/operator ← family 'operator'  (Operator MCP V1, amendment #2)
 *
 * Both routes authenticate via `mcpApiKeyAuth` (Bearer `facio_…` token),
 * dispatch through the same canonical `executeToolCall` funnel, and
 * land in the same `AuditAction` table. Only the tool family exposed
 * by `tools/list` and accepted by `tools/call` differs.
 *
 * The transport is the official MCP Streamable HTTP transport from
 * `@modelcontextprotocol/sdk` — same protocol Claude Desktop, Claude
 * Code, and ChatGPT Connectors speak natively. No local bridge install.
 *
 * Distinct from the BO-internal router (`mcpRouter.ts`) which serves
 * plain REST JSON to the BO Product Architect page over a browser JWT.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { authenticateMcpRequest } from './mcpAuthMiddleware.js';
import { handleMcpStreamableHttpRequest } from '../app/streamableHttpTransport.js';

export interface CreateMcpJsonRpcRouterOptions {
    /**
     * Tool family to expose at this mount. The Streamable HTTP transport
     * filters `tools/list` and rejects `tools/call` for descriptors
     * outside the family. Single mount per family per process.
     */
    family: 'config' | 'operator';
}

export function createMcpJsonRpcRouter(options: CreateMcpJsonRpcRouterOptions): Router {
    const router = Router();
    router.use(authenticateMcpRequest);

    // Streamable HTTP per the MCP spec uses a single endpoint that accepts
    // both POST (client→server messages) and GET (server→client SSE stream).
    // The SDK transport (`@modelcontextprotocol/sdk`) requires raw
    // Node.js IncomingMessage / ServerResponse to do its own
    // protocol-level body parsing + SSE streaming, so `typedHandler`
    // would block the SDK from reading the request stream.
    async function dispatch(req: Request, res: Response, next: NextFunction): Promise<void> { // TODO(FAC-0036): owner=platform-eng expires=2026-12-31 deletionPR=N/A SDK Streamable HTTP transport requires raw Node Request
        try {
            await handleMcpStreamableHttpRequest(req, res, { familyFilter: options.family });
        } catch (err) {
            next(err);
        }
    }

    router.post('/', dispatch);
    router.get('/', dispatch);
    router.delete('/', dispatch);

    return router;
}

// Backward-compat default export — keeps existing wire (the prior
// `mcpJsonRpcRouter.ts` exported the config router as default).
export default createMcpJsonRpcRouter({ family: 'config' });

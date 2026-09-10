/**
 * Official MCP protocol transport (ADR-0036 amendment).
 *
 * Wires the canonical `toolRegistry` + `executeToolCall` funnel onto the
 * `@modelcontextprotocol/sdk` Streamable HTTP transport so any remote
 * MCP client (Claude Desktop, ChatGPT Connectors, Claude Code, Cursor
 * MCP) can connect directly to /api/v1/mcp/config with an `Authorization:
 * Bearer facio_…` header — no local bridge install required.
 *
 * Per-request lifecycle (stateless mode):
 *   1. mcpApiKeyAuth middleware validates the bearer token and sets
 *      req.user + req.resolvedPermissions.
 *   2. handleMcpRequest() builds the McpContext from the auth state.
 *   3. A fresh Server instance is constructed with two request handlers:
 *      - tools/list  → toolRegistry.list() filtered by permissions
 *      - tools/call  → executeToolCall(name, args, ctx)
 *   4. StreamableHTTPServerTransport.handleRequest() pipes the JSON-RPC
 *      session through the SDK and closes when the response is sent.
 *
 * Stateless was chosen deliberately: every MCP call carries its own
 * auth (bearer token) and every tool execution runs through the same
 * canonical funnel, so there is no useful per-session state to keep on
 * the server. This also dodges the SDK's in-memory session store, which
 * is fine for single-instance demo but is a memory leak across pod
 * restarts in HA. Sticky sessions land if we later need server-initiated
 * notifications.
 */
import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    type CallToolResult,
    type ListToolsResult,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { getCorrelationId } from '../../../../platform/observability/context.js';
import { getTenantConfig } from '../../../../platform/tenant/tenantConfig.js';
import { logger } from '../../../../platform/utils/logger.js';
import { executeToolCall } from '../../app/executeToolCall.js';
import { toolRegistry } from '../../app/toolRegistry.js';
import type { McpContext } from '../../domain/mcpContext.js';
import { McpToolError } from '../../domain/toolError.js';

const SERVER_INFO_BY_FAMILY: Record<string, { name: string; version: string }> = {
    config: { name: 'facio-config-mcp', version: '1.0.0' },
    operator: { name: 'facio-operator-mcp', version: '1.0.0' },
};

const DEFAULT_SERVER_INFO = { name: 'facio-mcp', version: '1.0.0' } as const;

/**
 * MCP wire-name <-> canonical-name translation (Cursor + OpenAI compat).
 *
 * Cursor's MCP client and OpenAI's function-calling API both enforce
 * `^[a-zA-Z0-9_-]+$` on tool names — no dots. Our canonical names
 * (which audit rows, ADRs, docs, and tests reference) use dots:
 * `operator.ping`, `config.products.cloneTemplate`, etc. Clients that
 * see dots silently filter the whole catalogue out (the symptom we hit
 * 2026-05-28: ChatGPT + Cursor both saw the namespace but zero callable
 * tools, every entry tagged "Tool name must only contain alphanumeric
 * characters and underscores").
 *
 * Translation is at the transport layer ONLY — `executeToolCall`,
 * `authorizeToolCall`, `recordMcpAudit`, every guard, every test, every
 * doc continues to operate on the dotted canonical name. The wire only
 * sees the underscored variant.
 *
 * Bi-directional: outgoing `tools/list` flips `.` → `_`; incoming
 * `tools/call` looks up by the wire name and resolves back to the
 * canonical descriptor (try the exact name first for clients that
 * happen to support dots, then translate underscores back).
 */
function toWireName(canonical: string): string {
    return canonical.replace(/\./g, '_');
}

function resolveDescriptorByWireName(wireName: string) {
    const direct = toolRegistry.get(wireName);
    if (direct) return direct;
    for (const descriptor of toolRegistry.list()) {
        if (toWireName(descriptor.name) === wireName) return descriptor;
    }
    return undefined;
}

function buildMcpContextFromRequest(req: Request, sessionId: string): McpContext {
    const userId = req.user?.id;
    if (!userId) {
        throw new McpToolError({
            code: 'UNAUTHORIZED',
            message: 'MCP transport invoked without a resolved identity.',
        });
    }
    const permissions = (req.resolvedPermissions || []).map((p) => p.key);
    return {
        tenantId: getTenantConfig().id,
        userId,
        role: 'USER',
        permissions,
        channel: 'cursor',
        sessionId,
        requestId: crypto.randomUUID(),
        correlationId: getCorrelationId() || crypto.randomUUID(),
    };
}

function describeToolForCatalog(name: string, description: string, inputSchema: unknown): ListToolsResult['tools'][number] {
    const jsonSchema = inputSchema as Record<string, unknown>;
    return {
        name,
        description,
        // MCP spec requires JSON Schema for the input shape — `inputSchema`
        // is `zodToJsonSchema(descriptor.inputSchema)` pre-computed at
        // catalog-build time below.
        inputSchema: jsonSchema as ListToolsResult['tools'][number]['inputSchema'],
    };
}

/**
 * Express handler: build a per-request MCP Server + StreamableHTTP
 * transport, wire the two canonical handlers, dispatch the JSON-RPC
 * frame, close the transport when the response is sent.
 *
 * `familyFilter` (ADR-0036 amendment #2): when set, only tools whose
 * `family` matches appear in tools/list AND `tools/call` rejects tools
 * outside the family. This is how the `/api/v1/mcp/config` and
 * `/api/v1/mcp/operator` mounts present disjoint catalogs from a
 * single shared registry.
 */
export async function handleMcpStreamableHttpRequest(
    req: Request,
    res: Response,
    options: { familyFilter?: string } = {},
): Promise<void> {
    const sessionId = crypto.randomUUID();
    let ctx: McpContext;
    try {
        ctx = buildMcpContextFromRequest(req, sessionId);
    } catch (err) {
        if (err instanceof McpToolError) {
            res.status(401).json({ success: false, error: err.toJSON() });
            return;
        }
        throw err;
    }
    const allowedPermissionKeys = new Set(ctx.permissions);
    const familyFilter = options.familyFilter;
    const serverInfo = (familyFilter && SERVER_INFO_BY_FAMILY[familyFilter]) || DEFAULT_SERVER_INFO;

    const server = new Server(serverInfo, { capabilities: { tools: {} } });

    // tools/list — return only the tools whose required permission is in
    // the calling key's resolved permission set AND (when supplied)
    // whose family matches the mount's filter. JSON Schema for each
    // tool's input shape is pre-computed once per request.
    //
    // Diagnostic logging at every step: when a customer reports "ChatGPT
    // sees the app but no tools" we want one log line that shows total
    // registered, after-family, after-permission, returned names, and
    // the caller's permission set. Cheap (one log per tools/list call)
    // and the noisy case is bounded.
    server.setRequestHandler(ListToolsRequestSchema, async (): Promise<ListToolsResult> => {
        const all = toolRegistry.list();
        const byFamily = all.filter((d) => !familyFilter || d.family === familyFilter);
        const afterPermission = byFamily.filter((d) => allowedPermissionKeys.has(d.requiredPermission));
        if (afterPermission.length === 0) {
            logger.warn(
                {
                    sessionId,
                    familyFilter,
                    callerPermissions: Array.from(allowedPermissionKeys),
                    totalRegistered: all.length,
                    afterFamilyFilter: byFamily.length,
                    droppedByPermission: byFamily.map((d) => `${d.name} (needs ${d.requiredPermission})`),
                },
                'mcp.streamableHttp.tools_list_empty',
            );
        } else {
            logger.info(
                {
                    sessionId,
                    familyFilter,
                    totalRegistered: all.length,
                    afterFamilyFilter: byFamily.length,
                    returned: afterPermission.length,
                    returnedWireNames: afterPermission.map((d) => toWireName(d.name)),
                },
                'mcp.streamableHttp.tools_list',
            );
        }
        const tools = afterPermission.map((descriptor) =>
            describeToolForCatalog(
                // Wire name uses underscores so Cursor/OpenAI accept it;
                // canonical dotted name stays inside the server.
                toWireName(descriptor.name),
                descriptor.description,
                // Zod 4 ships native JSON Schema conversion — avoids
                // the version-mismatch with `zod-to-json-schema`
                // (which is on Zod 3 internals).
                z.toJSONSchema(descriptor.inputSchema, { target: 'draft-7' }),
            ),
        );
        return { tools };
    });

    // tools/call — every invocation flows through the canonical
    // executeToolCall funnel (authorize → schema.parse → run → audit).
    // The funnel throws McpToolError for known failures; we translate to
    // the MCP isError envelope per spec.
    server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
        const { name: wireName, arguments: rawArgs } = request.params;
        // Resolve underscored wire name back to the canonical dotted
        // descriptor. Required because Cursor/OpenAI strip dots from
        // tool names before sending — see toWireName() above.
        const descriptor = resolveDescriptorByWireName(wireName);
        if (!descriptor) {
            const err = new McpToolError({
                code: 'VALIDATION_ERROR',
                message: `Tool "${wireName}" is not registered on this MCP mount.`,
            });
            logger.warn({ wireName, familyFilter, sessionId }, 'mcp.streamableHttp.unknown_tool');
            return {
                isError: true,
                content: [{ type: 'text', text: `${err.code}: ${err.message}` }],
                structuredContent: { error: err.toJSON() },
            };
        }
        // Defence-in-depth: even if a client somehow guesses a tool
        // name outside this mount's family, refuse to dispatch.
        if (familyFilter && descriptor.family !== familyFilter) {
            const err = new McpToolError({
                code: 'VALIDATION_ERROR',
                message: `Tool "${wireName}" is not available on this MCP mount.`,
            });
            logger.warn({ wireName, canonicalName: descriptor.name, familyFilter, sessionId }, 'mcp.streamableHttp.cross_family_call_rejected');
            return {
                isError: true,
                content: [{ type: 'text', text: `${err.code}: ${err.message}` }],
                structuredContent: { error: err.toJSON() },
            };
        }
        try {
            // Dispatch on the canonical dotted name so audit rows,
            // permission checks, and all downstream observability stay
            // consistent with the rest of the platform.
            const { output } = await executeToolCall(descriptor.name, rawArgs ?? {}, ctx);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(output, null, 2),
                    },
                ],
                structuredContent: output as Record<string, unknown>,
            };
        } catch (err) {
            const mapped = err instanceof McpToolError
                ? err
                : new McpToolError({
                      code: 'INTERNAL_ERROR',
                      message: err instanceof Error ? err.message : 'Tool execution failed.',
                  });
            logger.warn({ err: mapped, toolName: descriptor.name, wireName, sessionId }, 'mcp.streamableHttp.tool_failed');
            return {
                isError: true,
                content: [
                    {
                        type: 'text',
                        text: `${mapped.code}: ${mapped.message}${mapped.suggestedFix ? ` (suggested fix: ${mapped.suggestedFix})` : ''}`,
                    },
                ],
                structuredContent: { error: mapped.toJSON() },
            };
        }
    });

    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // Stateless — see header comment.
    });
    transport.onerror = (err: Error) => {
        logger.warn({ err, sessionId }, 'mcp.streamableHttp.transport_error');
    };

    await server.connect(transport);
    try {
        // req.body is a raw JSON-RPC frame — validation happens inside
        // the MCP SDK against `CallToolRequestSchema` / `ListToolsRequestSchema`
        // (z.object schemas) registered on the Server above. Per-tool
        // input validation then re-runs via the canonical executeToolCall
        // funnel, which calls descriptor.inputSchema.parse(args).
        await transport.handleRequest(req, res, req.body);
    } finally {
        // Close the per-request transport + server so timers / streams
        // do not accumulate across requests.
        await transport.close().catch(() => undefined);
        await server.close().catch(() => undefined);
    }
}

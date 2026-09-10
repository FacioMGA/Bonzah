/**
 * Server-injected execution context for every MCP tool call.
 *
 * Per ADR-0036, the model NEVER supplies any of these fields. The HTTP
 * router builds this object from the JWT chain + resolveOperatingTenant
 * middleware before the tool registry sees the input. Tools may read it
 * but never override it.
 *
 * Lives in `backend/modules/mcp/` because the MCP module is the sole
 * canonical owner of "AI agent tool exposure" per
 * docs/architecture/contracts/canonical-ownership.md.
 */
export interface McpContext {
    /** Operating tenant id resolved by resolveOperatingTenant. */
    tenantId: string;
    /** Authenticated user id from JWT. */
    userId: string;
    /** Legacy role tag from JWT (kept for AuditLogger actorType). */
    role: 'USER' | 'SYSTEM';
    /** Resolved fine-grained permissions for the user (e.g. 'configuration.draft'). */
    permissions: string[];
    /** Transport channel — drives audit `actorType` and rate-limit family. */
    channel: 'web' | 'whatsapp' | 'internal-demo' | 'cursor' | 'claude-desktop';
    /** Conversation / session id from the agent. Used for trace correlation. */
    sessionId: string;
    /** Per-tool-call request id. Distinct from sessionId. */
    requestId: string;
    /** Correlation id propagated from the inbound HTTP request. */
    correlationId: string;
}

/** Identity fields the model is forbidden from supplying in tool inputs. */
export const RESERVED_CONTEXT_FIELDS = [
    'tenantId',
    'userId',
    'roles',
    'role',
    'permissions',
    'operatingTenantId',
] as const;

export type ReservedContextField = (typeof RESERVED_CONTEXT_FIELDS)[number];

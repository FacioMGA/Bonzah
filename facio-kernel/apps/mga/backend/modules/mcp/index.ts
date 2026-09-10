/**
 * Public barrel for the MCP module (ADR-0036).
 *
 * Exports the small set of items that other modules legitimately need:
 *   - tool descriptor + context types (so each owning module can declare its own tools)
 *   - McpToolError (so use cases can throw the canonical error shape)
 *   - the boot helper `registerConfigTools` (called once from backend/index.ts)
 *
 * The tool registry instance and `executeToolCall` are NOT exported —
 * they are reachable only via the MCP transport adapters under `infra/`
 * so non-MCP modules cannot bypass the audit/permission funnel.
 */

export type { McpContext } from './domain/mcpContext.js';
export type { ToolDescriptor } from './domain/toolDescriptor.js';
export { McpToolError } from './domain/toolError.js';
export type { McpToolErrorCode, McpToolErrorDetails } from './domain/toolError.js';
export { registerConfigTools } from './infra/registerConfigTools.js';
export { registerOperatorTools } from './infra/registerOperatorTools.js';
export { default as mcpRouter } from './http/mcpRouter.js';
export { default as mcpKeysRouter } from './http/mcpKeysRouter.js';
export { default as mcpActionsRouter } from './http/mcpActionsRouter.js';
export { oauthDiscoveryRouter } from './oauth/http/oauthDiscoveryRouter.js';
export { oauthFlowRouter } from './oauth/http/oauthFlowRouter.js';
export { default as oauthClientsBoRouter } from './oauth/http/oauthClientsBoRouter.js';

/**
 * Public barrel for the operator module (ADR-0036 amendment #2).
 *
 * Per-tool descriptors export from here so the MCP registration helper
 * (`backend/modules/mcp/infra/registerOperatorTools.ts`) can wire them
 * at startup. Same pattern as `backend/modules/configuration/index.ts`.
 *
 * Domain types are deliberately NOT re-exported — the operator module
 * is the sole reader of its own envelopes / contexts; other modules
 * consume the MCP `CallToolResult.structuredContent` shape if they
 * need it.
 */

// Phase 1 — framework stub
export { getActionStatusTool } from './app/getActionStatus.tool.js';

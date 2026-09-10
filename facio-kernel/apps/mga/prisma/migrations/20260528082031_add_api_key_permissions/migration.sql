-- ADR-0036 amendment — per-key scoped permissions for remote MCP access.
--
-- Empty array on existing rows (legacy / non-MCP keys ignore this field
-- entirely). MCP key issuance populates from CONFIG_AGENT_BASELINE plus
-- optional opt-ins (e.g. `configuration.publish_sandbox`).
--
-- The MCP transport adapter (backend/modules/mcp/http/mcpApiKeyAuth.ts)
-- reads this field and sets req.resolvedPermissions directly; the
-- existing /api/v1/* routes continue to ignore it and resolve through
-- the Account-scoped tenant extension.

ALTER TABLE "api_keys"
  ADD COLUMN "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

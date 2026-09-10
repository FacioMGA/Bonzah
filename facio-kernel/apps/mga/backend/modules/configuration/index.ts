/**
 * Public barrel for the configuration module (ADR-0036, ADR-0037, ADR-0038).
 *
 * The MCP tool descriptors are exported here so the MCP registration
 * helper (`backend/modules/mcp/infra/registerConfigTools.ts`) can wire
 * them at startup. ProductLaunchDraft, DraftDelta, and the repository
 * are deliberately NOT re-exported — per canonical-ownership row
 * "Product launch staging", they are read/written only inside this
 * module. Enforced by `tools/quality/check-product-launch-draft-isolation.mjs`.
 */

// Read tools
export { getDraftSummaryTool } from './app/getDraftSummary.tool.js';
export { listReferralRulesTool } from './app/listReferralRules.tool.js';
export { listTemplatesTool } from './app/listTemplates.tool.js';
// Draft / write tools
export { addApprovalRuleTool } from './app/addApprovalRule.tool.js';
export { addReferralRuleTool } from './app/addReferralRule.tool.js';
export { cloneTemplateTool } from './app/cloneTemplate.tool.js';
export { setBillingTermsTool } from './app/setBillingTerms.tool.js';
export { setCoverageSelectionTool } from './app/setCoverageSelection.tool.js';
export { setRequiredDocumentTool } from './app/setRequiredDocument.tool.js';
export { setRequirednessTool } from './app/setRequiredness.tool.js';
// Validation + simulation tools
export { runDemoScenarioPackTool } from './app/runDemoScenarioPack.tool.js';
export { runQuoteScenarioTool } from './app/runQuoteScenario.tool.js';
export { validateDraftTool } from './app/validateDraft.tool.js';
export { CONFIG_MCP_DEMO_SANDBOX_SLUG } from './infra/syntheticTenantSeed.js';

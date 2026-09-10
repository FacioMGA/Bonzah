import { toolRegistry } from '../app/toolRegistry.js';
// Connectivity smoke test
import { configPingTool } from '../../configuration/app/ping.tool.js';
// Phase 0 — read + clone
import { cloneTemplateTool } from '../../configuration/app/cloneTemplate.tool.js';
import { getDraftSummaryTool } from '../../configuration/app/getDraftSummary.tool.js';
import { listTemplatesTool } from '../../configuration/app/listTemplates.tool.js';
// Phase 1 — write tools
import { addApprovalRuleTool } from '../../configuration/app/addApprovalRule.tool.js';
import { addReferralRuleTool } from '../../configuration/app/addReferralRule.tool.js';
import { listReferralRulesTool } from '../../configuration/app/listReferralRules.tool.js';
import { setBillingTermsTool } from '../../configuration/app/setBillingTerms.tool.js';
import { setCoverageSelectionTool } from '../../configuration/app/setCoverageSelection.tool.js';
import { setRequiredDocumentTool } from '../../configuration/app/setRequiredDocument.tool.js';
import { setRequirednessTool } from '../../configuration/app/setRequiredness.tool.js';
// Phase 2 — validation + simulation
import { runDemoScenarioPackTool } from '../../configuration/app/runDemoScenarioPack.tool.js';
import { runQuoteScenarioTool } from '../../configuration/app/runQuoteScenario.tool.js';
import { validateDraftTool } from '../../configuration/app/validateDraft.tool.js';
import { readInsuranceConfigurationTool, saveInsuranceConfigurationTool, publishInsuranceConfigurationTool, insuranceConfigurationSchemaTool } from '../../insuranceConfiguration/index.js';
import {
    listBinderProductAuthoritiesTool,
    previewUpsertBinderProductAuthorityTool,
    upsertBinderProductAuthorityTool,
} from '../../policy/app/binders/productAuthority.tool.js';
import { rentalDocumentCatalogueTool } from '../../../products/rental/documents/documentCatalogue.tool.js';
// Phase 3 — sandbox publish

/**
 * One-shot wiring of all `config.*` tool descriptors into the canonical
 * registry (ADR-0036). Called once at startup from `backend/index.ts`
 * after registerAllProducts(). The MCP module is the only module that
 * imports per-tool descriptors — owning modules export them; `mcp/`
 * publishes them.
 */
let registered = false;

export function registerConfigTools(): void {
    if (registered) return;
    registered = true;
    // Smoke test first — ranks at top of `tools/list` and is the safe
    // first call when wiring up a new remote client.
    toolRegistry.register(configPingTool);
    toolRegistry.register(readInsuranceConfigurationTool);
    toolRegistry.register(saveInsuranceConfigurationTool);
    toolRegistry.register(publishInsuranceConfigurationTool);
    toolRegistry.register(insuranceConfigurationSchemaTool);
    toolRegistry.register(rentalDocumentCatalogueTool);
    toolRegistry.register(listBinderProductAuthoritiesTool);
    // Read tools.
    toolRegistry.register(listTemplatesTool);
    toolRegistry.register(getDraftSummaryTool);
    toolRegistry.register(listReferralRulesTool);
    // Draft / write tools.
    toolRegistry.register(cloneTemplateTool);
    toolRegistry.register(addReferralRuleTool);
    toolRegistry.register(setRequirednessTool);
    toolRegistry.register(setRequiredDocumentTool);
    toolRegistry.register(setBillingTermsTool);
    toolRegistry.register(addApprovalRuleTool);
    toolRegistry.register(setCoverageSelectionTool);
    toolRegistry.register(previewUpsertBinderProductAuthorityTool);
    toolRegistry.register(upsertBinderProductAuthorityTool);
    // Validation + simulation.
    toolRegistry.register(validateDraftTool);
    toolRegistry.register(runQuoteScenarioTool);
    toolRegistry.register(runDemoScenarioPackTool);
    // Sandbox publish.
}

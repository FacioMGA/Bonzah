import { toolRegistry } from '../app/toolRegistry.js';
// Phase 0 — connectivity smoke test
import { pingTool } from '../../operator/app/ping.tool.js';
// Phase 1 — framework
import { getActionStatusTool } from '../../operator/app/getActionStatus.tool.js';
// Phase 2 — entity resolution
import { getCustomerContextTool } from '../../operator/app/getCustomerContext.tool.js';
import { getPolicyTool } from '../../operator/app/getPolicy.tool.js';
import { getQuoteTool } from '../../operator/app/getQuote.tool.js';
import { searchCustomersTool } from '../../operator/app/searchCustomers.tool.js';
import { searchPoliciesTool } from '../../operator/app/searchPolicies.tool.js';
import { searchQuotesTool } from '../../operator/app/searchQuotes.tool.js';
// Phase 3 — safe communications
import { resendPolicyDocumentsTool } from '../../operator/app/resendPolicyDocuments.tool.js';
import { sendFnolLinkTool } from '../../operator/app/sendFnolLink.tool.js';
import { sendQuoteReminderTool } from '../../operator/app/sendQuoteReminder.tool.js';
import { sendWizardLinkTool } from '../../operator/app/sendWizardLink.tool.js';
// Phase 6 — analytics
import { getQuotePipelineStatsTool } from '../../operator/app/getQuotePipelineStats.tool.js';
import { getSalesStatsTool } from '../../operator/app/getSalesStats.tool.js';
import { listUnderwritingQueueTool } from '../../operator/app/listUnderwritingQueue.tool.js';
// Phase V2 — quote mutation (ADR-0039, ADR-0036 amendment #3)
import { forkQuoteWorkspaceTool } from '../../operator/app/forkQuoteWorkspace.tool.js';
import { updateQuoteTermsTool } from '../../operator/app/updateQuoteTerms.tool.js';
import { rateQuoteTool } from '../../operator/app/rateQuote.tool.js';
import { previewQuoteSendTool } from '../../operator/app/previewQuoteSend.tool.js';
import { saveQuoteRevisionTool } from '../../operator/app/saveQuoteRevision.tool.js';
import { sendRevisedQuoteTool } from '../../operator/app/sendRevisedQuote.tool.js';
// Phase V2 — endorsement drafts (ADR-0039 §B3)
import { createEndorsementDraftTool } from '../../operator/app/createEndorsementDraft.tool.js';
import { sendEndorsementDataCaptureLinkTool } from '../../operator/app/sendEndorsementDataCaptureLink.tool.js';
import { submitEndorsementForReviewTool } from '../../operator/app/submitEndorsementForReview.tool.js';
import { reconcileBoDraftAuthorityTool } from '../../operator/app/reconcileBoDraftAuthority.tool.js';
import {
    bindPolicyTool,
    getPolicyIssuanceStatusTool,
    listPolicyDocumentsTool,
    previewPolicyBindTool,
} from '../../operator/app/policyIssuanceMcp.tool.js';
// Phase Claim Memory V1 — Claim Memory + MailGraph (ADR-0041)
import { getClaimMemoryTool } from '../../claims/app/mailgraph/getClaimMemory.tool.js';
import { refreshClaimMemoryTool } from '../../claims/app/mailgraph/refreshClaimMemory.tool.js';
import { findSimilarClaimsTool } from '../../claims/app/mailgraph/findSimilarClaims.tool.js';
import { analyzeClaimMemoryTool } from '../../claims/app/mailgraph/analyzeClaimMemory.tool.js';

/**
 * One-shot registration of every `operator.*` tool descriptor into the
 * canonical MCP tool registry (ADR-0036 amendment #2). Called once at
 * startup from `backend/index.ts` after `registerConfigTools()`. The
 * MCP module is the only module that imports per-tool descriptors —
 * owning modules export them; `mcp/` publishes them.
 *
 * Additional Phase 3 / 6 tools register here as they land.
 */
let registered = false;

export function registerOperatorTools(): void {
    if (registered) return;
    registered = true;
    // Phase 0 — smoke test (must register first so it ranks at the top
    // of `tools/list` for first-connection debugging).
    toolRegistry.register(pingTool);
    // Phase 1.
    toolRegistry.register(getActionStatusTool);
    // Phase 2 — entity resolution.
    toolRegistry.register(searchCustomersTool);
    toolRegistry.register(getCustomerContextTool);
    toolRegistry.register(searchQuotesTool);
    toolRegistry.register(searchPoliciesTool);
    toolRegistry.register(getQuoteTool);
    toolRegistry.register(getPolicyTool);
    // Phase 3 — safe communications.
    toolRegistry.register(sendWizardLinkTool);
    toolRegistry.register(sendQuoteReminderTool);
    toolRegistry.register(resendPolicyDocumentsTool);
    toolRegistry.register(sendFnolLinkTool);
    // Phase 6 — analytics.
    toolRegistry.register(listUnderwritingQueueTool);
    toolRegistry.register(getSalesStatsTool);
    toolRegistry.register(getQuotePipelineStatsTool);
    // V2 — quote mutation (ADR-0039 / ADR-0036 amendment #3).
    // Order mirrors the pipeline so tools/list returns them in the
    // sequence a human would call them.
    toolRegistry.register(forkQuoteWorkspaceTool);
    toolRegistry.register(updateQuoteTermsTool);
    toolRegistry.register(rateQuoteTool);
    toolRegistry.register(previewQuoteSendTool);
    toolRegistry.register(saveQuoteRevisionTool);
    toolRegistry.register(sendRevisedQuoteTool);
    // V2 — endorsement drafts (ADR-0039 §B3).
    toolRegistry.register(createEndorsementDraftTool);
    toolRegistry.register(sendEndorsementDataCaptureLinkTool);
    toolRegistry.register(submitEndorsementForReviewTool);
    // Explicit legacy data repair (ADR-0088): preview + confirmation only.
    toolRegistry.register(reconcileBoDraftAuthorityTool);
    // Governed policy completion: canonical readiness → preview token → bind,
    // followed by read-only issuance and document evidence.
    toolRegistry.register(previewPolicyBindTool);
    toolRegistry.register(bindPolicyTool);
    toolRegistry.register(getPolicyIssuanceStatusTool);
    toolRegistry.register(listPolicyDocumentsTool);
    // Claim Memory V1 (ADR-0041) — four read-class tools.  Order:
    // read first, then refresh, then similarity, then synthesis so
    // tools/list reflects the natural inspection flow.
    toolRegistry.register(getClaimMemoryTool);
    toolRegistry.register(refreshClaimMemoryTool);
    toolRegistry.register(findSimilarClaimsTool);
    toolRegistry.register(analyzeClaimMemoryTool);
}

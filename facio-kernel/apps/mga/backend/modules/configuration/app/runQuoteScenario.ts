import { McpToolError } from '../../mcp/domain/toolError.js';
import { ProductRegistry } from '../../policy/domain/ProductRegistry.js';
import { resolveProductEngines } from '../../policy/domain/productEngines.js';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import { resolveMappedProgramDefinition } from '../../programs/app/activeProgramDefinition.js';
import { findDraft } from '../infra/repositories/productLaunchDraftRepo.js';

export interface RunQuoteScenarioInput {
    draftId: string;
    scenarioName: string;
    riskData: Record<string, unknown>;
}

export interface ScenarioResult {
    scenarioId: string;
    outcome: 'accept' | 'referral' | 'decline';
    referralTriggered: boolean;
    referralReasons: string[];
    missingRequiredFields: string[];
    documentsRequiredAtBind: string[];
    billingSummary: string;
}

export interface RunQuoteScenarioOutput {
    scenarioId: string;
    result: ScenarioResult;
}

/**
 * Phase 2 simulation runner dispatches through the registered product UW
 * engine using the exact published, binder-mapped programme definition. It
 * never imports a product UW leaf directly and never reconstructs behaviour
 * from a Config MCP overlay or Program.metadata.
 */
export async function runQuoteScenario(
    input: RunQuoteScenarioInput,
): Promise<RunQuoteScenarioOutput> {
    const draft = await findDraft(input.draftId);
    if (!draft) {
        throw new McpToolError({ code: 'DRAFT_NOT_FOUND', message: `No draft "${input.draftId}".` });
    }

    const productCode = String(draft.productCode || '').trim().toUpperCase();
    const adapter = ProductRegistry.getInstance().getAdapter(productCode);
    if (!adapter) {
        throw new McpToolError({
            code: 'INTERNAL_ERROR',
            message: `No product adapter registered for "${productCode}".`,
        });
    }
    const runtime = adapter.getRuntimeDefinition();
    if (!runtime) {
        throw new McpToolError({
            code: 'REQUIRES_ENGINEERING',
            message: `Product "${productCode}" has no runtime definition — simulation requires a registered engine triple.`,
            ticket: {
                kind: 'other',
                summary: `Wire ProductRuntimeDefinition for product "${productCode}".`,
                canonicalOwner: `backend/products/${productCode.toLowerCase()}/runtime.ts`,
            },
        });
    }
    const binderId = String(draft.publishedBinderId || '').trim();
    const programId = String(draft.publishedProgramId || '').trim();
    if (!binderId || !programId) {
        throw new McpToolError({
            code: 'PUBLISH_BLOCKED',
            message: 'Simulation requires a published programme and binder mapped to a complete programme definition.',
        });
    }
    const binderProductAuthority = await tenantScopedPrisma.binderProductAuthority.findUnique({
        where: { binderId_productCode: { binderId, productCode } },
        select: { id: true },
    });
    if (!binderProductAuthority) {
        throw new McpToolError({
            code: 'PUBLISH_BLOCKED',
            message: `Simulation requires an active ${productCode} binder-product authority for the selected binder.`,
        });
    }
    const programDefinition = await resolveMappedProgramDefinition({
        programId,
        binderProductAuthorityId: binderProductAuthority.id,
    });
    const engines = resolveProductEngines(runtime.engines, {
        programId: draft.publishedProgramId,
        binderId: draft.publishedBinderId,
        tenantId: draft.operatingTenantId,
    });

    const evalResult = await engines.underwriting.evaluate({
        productType: productCode,
        quoteData: input.riskData,
        context: {
            programDefinition: {
                id: programDefinition.id,
                programId: programDefinition.programId,
                version: programDefinition.version,
                pricingMode: programDefinition.pricingMode,
                binderProductAuthorityId: programDefinition.binderProductAuthorityId,
                underwriting: programDefinition.underwriting,
                coverage: programDefinition.coverage,
                questionnaire: programDefinition.questionnaire,
                workflow: programDefinition.workflow,
                channels: programDefinition.channels,
                documents: programDefinition.documents,
            },
            ...(programDefinition.ratingModel ? {
                ratingModel: {
                    ...programDefinition.ratingModel,
                    binderProductAuthorityId: programDefinition.binderProductAuthorityId,
                },
            } : {}),
        },
    });
    const decision = evalResult.decision || {};
    const outcome = normalizeOutcome(decision.outcome);
    const reasons = Array.isArray(decision.reasons)
        ? (decision.reasons as unknown[]).map((r) => String(r))
        : [];

    const documentsRequiredAtBind = (draft.delta.jurisdictionOverrides?.documentConfig || [])
        .filter((d) => (d.requiredAt || []).includes('bind'))
        .map((d) => d.documentType);
    const billing = draft.delta.billing;
    const billingSummary = billing
        ? [
              billing.paymentTerms,
              billing.commissionPercent !== undefined ? `${billing.commissionPercent}% commission` : null,
              billing.cancellationRefundBasis ? `${billing.cancellationRefundBasis} cancellation` : null,
          ]
              .filter(Boolean)
              .join(', ')
        : 'Inherits template defaults.';

    const result: ScenarioResult = {
        scenarioId: `${draft.id}-${input.scenarioName}`,
        outcome,
        referralTriggered: outcome === 'referral',
        referralReasons: reasons,
        missingRequiredFields: [],
        documentsRequiredAtBind,
        billingSummary,
    };
    return { scenarioId: result.scenarioId, result };
}

function normalizeOutcome(raw: unknown): 'accept' | 'referral' | 'decline' {
    const v = String(raw || '').toLowerCase();
    if (v === 'decline') return 'decline';
    if (v === 'referral' || v === 'refer') return 'referral';
    return 'accept';
}

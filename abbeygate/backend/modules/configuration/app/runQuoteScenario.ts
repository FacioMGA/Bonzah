import { McpToolError } from '../../mcp/domain/toolError.js';
import { ProductRegistry } from '../../policy/domain/ProductRegistry.js';
import { resolveProductEngines } from '../../policy/domain/productEngines.js';
import type { DraftDelta, MotorUwOverrides } from '../domain/draftDelta.js';
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
 * Phase 2 simulation runner. Composes the draft's overlay into a
 * synthetic `programMeta` and dispatches through the registered
 * product adapter's UW engine — never imports `motorUwAutomation`
 * directly (forbidden by `tools/quality/check-product-engine-contract.mjs`
 * for any code outside `backend/products/motor/`). The canonical
 * engine reads `programMeta.abbeygateMotorUwConfig` and merges over
 * the per-product defaults itself.
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
    const engines = resolveProductEngines(runtime.engines, {
        programId: draft.publishedProgramId,
        binderId: draft.publishedBinderId,
        tenantId: draft.operatingTenantId,
    });

    const programMeta = composeOverlayProgramMeta(draft.delta);
    const evalResult = await engines.underwriting.evaluate({
        productType: productCode,
        quoteData: input.riskData,
        programMeta,
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

function composeOverlayProgramMeta(delta: DraftDelta): Record<string, unknown> {
    const uw = delta.uwOverrides;
    if (!uw) return {};
    const overlay: MotorUwOverrides = {};
    if (uw.allowedRiskCountries) overlay.allowedRiskCountries = uw.allowedRiskCountries;
    if (uw.allowedVehicleUses) overlay.allowedVehicleUses = uw.allowedVehicleUses;
    if (uw.referralFlags) overlay.referralFlags = uw.referralFlags;
    if (uw.thresholds) overlay.thresholds = uw.thresholds;
    // The canonical motor UW engine reads from
    // `programMeta.abbeygateMotorUwConfig` and merges over the
    // per-product defaults itself — we just hand it the staged overlay
    // verbatim. Future product UW engines will read their own slot.
    return { abbeygateMotorUwConfig: overlay };
}

function normalizeOutcome(raw: unknown): 'accept' | 'referral' | 'decline' {
    const v = String(raw || '').toLowerCase();
    if (v === 'decline') return 'decline';
    if (v === 'referral' || v === 'refer') return 'referral';
    return 'accept';
}

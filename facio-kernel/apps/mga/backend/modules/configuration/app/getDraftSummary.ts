import { McpToolError } from '../../mcp/domain/toolError.js';
import type { DraftDelta } from '../domain/draftDelta.js';
import type { ConfigDraftStatus } from '../domain/productLaunchDraft.js';
import { findDraft } from '../infra/repositories/productLaunchDraftRepo.js';
import { getTemplate } from '../infra/templates/index.js';

export interface GetDraftSummaryInput {
    draftId: string;
}

export interface GetDraftSummaryOutput {
    draftId: string;
    productName: string;
    productCode: string;
    baseTemplateId: string;
    status: ConfigDraftStatus;
    configuredCapabilities: string[];
    missingDecisions: string[];
    delta: DraftDelta;
    publishedProgramId: string | null;
    publishedBinderId: string | null;
}

export async function getDraftSummary(input: GetDraftSummaryInput): Promise<GetDraftSummaryOutput> {
    const draft = await findDraft(input.draftId);
    if (!draft) {
        throw new McpToolError({
            code: 'DRAFT_NOT_FOUND',
            message: `No draft with id "${input.draftId}".`,
        });
    }
    const template = getTemplate(draft.baseTemplateId);
    return {
        draftId: draft.id,
        productName: draft.name,
        productCode: draft.productCode,
        baseTemplateId: draft.baseTemplateId,
        status: draft.status,
        configuredCapabilities: deriveConfiguredCapabilities(draft.delta),
        missingDecisions: deriveMissingDecisions(draft.delta, template?.supportedCapabilities ?? []),
        delta: draft.delta,
        publishedProgramId: draft.publishedProgramId,
        publishedBinderId: draft.publishedBinderId,
    };
}

function deriveConfiguredCapabilities(delta: DraftDelta): string[] {
    const out: string[] = [];
    if (
        delta.uwOverrides?.thresholds ||
        delta.uwOverrides?.allowedRiskCountries ||
        delta.uwOverrides?.allowedVehicleUses ||
        delta.uwOverrides?.referralFlags
    ) {
        out.push('underwriting-thresholds');
    }
    if (delta.questionnaireOverrides?.requiredAt && Object.keys(delta.questionnaireOverrides.requiredAt).length > 0) {
        out.push('questionnaire-overlay');
    }
    if ((delta.approvalRules || []).length > 0) {
        out.push('approval-rules');
    }
    if ((delta.jurisdictionOverrides?.documentConfig || []).length > 0) {
        out.push('document-overlay');
    }
    if (delta.billing && Object.keys(delta.billing).length > 0) {
        out.push('commercial-terms');
    }
    if (delta.mbeOverrides && Object.keys(delta.mbeOverrides).length > 0) {
        out.push('mbe-coverage-selection');
    }
    if (delta.binderAuthorityOverrides && Object.keys(delta.binderAuthorityOverrides).length > 0) {
        out.push('binder-authority-caps');
    }
    return out;
}

function deriveMissingDecisions(delta: DraftDelta, supportedCapabilities: string[]): string[] {
    const configured = new Set(deriveConfiguredCapabilities(delta));
    return supportedCapabilities.filter((c) => !configured.has(c));
}

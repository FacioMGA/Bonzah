import type { McpContext } from '../../mcp/domain/mcpContext.js';
import { consumeConfirmationToken, hashPreviewInput, issueConfirmationToken } from '../../mcp/infra/confirmationTokenStore.js';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import { getTenantConfig } from '../../../platform/tenant/tenantConfig.js';
import { evaluateIssueReadiness } from '../../policy/domain/issueReadiness.js';
import { executeBindPolicy } from '../../policy/app/BindPolicy.js';
import { buildOperatorActionContext } from '../domain/operatorContext.js';
import type { OperatorEnvelope } from '../domain/operatorEnvelope.js';
import { requireMutatePermission } from './operatorMutateGuards.js';

const BIND_TOOL_NAME = 'operator.bind_policy';

type BindingGuard = {
    policyId: string;
    status: string;
    paymentStatus: string | null;
    programId: string | null;
    binderId: string | null;
    updatedAt: string;
    stateHash: string;
};

async function loadBindingGuard(policyId: string): Promise<BindingGuard | null> {
    const policy = await tenantScopedPrisma.policy.findUnique({
        where: { id: policyId },
        select: {
            id: true,
            status: true,
            paymentStatus: true,
            programId: true,
            binderId: true,
            updatedAt: true,
            quoteData: true,
            quoteResponse: true,
            stateCurrent: { select: { snapshot: true, updatedAt: true } },
        },
    });
    if (!policy) return null;
    return {
        policyId: policy.id,
        status: String(policy.status || ''),
        paymentStatus: policy.paymentStatus,
        programId: policy.programId,
        binderId: policy.binderId,
        updatedAt: policy.updatedAt.toISOString(),
        stateHash: hashPreviewInput({
            quoteData: policy.quoteData,
            quoteResponse: policy.quoteResponse,
            state: policy.stateCurrent?.snapshot ?? null,
            stateUpdatedAt: policy.stateCurrent?.updatedAt.toISOString() ?? null,
            programId: policy.programId,
            binderId: policy.binderId,
            paymentStatus: policy.paymentStatus,
        }),
    };
}

function errorEnvelope(code: string, message: string, suggested_fix?: string): OperatorEnvelope {
    return { ok: false, status: 'error', summary: message, error: { code, message, ...(suggested_fix ? { suggested_fix } : {}) } };
}

export async function previewPolicyBind(
    input: { policyId: string },
    ctx: McpContext,
): Promise<OperatorEnvelope> {
    const gate = requireMutatePermission(ctx);
    if (!gate.ok) return gate.envelope;
    const guard = await loadBindingGuard(input.policyId);
    if (!guard) return errorEnvelope('NOT_FOUND', 'Policy not found in this workspace.');
    if (String(guard.paymentStatus || '').toUpperCase() !== 'PAID') {
        return errorEnvelope(
            'PAYMENT_NOT_VERIFIED',
            'Server-verified payment is required before an MCP bind can be previewed.',
            'Complete the configured payment-provider verification flow, then preview bind again.',
        );
    }

    const readiness = await evaluateIssueReadiness(input.policyId, 'bo');
    const blockers = readiness.blockers
        .filter((blocker) => (blocker.severity ?? 'BLOCK') === 'BLOCK')
        .map((blocker) => ({ code: blocker.code, message: blocker.message }));
    if (!readiness.canIssue) {
        return errorEnvelope(
            'NOT_READY_TO_BIND',
            blockers.map((blocker) => blocker.message).join('; ') || 'Policy is not ready to bind.',
            'Resolve the returned readiness blockers, then preview bind again.',
        );
    }

    const preview = { kind: 'policy_bind', guard };
    const issued = await issueConfirmationToken({
        actorId: ctx.userId,
        toolName: BIND_TOOL_NAME,
        entityId: input.policyId,
        inputHash: hashPreviewInput(preview),
        issuedAt: new Date().toISOString(),
        preview,
    });
    return {
        ok: true,
        status: 'preview',
        action_id: gate.action.actionId,
        correlation_id: gate.action.correlationId,
        summary: `Policy ${input.policyId} passed bind readiness. Confirming will legally bind it and enqueue its issued document pack.`,
        requires_confirmation: true,
        confirmation_token: issued.token,
        expires_at: issued.expiresAt,
        entities: { policyId: input.policyId },
        diff: [{ field: 'status', from: guard.status, to: 'ISSUING' }],
        readiness_blockers: [],
        preview_extra: {
            configuration_hash: guard.stateHash,
            payment_status: guard.paymentStatus,
            program_id: guard.programId,
            binder_id: guard.binderId,
        },
    };
}

export async function bindPolicyFromMcp(
    input: { policyId: string; confirmation_token: string },
    ctx: McpContext,
): Promise<OperatorEnvelope> {
    const gate = requireMutatePermission(ctx);
    if (!gate.ok) return gate.envelope;
    const consumed = await consumeConfirmationToken(input.confirmation_token, {
        actorId: ctx.userId,
        toolName: BIND_TOOL_NAME,
        entityId: input.policyId,
    });
    const preview = consumed?.preview as { kind?: unknown; guard?: BindingGuard } | undefined;
    if (!consumed || preview?.kind !== 'policy_bind' || !preview.guard) {
        return errorEnvelope('CONFIRMATION_TOKEN_INVALID', 'Confirmation token is invalid, expired, already used, or belongs to another actor.');
    }

    const currentGuard = await loadBindingGuard(input.policyId);
    if (!currentGuard || hashPreviewInput(currentGuard) !== hashPreviewInput(preview.guard)) {
        return errorEnvelope(
            'PREVIEW_STALE',
            'Policy, payment, authority assignment, or retained configuration changed after preview.',
            'Run operator.preview_policy_bind again and review the new configuration hash.',
        );
    }

    const result = await executeBindPolicy({
        policyId: input.policyId,
        actor: { id: ctx.userId, name: 'MCP operator', email: null, role: 'OPERATOR_AGENT', userType: 'MCP' },
        correlationId: gate.action.correlationId,
    });
    if (result.status !== 'SUCCESS') {
        const detail = result.error as { code?: string; message?: string };
        return errorEnvelope(detail.code || result.status, detail.message || 'Policy bind failed.');
    }
    const data = result.data;
    return {
        ok: true,
        status: 'completed',
        action_id: gate.action.actionId,
        correlation_id: gate.action.correlationId,
        summary: `Policy ${input.policyId} is binding; the canonical issued-document job has been queued.`,
        entities: { policyId: input.policyId },
        next_actions: ['operator.get_policy_issuance_status', 'operator.list_policy_documents'],
        extra: {
            policy_status: String(data.status || 'ISSUING'),
            policy_number: typeof data.policyNumber === 'string' ? data.policyNumber : null,
            document_job_id: typeof data.documentJobId === 'string' ? data.documentJobId : null,
            invoice_id: typeof data.invoiceId === 'string' ? data.invoiceId : null,
            configuration_hash: currentGuard.stateHash,
        },
    };
}

export async function getPolicyIssuanceStatus(
    input: { policyId: string },
    ctx: McpContext,
): Promise<OperatorEnvelope> {
    const action = buildOperatorActionContext(ctx);
    const policy = await tenantScopedPrisma.policy.findUnique({
        where: { id: input.policyId },
        select: {
            id: true,
            policyNumber: true,
            productType: true,
            status: true,
            paymentStatus: true,
            programId: true,
            binderId: true,
            certificateNumber: true,
            issuedAt: true,
            updatedAt: true,
            riskTransactions: {
                where: { transactionType: 'INCEPTION' },
                orderBy: { transactionNumber: 'desc' },
                take: 1,
                select: { id: true, status: true },
            },
            documents: {
                where: { status: 'GENERATED' },
                orderBy: { createdAt: 'desc' },
                select: { id: true, type: true, docPack: true, fileHash: true, templateVersion: true },
            },
        },
    });
    if (!policy) return errorEnvelope('NOT_FOUND', 'Policy not found in this workspace.');
    const readiness = await evaluateIssueReadiness(input.policyId, 'bo');
    return {
        ok: true,
        status: 'completed',
        action_id: action.actionId,
        correlation_id: action.correlationId,
        summary: `Policy ${policy.policyNumber} is ${policy.status}; ${policy.documents.length} generated document(s) are retained.`,
        entities: { policyId: policy.id },
        next_actions: readiness.derived.hasIssuedPackDocuments ? ['operator.list_policy_documents'] : ['operator.get_policy_issuance_status'],
        extra: {
            policy_number: policy.policyNumber,
            product_type: policy.productType,
            policy_status: policy.status,
            payment_status: policy.paymentStatus,
            program_id: policy.programId,
            binder_id: policy.binderId,
            certificate_number: policy.certificateNumber,
            issued_at: policy.issuedAt?.toISOString() ?? null,
            risk_transaction: policy.riskTransactions[0] ?? null,
            can_issue: readiness.canIssue,
            customer_outcome: readiness.customerOutcome ?? null,
            readiness_blockers: readiness.blockers,
            documents: policy.documents,
        },
    };
}

export async function listPolicyDocumentsFromMcp(
    input: { policyId: string },
    ctx: McpContext,
): Promise<OperatorEnvelope> {
    const action = buildOperatorActionContext(ctx);
    const policy = await tenantScopedPrisma.policy.findUnique({
        where: { id: input.policyId },
        select: { id: true, policyNumber: true },
    });
    if (!policy) return errorEnvelope('NOT_FOUND', 'Policy not found in this workspace.');
    const documents = await tenantScopedPrisma.document.findMany({
        where: { policyId: input.policyId, status: 'GENERATED' },
        orderBy: [{ docPack: 'asc' }, { type: 'asc' }, { version: 'desc' }],
        select: {
            id: true,
            type: true,
            docPack: true,
            version: true,
            templateVersion: true,
            source: true,
            generatedAt: true,
            filename: true,
            fileHash: true,
        },
    });
    const baseUrl = getTenantConfig().publicBaseUrl.replace(/\/$/, '');
    return {
        ok: true,
        status: 'completed',
        action_id: action.actionId,
        correlation_id: action.correlationId,
        summary: `Found ${documents.length} generated document(s) for policy ${policy.policyNumber}.`,
        entities: { policyId: policy.id },
        next_actions: [],
        extra: {
            policy_number: policy.policyNumber,
            documents: documents.map((document) => ({
                ...document,
                generatedAt: document.generatedAt.toISOString(),
                download_url: `${baseUrl}/api/public/documents/${document.id}`,
            })),
        },
    };
}

/**
 * Operator MCP V2 — `operator.send_endorsement_link`
 * (ADR-0039 §B3, ADR-0036 amendment #3).
 *
 * Sends the customer a secure link to enter the changed details for a
 * DRAFT endorsement created by `operator.create_endorsement_draft`.
 * Uses the canonical `dispatchCustomerEmailTrigger` with the new
 * `ENDORSEMENT_DATA_CAPTURE_REQUESTED` trigger (template
 * `ENDORSEMENT_DATA_CAPTURE`).
 *
 * `auditClass: 'comm'` — same audit class as the V1 wizard-link /
 * quote-reminder tools because the customer-facing surface is the
 * approved-template email pipeline; the destination is the existing
 * BO endorsement workspace URL, not a new public route.
 */
import crypto from 'node:crypto';
import type { McpContext } from '../../mcp/domain/mcpContext.js';
import type { OperatorEnvelope, OperatorSuccessEnvelope } from '../domain/operatorEnvelope.js';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import { getTenantConfig } from '../../../platform/tenant/tenantConfig.js';
import { logger } from '../../../platform/utils/logger.js';
import { AuditLogger } from '../../../platform/audit/logger.js';
import { parseRecord } from '../../../platform/json/parseRecord.js';
import { dispatchCustomerEmailTrigger } from '../../communications/app/customerEmailTriggerService.js';
import { loadPolicyOrError, requireMutatePermission } from './operatorMutateGuards.js';

const READABLE_REASONS: Record<string, string> = {
    ADDRESS_CHANGE: 'address change',
    NAMED_DRIVER_CHANGE: 'named driver change',
};

export interface OperatorSendEndorsementDataCaptureLinkInput {
    policyId: string;
    riskTransactionId: string;
}

export type OperatorSendEndorsementDataCaptureLinkOutput = OperatorEnvelope<{
    capture_url: string;
    recipient: string;
}>;

export async function operatorSendEndorsementDataCaptureLink(
    input: OperatorSendEndorsementDataCaptureLinkInput,
    ctx: McpContext,
): Promise<OperatorSendEndorsementDataCaptureLinkOutput> {
    const gate = requireMutatePermission(ctx);
    if (!gate.ok) return gate.envelope;
    const policyGate = await loadPolicyOrError(input.policyId);
    if (!policyGate.ok) return policyGate.envelope;

    const rt = await tenantScopedPrisma.riskTransaction.findUnique({
        where: { id: input.riskTransactionId },
        select: {
            id: true,
            policyId: true,
            status: true,
            transactionType: true,
            transactionNumber: true,
            snapshotDraft: true,
        },
    });
    if (!rt || rt.policyId !== input.policyId) {
        return {
            ok: false,
            status: 'error',
            summary: `Risk transaction "${input.riskTransactionId}" not found on policy ${input.policyId}.`,
            error: { code: 'NOT_FOUND', message: 'Endorsement draft not found on this policy.' },
        };
    }
    if (String(rt.status || '').toUpperCase() !== 'DRAFT') {
        return {
            ok: false,
            status: 'error',
            summary: `Endorsement #${rt.transactionNumber} is not DRAFT (status: ${rt.status}).`,
            error: {
                code: 'INVALID_STATUS',
                message: 'Data capture link is only available on DRAFT endorsements.',
            },
        };
    }
    if (String(rt.transactionType || '').toUpperCase() !== 'ENDORSEMENT') {
        return {
            ok: false,
            status: 'error',
            summary: `Transaction #${rt.transactionNumber} is a ${rt.transactionType}, not an endorsement.`,
            error: {
                code: 'INVALID_TRANSACTION_TYPE',
                message: 'Data capture link is only available on endorsement transactions.',
            },
        };
    }

    // Pull recipient + reasonCode from the canonical workspace snapshot.
    const policy = await tenantScopedPrisma.policy.findUnique({
        where: { id: input.policyId },
        select: { id: true, policyNumber: true, quoteData: true, policyHolderId: true, publicSessionToken: true },
    });
    if (!policy) {
        return {
            ok: false,
            status: 'error',
            summary: 'Policy disappeared mid-call.',
            error: { code: 'NOT_FOUND', message: 'Policy not found.' },
        };
    }
    const holder = policy.policyHolderId
        ? await tenantScopedPrisma.policyHolder.findUnique({
              where: { id: policy.policyHolderId },
              select: { name: true, contact: true },
          })
        : null;
    const qd = parseRecord(policy.quoteData);
    const proposer = parseRecord(qd.proposer);
    const email = String(holder?.contact || proposer.email || '').trim();
    if (!email || !email.includes('@')) {
        return {
            ok: false,
            status: 'error',
            summary: 'No customer email on file for this policy.',
            error: {
                code: 'MISSING_EMAIL',
                message: 'Cannot send endorsement data capture link without a customer email.',
            },
        };
    }
    const firstName =
        String(holder?.name || '').trim().split(/\s+/)[0]
        || String(proposer.firstName || '').trim()
        || 'Customer';

    let reasonCode = '';
    try {
        const draftSnap = parseRecord(
            typeof rt.snapshotDraft === 'string' ? JSON.parse(rt.snapshotDraft) : rt.snapshotDraft,
        );
        const ws = parseRecord(draftSnap.endorsementWorkspace);
        reasonCode = String(ws.reasonCode || '').toUpperCase();
    } catch {
        reasonCode = '';
    }
    const changeType = READABLE_REASONS[reasonCode] || 'policy update';

    // Capture URL points at the BO endorsement workspace via the
    // existing publicSessionToken — the same route the customer uses
    // for wizard sessions, deep-linked to the endorsement form. The
    // BO renders / handles the capture UI; V2 only sends the link.
    const tenant = getTenantConfig();
    const baseUrl = tenant.publicBaseUrl.replace(/\/$/, '');
    const captureUrl = `${baseUrl}/endorsement/${policy.publicSessionToken || policy.id}/${rt.id}?reason=${reasonCode.toLowerCase()}`;

    const idempotencySeed = crypto
        .createHash('sha256')
        .update(`endorsement_capture:${tenant.id}:${email.toLowerCase()}:${rt.id}`)
        .digest('hex');

    try {
        await dispatchCustomerEmailTrigger({
            trigger: 'ENDORSEMENT_DATA_CAPTURE_REQUESTED',
            entityType: 'POLICY',
            entityId: input.policyId,
            toEmail: email,
            fromActor: ctx.userId,
            variables: {
                customer: { firstName },
                policy: { number: policy.policyNumber },
                endorsement: { captureUrl, changeType },
            },
            idempotencySeed,
        });
    } catch (err) {
        logger.warn(
            { err, policyId: input.policyId, riskTransactionId: rt.id },
            'operator.send_endorsement_link.email_failed',
        );
        return {
            ok: false,
            status: 'error',
            summary: 'Endorsement draft exists but the data-capture email failed to send.',
            error: {
                code: 'EMAIL_SEND_FAILED',
                message: err instanceof Error ? err.message : 'Email dispatch error.',
            },
        };
    }

    await AuditLogger.log(
        input.policyId,
        'OPERATOR_ACTION',
        'OPERATOR.ENDORSEMENT_LINK_SENT',
        ctx.userId,
        'SYSTEM',
        {
            policyId: input.policyId,
            riskTransactionId: rt.id,
            transactionNumber: rt.transactionNumber,
            recipient: email,
            captureUrl,
            reasonCode,
            correlationId: gate.action.correlationId,
            source: 'operator-mcp-v2',
        },
        'Operator Agent',
    );

    const envelope: OperatorSuccessEnvelope<{ capture_url: string; recipient: string }> = {
        ok: true,
        status: 'completed',
        action_id: gate.action.actionId,
        correlation_id: gate.action.correlationId,
        summary: `Sent ${changeType} data capture link to ${email}.`,
        entities: { policyId: input.policyId, riskTransactionId: rt.id },
        next_actions: ['operator.submit_endorsement_for_review'],
        extra: { capture_url: captureUrl, recipient: email },
    };
    return envelope;
}

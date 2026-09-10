/**
 * Operator MCP V2 — `operator.preview_quote_send` (ADR-0039).
 *
 * RETURNS a `confirmation_token` (10-minute TTL) the agent must
 * supply to `operator.send_revised_quote`. Computes:
 *   - diff between current quoteResponse pricing and the latest
 *     archived history version (so the operator can see what changed),
 *   - premium delta (old vs new),
 *   - issue-readiness blockers (so the operator never confirms a send
 *     that would fail mid-flight).
 *
 * `auditClass: 'mutate'` (and not 'mutate-staging') because issuing
 * the confirmation token is the customer-impacting commit point — the
 * operator confirming this preview is what authorises the actual
 * customer email.
 *
 * Pinned by the preview-required guard: this file references
 * `confirmation_token` (returned in the envelope) so the static check
 * passes.
 */
import type { McpContext } from '../../mcp/domain/mcpContext.js';
import type {
    OperatorEnvelope,
    OperatorPreviewEnvelope,
    OperatorDiffEntry,
    OperatorReadinessBlocker,
} from '../domain/operatorEnvelope.js';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import { evaluateIssueReadiness } from '../../policy/domain/issueReadiness.js';
import { AuditLogger } from '../../../platform/audit/logger.js';
import {
    issueConfirmationToken,
    hashPreviewInput,
} from '../../mcp/infra/confirmationTokenStore.js';
import { loadPolicyOrError, requireMutatePermission } from './operatorMutateGuards.js';
import { parseRecord } from '../../../platform/json/parseRecord.js';

const PREVIEW_TTL_SECONDS = 600;
const PREVIEW_TOOL_NAME = 'operator.preview_quote_send';

export interface OperatorPreviewQuoteSendInput {
    policyId: string;
}

export type OperatorPreviewQuoteSendOutput = OperatorEnvelope<Record<string, unknown>> | OperatorPreviewEnvelope;

function extractPremium(quoteResponse: unknown): { premium: number | null; currency: string | null } {
    const qr = parseRecord(quoteResponse);
    const opt = parseRecord(qr.primaryOption || qr.primary_option);
    const premiumRaw = opt.annualPremium ?? opt.annual_premium ?? qr.annualPremium ?? null;
    const currencyRaw =
        (typeof opt.currency === 'string' ? opt.currency : undefined) ??
        (typeof qr.currency === 'string' ? qr.currency : undefined) ??
        null;
    const premium = typeof premiumRaw === 'number' && Number.isFinite(premiumRaw) ? premiumRaw : null;
    return { premium, currency: currencyRaw || null };
}

export async function operatorPreviewQuoteSend(
    input: OperatorPreviewQuoteSendInput,
    ctx: McpContext,
): Promise<OperatorPreviewQuoteSendOutput> {
    const gate = requireMutatePermission(ctx);
    if (!gate.ok) return gate.envelope;
    const policyGate = await loadPolicyOrError(input.policyId);
    if (!policyGate.ok) return policyGate.envelope;

    const policy = await tenantScopedPrisma.policy.findUnique({
        where: { id: input.policyId },
        select: {
            id: true,
            quoteData: true,
            quoteResponse: true,
            stateCurrent: { select: { snapshot: true } },
            quoteHistory: {
                orderBy: { version: 'desc' },
                take: 1,
                select: { version: true, quoteData: true, quoteResponse: true },
            },
        },
    });
    if (!policy) {
        return {
            ok: false,
            status: 'error',
            summary: 'Policy disappeared during preview.',
            error: { code: 'NOT_FOUND', message: 'Policy not found.' },
        };
    }

    const currQuoteData = parseRecord(policy.quoteData);
    const currQuoteResponse = parseRecord(policy.quoteResponse);
    const prev = policy.quoteHistory[0]
        ? {
              quoteData: parseRecord(policy.quoteHistory[0].quoteData),
              quoteResponse: parseRecord(policy.quoteHistory[0].quoteResponse),
          }
        : null;

    const { premium: newPremium, currency } = extractPremium(currQuoteResponse);
    const { premium: oldPremium } = prev ? extractPremium(prev.quoteResponse) : { premium: null };

    // Top-level field diff is good-enough preview signal; the LLM gets
    // the actual structural diff to render. We deliberately don't deep-diff
    // — the BO operator's mental model is "which of the wizard sections
    // changed", which maps to top-level keys.
    const diff: OperatorDiffEntry[] = prev
        ? Array.from(new Set([...Object.keys(currQuoteData), ...Object.keys(prev.quoteData)]))
              .flatMap((field) => {
                  const before = prev.quoteData[field];
                  const after = currQuoteData[field];
                  if (JSON.stringify(before) === JSON.stringify(after)) return [];
                  return [{ field, from: before ?? null, to: after ?? null }];
              })
        : [];

    // Run the canonical readiness gate. Blockers in this preview mean
    // the operator MUST address them before send_revised_quote will
    // succeed.
    const readiness = await evaluateIssueReadiness(input.policyId, 'bo');
    const readinessBlockers: OperatorReadinessBlocker[] = (readiness.blockers || []).map((b) => ({
        code: String(b.code || 'BLOCKER'),
        message: String(b.message || ''),
    }));

    const previewBody = {
        policyId: input.policyId,
        diff,
        premiumChange:
            oldPremium !== null && newPremium !== null
                ? { old_premium: oldPremium, new_premium: newPremium, delta: newPremium - oldPremium, currency }
                : null,
        readinessBlockers,
    };
    const tokenInputHash = hashPreviewInput({
        policyId: input.policyId,
        diff,
        premiumNew: newPremium,
        premiumOld: oldPremium,
        actorId: ctx.userId,
    });
    const issued = await issueConfirmationToken(
        {
            actorId: ctx.userId,
            toolName: 'operator.send_revised_quote',
            entityId: input.policyId,
            inputHash: tokenInputHash,
            issuedAt: new Date().toISOString(),
            preview: previewBody,
        },
        PREVIEW_TTL_SECONDS,
    );

    void AuditLogger.log(
        input.policyId,
        'OPERATOR_ACTION',
        'OPERATOR.QUOTE_PREVIEW_GENERATED',
        ctx.userId,
        'SYSTEM',
        {
            policyId: input.policyId,
            previewTool: PREVIEW_TOOL_NAME,
            tokenHash: tokenInputHash,
            diffCount: diff.length,
            readinessBlockerCount: readinessBlockers.length,
            correlationId: gate.action.correlationId,
            source: 'operator-mcp-v2',
        },
        'Operator Agent',
    );

    const envelope: OperatorPreviewEnvelope = {
        ok: true,
        status: 'preview',
        action_id: gate.action.actionId,
        correlation_id: gate.action.correlationId,
        summary:
            readinessBlockers.length > 0
                ? `Preview ready with ${readinessBlockers.length} readiness blocker(s) — fix before confirming send.`
                : `Preview ready. ${diff.length} field change(s)${
                      previewBody.premiumChange
                          ? `; premium ${currency || ''} ${(previewBody.premiumChange.delta >= 0 ? '+' : '')}${previewBody.premiumChange.delta.toFixed(2)}`
                          : ''
                  }.`,
        requires_confirmation: true,
        confirmation_token: issued.token,
        expires_at: issued.expiresAt,
        entities: { policyId: input.policyId },
        diff,
        premium_change: previewBody.premiumChange ?? undefined,
        readiness_blockers: readinessBlockers,
        preview_extra: { source: 'operator-mcp-v2' },
    };
    return envelope;
}

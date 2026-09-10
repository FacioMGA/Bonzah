/**
 * Operator MCP V2 — `operator.rate_quote` (ADR-0039).
 *
 * Runs the canonical rate pipeline (`ratePolicyAndPersist`) via the
 * `rateQuoteUseCase` dispatcher. Persists fresh `quoteResponse` +
 * `pricing` snapshot. The next step is `operator.preview_quote_send`
 * which returns the confirmation token.
 *
 * `auditClass: 'mutate-staging'` — the rate write is idempotent and
 * does not reach the customer. Customer-impacting commit is
 * `operator.send_revised_quote`.
 */
import type { McpContext } from '../../mcp/domain/mcpContext.js';
import type { OperatorEnvelope, OperatorSuccessEnvelope } from '../domain/operatorEnvelope.js';
import { rateQuoteUseCase } from '../../policy/app/quoteLifecycle/rateQuoteUseCase.js';
import { loadPolicyOrError, requireMutatePermission } from './operatorMutateGuards.js';

export interface OperatorRateQuoteInput {
    policyId: string;
}

export type OperatorRateQuoteOutput = OperatorEnvelope<{
    rating_status: 'QUOTED' | 'REFERRAL' | 'DECLINED';
    premium_total: number | null;
    currency: string | null;
}>;

function extractPremium(quoteResponse: Record<string, unknown>): { premium: number | null; currency: string | null } {
    const opt = (quoteResponse?.['primaryOption'] || quoteResponse?.['primary_option']) as
        | Record<string, unknown>
        | undefined;
    const premiumRaw =
        opt?.['annualPremium'] ??
        opt?.['annual_premium'] ??
        quoteResponse?.['annualPremium'] ??
        null;
    const currencyRaw =
        (opt?.['currency'] as string | undefined) ?? (quoteResponse?.['currency'] as string | undefined) ?? null;
    const premium = typeof premiumRaw === 'number' && Number.isFinite(premiumRaw) ? premiumRaw : null;
    return { premium, currency: currencyRaw || null };
}

export async function operatorRateQuote(
    input: OperatorRateQuoteInput,
    ctx: McpContext,
): Promise<OperatorRateQuoteOutput> {
    const gate = requireMutatePermission(ctx);
    if (!gate.ok) return gate.envelope;
    const policyGate = await loadPolicyOrError(input.policyId);
    if (!policyGate.ok) return policyGate.envelope;

    const result = await rateQuoteUseCase({
        policyId: input.policyId,
        actor: { id: ctx.userId, role: 'OPERATOR_AGENT', name: 'Operator Agent' },
        correlationId: gate.action.correlationId,
    });
    if (!result.ok) {
        return {
            ok: false,
            status: 'error',
            summary: result.message,
            error: { code: result.code, message: result.message },
        };
    }

    const { premium, currency } = extractPremium(result.quoteResponse);
    const envelope: OperatorSuccessEnvelope<{
        rating_status: 'QUOTED' | 'REFERRAL' | 'DECLINED';
        premium_total: number | null;
        currency: string | null;
    }> = {
        ok: true,
        status: 'completed',
        action_id: gate.action.actionId,
        correlation_id: gate.action.correlationId,
        summary:
            result.status === 'QUOTED'
                ? `Re-rated quote ${input.policyId}; premium ${currency || ''} ${premium ?? '(n/a)'}.`
                : `Re-rated quote ${input.policyId}; outcome: ${result.status}.`,
        entities: { policyId: input.policyId },
        next_actions: ['operator.preview_quote_send', 'operator.save_quote_revision'],
        extra: {
            rating_status: result.status,
            premium_total: premium,
            currency,
        },
    };
    return envelope;
}

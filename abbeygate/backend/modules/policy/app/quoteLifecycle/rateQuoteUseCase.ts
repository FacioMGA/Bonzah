/**
 * Canonical re-rate dispatcher used by operator MCP V2's
 * `operator.rate_quote` tool (ADR-0039).
 *
 * `ratePolicyAndPersist` in [`backend/modules/quotes/app/quoteRateService.ts`](../../../quotes/app/quoteRateService.ts)
 * is already the canonical "rate this policy and persist the fresh
 * quoteResponse" spine — it's product-agnostic and used by the public
 * quote router + the CardCorp checkout path today. This module is a
 * thin lookup-then-delegate: load `productType` from the policy and
 * call the existing canonical service. No new write paths.
 *
 * On success the policy's `quoteResponse`, `policyStateCurrent.snapshot.pricing`
 * and `policyStateCurrent.snapshot.coverageSelection` are all freshly
 * persisted — exactly what the BO "Premium → Recalculate" button does
 * via the public re-rate route.
 */
import { tenantScopedPrisma } from '../../../../platform/db/connection.js';
import { AuditLogger } from '../../../../platform/audit/logger.js';
import {
    ratePolicyAndPersist,
    type RatePolicyResult,
} from '../../../quotes/app/quoteRateService.js';

export interface RateQuoteUseCaseActor {
    id: string;
    role: 'OPERATOR_AGENT' | 'UNDERWRITER' | 'SYSTEM';
    name?: string;
}

export interface RateQuoteUseCaseInput {
    policyId: string;
    actor: RateQuoteUseCaseActor;
    correlationId?: string;
}

export type RateQuoteUseCaseResult =
    | {
          ok: true;
          policyId: string;
          status: 'QUOTED' | 'REFERRAL' | 'DECLINED';
          quoteResponse: Record<string, unknown>;
          underwritingAnalysis: Record<string, unknown> | null;
      }
    | {
          ok: false;
          code: 'NOT_FOUND' | 'NO_ADAPTER' | 'INVALID_QUOTE' | 'INTERNAL_ERROR';
          message: string;
          details?: Record<string, unknown>;
      };

type RateErrCode = 'NOT_FOUND' | 'NO_ADAPTER' | 'INVALID_QUOTE' | 'INTERNAL_ERROR';

function mapErr(err: Extract<RatePolicyResult, { ok: false }>): RateQuoteUseCaseResult {
    const codeMap: Record<string, RateErrCode> = {
        POLICY_NOT_FOUND: 'NOT_FOUND',
        NO_ADAPTER: 'NO_ADAPTER',
        INVALID_QUOTE: 'INVALID_QUOTE',
    };
    const mapped: RateErrCode = codeMap[err.code] ?? 'INTERNAL_ERROR';
    return { ok: false, code: mapped, message: err.message, details: err.details };
}

export async function rateQuoteUseCase(
    input: RateQuoteUseCaseInput,
): Promise<RateQuoteUseCaseResult> {
    const policy = await tenantScopedPrisma.policy.findUnique({
        where: { id: input.policyId },
        select: { id: true, productType: true },
    });
    if (!policy) {
        return { ok: false, code: 'NOT_FOUND', message: `Policy "${input.policyId}" not found.` };
    }
    const productType = String(policy.productType || '').toUpperCase();
    if (!productType) {
        return { ok: false, code: 'INTERNAL_ERROR', message: 'Policy has no productType.' };
    }

    const result = await ratePolicyAndPersist({ policyId: input.policyId, productType });
    if (!result.ok) {
        return mapErr(result);
    }

    await AuditLogger.log(
        input.policyId,
        'OPERATOR_ACTION',
        'OPERATOR.QUOTE_RERATED',
        input.actor.id,
        input.actor.role === 'SYSTEM' ? 'SYSTEM' : 'USER',
        {
            policyId: input.policyId,
            productType,
            status: result.status,
            correlationId: input.correlationId,
            source: input.actor.role === 'OPERATOR_AGENT' ? 'operator-mcp-v2' : 'bo',
        },
        input.actor.name,
    );

    return {
        ok: true,
        policyId: input.policyId,
        status: result.status,
        quoteResponse: result.quoteResponse,
        underwritingAnalysis: result.underwritingAnalysis,
    };
}

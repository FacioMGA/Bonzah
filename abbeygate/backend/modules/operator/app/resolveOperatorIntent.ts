/**
 * Shared disambiguation helper used by every Operator MCP tool that
 * accepts free-text entity names (spec §2A).
 *
 * Rule: if more than one candidate matches, NEVER act — return the
 * disambiguation envelope so the operator (or the LLM, with operator
 * confirmation) picks the right entity. This is the entire mechanism
 * that keeps "send John Doe a wizard link" from going to the wrong
 * John Doe.
 */
import type {
    OperatorCandidate,
    OperatorDisambiguationEnvelope,
} from '../domain/operatorEnvelope.js';
import {
    maskEmail,
} from '../domain/operatorEnvelope.js';
import {
    searchPolicyHoldersByText,
    type PolicyHolderSummary,
} from '../infra/adapters/policyHolderAdapter.js';

export type ResolveResult<T> =
    | { kind: 'unique'; value: T }
    | { kind: 'none' }
    | { kind: 'ambiguous'; envelope: OperatorDisambiguationEnvelope };

/**
 * Resolve a free-text customer query to a single PolicyHolder.
 * - exactly one match → 'unique'
 * - zero matches      → 'none'
 * - 2+ matches        → 'ambiguous' with disambiguation envelope ready to return
 *
 * The disambiguation envelope's `candidates[]` items always set
 * `kind: 'customer'`, `id: policyHolderId`, and a masked email when
 * available.
 */
export async function resolveCustomerFromText(args: {
    q: string;
    limit?: number;
    summary?: string;
}): Promise<ResolveResult<PolicyHolderSummary>> {
    const candidates = await searchPolicyHoldersByText({ q: args.q, limit: args.limit ?? 10 });
    if (candidates.length === 0) return { kind: 'none' };
    if (candidates.length === 1) return { kind: 'unique', value: candidates[0] };
    const envelopeCandidates: OperatorCandidate[] = candidates.map((c) => ({
        id: c.id,
        kind: 'customer',
        label: c.name,
        emailMasked: maskEmail(c.contact),
        annotations: { active_policies: c.activePolicyCount },
    }));
    return {
        kind: 'ambiguous',
        envelope: {
            ok: false,
            status: 'needs_disambiguation',
            summary:
                args.summary ??
                `Found ${candidates.length} matching customers for "${args.q}". Please choose one.`,
            candidates: envelopeCandidates,
        },
    };
}

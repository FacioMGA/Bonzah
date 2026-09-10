import type { OperatorEnvelope, OperatorSuccessEnvelope } from '../domain/operatorEnvelope.js';
import { extractEmailFromContact, maskEmail } from '../domain/operatorEnvelope.js';
import { buildOperatorActionContext } from '../domain/operatorContext.js';
import type { McpContext } from '../../mcp/domain/mcpContext.js';
import {
    findPolicyHolderById,
} from '../infra/adapters/policyHolderAdapter.js';
import {
    getAccountContextBundle,
    type AccountContextBundle,
} from '../infra/adapters/accounts360Adapter.js';
import { resolveCustomerFromText } from './resolveOperatorIntent.js';

export interface GetCustomerContextInput {
    /** Direct PolicyHolder id (preferred). */
    policyHolderId?: string;
    /** Free-text query (name / email substring) — used when id is omitted. */
    q?: string;
}

export type GetCustomerContextOutput = OperatorEnvelope<{
    /**
     * Only `emailMasked` is exposed on the LLM-visible envelope.
     * The raw `PolicyHolder.contact` column stores a JSON blob with
     * DOB / NIF / passport / address / phone — never surface it.
     */
    customer: { id: string; name: string; emailMasked: string | undefined; active_policy_count: number };
    bundle: AccountContextBundle;
}>;

function scrubBundleSecondaryIdentity(bundle: AccountContextBundle): AccountContextBundle {
    // `summary` is typed `unknown` (the projection shape is owned by
    // accounts360, not this module). Defensive narrow before mutating.
    if (!bundle.summary || typeof bundle.summary !== 'object') return bundle;
    const summary = bundle.summary as Record<string, unknown>;
    const raw = summary.secondaryIdentity;
    if (typeof raw !== 'string') return bundle;
    const masked = maskEmail(raw);
    if (masked === raw) return bundle;
    return {
        ...bundle,
        summary: { ...summary, secondaryIdentity: masked ?? null },
    };
}

export async function getCustomerContext(
    input: GetCustomerContextInput,
    ctx: McpContext,
): Promise<GetCustomerContextOutput> {
    const action = buildOperatorActionContext(ctx);
    let policyHolderId = String(input.policyHolderId || '').trim();
    let customer = policyHolderId ? await findPolicyHolderById(policyHolderId) : null;

    if (!customer) {
        const q = String(input.q || '').trim();
        if (!q) {
            return {
                ok: false,
                status: 'missing_required_fields',
                summary: 'Either policyHolderId or q is required.',
                required_fields: ['policyHolderId | q'],
            };
        }
        const resolved = await resolveCustomerFromText({ q });
        if (resolved.kind === 'none') {
            return { ok: false, status: 'error', summary: `No customer matched "${q}".`, error: { code: 'NO_MATCH', message: 'No matching customer.' } };
        }
        if (resolved.kind === 'ambiguous') return resolved.envelope;
        customer = resolved.value;
        policyHolderId = customer.id;
    }

    const rawBundle = await getAccountContextBundle({ policyHolderId });
    const bundle = scrubBundleSecondaryIdentity(rawBundle);
    const envelope: OperatorSuccessEnvelope<{
        customer: { id: string; name: string; emailMasked: string | undefined; active_policy_count: number };
        bundle: AccountContextBundle;
    }> = {
        ok: true,
        status: 'completed',
        action_id: action.actionId,
        correlation_id: action.correlationId,
        summary: `Loaded context for ${customer.name}.`,
        entities: { policyHolderId: customer.id },
        next_actions: ['operator.search_quotes', 'operator.search_policies'],
        extra: {
            customer: {
                id: customer.id,
                name: customer.name,
                // PolicyHolder.contact is a JSON blob with DOB / NIF /
                // passport / phone / address — extract the email and
                // mask it; surface nothing else (PII fail-closed; see
                // ADR-0036 amendment #2 + the 2026-05-28 leak post-mortem).
                emailMasked: maskEmail(extractEmailFromContact(customer.contact)),
                active_policy_count: customer.activePolicyCount,
            },
            bundle,
        },
    };
    return envelope;
}

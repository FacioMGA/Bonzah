/**
 * Standard envelope shape returned by every `operator.*` tool
 * (ADR-0036 amendment #2 §5; spec §5).
 *
 * Lives inside the MCP `CallToolResult.structuredContent` payload so
 * the LLM and downstream BO surfaces both see a uniform shape. The
 * text content of the MCP result is a JSON.stringify of the envelope,
 * which most modern agents render natively.
 *
 * Variants:
 *   - `OperatorSuccessEnvelope` — `ok: true`, includes entities + audit ids
 *   - `OperatorDisambiguationEnvelope` — `ok: false, status: 'needs_disambiguation'`
 *   - `OperatorMissingFieldsEnvelope` — `ok: false, status: 'missing_required_fields'`
 *
 * Tools that need a preview→confirm pattern (Operator MCP V2) will
 * add `OperatorPreviewEnvelope` with `confirmation_token`.
 */

export interface OperatorEntitiesRef {
    /** Canonical BO "customer" id = PolicyHolder.id (see accounts-intelligence-api.md). */
    policyHolderId?: string;
    accountId?: string;
    policyId?: string;
    quoteId?: string;
    claimId?: string;
    [key: string]: string | undefined;
}

export interface OperatorSuccessEnvelope<TExtra = Record<string, unknown>> {
    ok: true;
    status: 'completed';
    action_id: string;
    correlation_id: string;
    summary: string;
    entities: OperatorEntitiesRef;
    audit_log_id?: string;
    next_actions: string[];
    extra?: TExtra;
}

export interface OperatorCandidate {
    /** PolicyHolder / Policy / Claim id (whichever the tool resolved over). */
    id: string;
    kind: 'customer' | 'quote' | 'policy' | 'claim';
    /** Display name shown to the operator. */
    label: string;
    /** Optional masked PII the LLM can use to confirm disambiguation. */
    emailMasked?: string;
    productType?: string;
    status?: string;
    /** Optional richer context the LLM may surface (active policies count, etc.). */
    annotations?: Record<string, string | number | boolean | null>;
}

export interface OperatorDisambiguationEnvelope {
    ok: false;
    status: 'needs_disambiguation';
    summary: string;
    candidates: OperatorCandidate[];
}

export interface OperatorMissingFieldsEnvelope {
    ok: false;
    status: 'missing_required_fields';
    summary: string;
    required_fields: string[];
}

export interface OperatorErrorEnvelope {
    ok: false;
    status: 'error';
    summary: string;
    error: { code: string; message: string; suggested_fix?: string };
}

/**
 * Preview envelope returned by every operator MCP V2 mutate tool that
 * needs explicit operator confirmation before commit (ADR-0039 / ADR-0036
 * amendment #3). The matching commit tool requires the
 * `confirmation_token` returned here; tokens are single-use and expire
 * after 10 minutes (`backend/modules/mcp/infra/confirmationTokenStore.ts`).
 */
export interface OperatorDiffEntry {
    field: string;
    from: unknown;
    to: unknown;
}

export interface OperatorPremiumChange {
    old_premium: number;
    new_premium: number;
    delta: number;
    currency?: string | null;
}

export interface OperatorReadinessBlocker {
    code: string;
    message: string;
}

export interface OperatorPreviewEnvelope {
    ok: true;
    status: 'preview';
    action_id: string;
    correlation_id: string;
    summary: string;
    requires_confirmation: true;
    confirmation_token: string;
    /** ISO timestamp; matches the Redis TTL. */
    expires_at: string;
    entities: OperatorEntitiesRef;
    diff: OperatorDiffEntry[];
    premium_change?: OperatorPremiumChange;
    readiness_blockers: OperatorReadinessBlocker[];
    /** Optional structured payload the commit tool will replay. */
    preview_extra?: Record<string, unknown>;
}

export type OperatorEnvelope<TExtra = Record<string, unknown>> =
    | OperatorSuccessEnvelope<TExtra>
    | OperatorPreviewEnvelope
    | OperatorDisambiguationEnvelope
    | OperatorMissingFieldsEnvelope
    | OperatorErrorEnvelope;

/** Mask an email for safe inclusion in disambiguation responses. */
/**
 * RFC-ish email shape — strict-enough that JSON blobs, comma-separated
 * lists, and other garbage are rejected before any masking happens.
 * Used as the fail-closed guard in `maskEmail` after a 2026-05-28
 * incident where `PolicyHolder.contact` rows carrying a JSON-stringified
 * contact object ({"email":"…","phone":"…","idnumber":"…"}) were being
 * fed verbatim into `maskEmail`, which masked the leading characters
 * and leaked passport numbers, DOBs, and phones in the trailing JSON.
 */
const STRICT_EMAIL_RE = /^[a-z0-9._+%-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

export function maskEmail(value: string | null | undefined): string | undefined {
    const trimmed = String(value || '').trim().toLowerCase();
    if (!STRICT_EMAIL_RE.test(trimmed)) return undefined;
    const [local, domain] = trimmed.split('@');
    if (!local || !domain) return undefined;
    const visible = local.length <= 2 ? local[0] : local.slice(0, 2);
    return `${visible}${'*'.repeat(Math.max(local.length - visible.length, 1))}@${domain}`;
}

/**
 * Best-effort email extraction from the `PolicyHolder.contact` column,
 * which historically stores EITHER a bare email OR a JSON blob like
 * `{"email":"…","phone":"…","addressline":"…","idnumber":"…"}`. Returns
 * null when no plausible email is found — callers MUST treat null as
 * "no contact available" rather than fall back to the raw blob.
 *
 * Tightly scoped to the operator MCP exposure path. The canonical
 * PolicyHolder model is the source of truth; this is a transport-layer
 * adapter to keep PII out of LLM-visible envelopes.
 */
export function extractEmailFromContact(contact: string | null | undefined): string | null {
    const raw = String(contact || '').trim();
    if (!raw) return null;
    // Fast path: raw is already an email.
    if (STRICT_EMAIL_RE.test(raw.toLowerCase())) return raw.toLowerCase();
    // JSON-blob path: try parse, look for an email-shaped property.
    if (raw.startsWith('{')) {
        try {
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            const candidate = parsed.email ?? parsed.Email ?? parsed.contactEmail ?? null;
            if (typeof candidate === 'string' && STRICT_EMAIL_RE.test(candidate.toLowerCase())) {
                return candidate.toLowerCase();
            }
        } catch {
            /* fall through to regex */
        }
    }
    // Last-resort regex: pull the first email-shaped substring out.
    // Caps PII bleed even when the JSON parse fails.
    const match = raw.toLowerCase().match(/[a-z0-9._+%-]+@[a-z0-9.-]+\.[a-z]{2,}/);
    return match ? match[0] : null;
}

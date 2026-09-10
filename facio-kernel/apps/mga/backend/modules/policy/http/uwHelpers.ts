/**
 * Shared helpers and Zod schemas for UW route handlers.
 * CHAMPS: Extracted from uwRouter.ts god-file decomposition.
 */
import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import type { ApiResponse } from '../../../platform/types/index.js';
// AuditLogger is imported by consumers (uwFollowUpRouter.ts) directly
import { newPublicSessionToken } from '../app/shared.js';
import { logger } from '../../../platform/utils/logger.js';
import { resolvePublicAppBaseUrlFromRequest } from '../../../platform/http/publicAppLinks.js';
import { deepMergePlain as canonicalDeepMergePlain } from '../../../shared/lib/deepMerge.js';
import { parseRecord } from '../../../platform/json/parseRecord.js';
export { parseRecord };
export { errorMessage } from '../../../platform/http/httpErrors.js';

// ─── Zod Schemas ──────────────────────────────────────────────────
export const RecordSchema = z.record(z.string(), z.unknown());

/**
 * Canonical travel proposer key set.
 *
 * Travel's canonical shape stores proposer details under nested
 * `proposer.*`. The Phase 2.5 cutover deleted the `travelCanonicalShape`
 * preprocess that lifted root-level legacy aliases — after the
 * `20260427153132_canonicalize_travel_proposer` migration, no Travel
 * policy carries these at the root, and the HTTP boundary rejects any
 * patch that tries to reintroduce them.
 *
 * Motor's canonical shape is root-level (`firstName`, `email`, …) by
 * design, so its rows are unaffected.
 */
export const FollowUpSchema = z.object({
    id: z.string().optional(),
    fieldKey: z.string().optional(),
    question: z.string().optional(),
    questionLabel: z.string().optional(),
    note: z.string().optional(),
    type: z.string().optional(),
    stepKey: z.string().optional(),
    requestedAt: z.string().optional(),
});
export const SendQuestionnaireBodySchema = z.object({
    questionnaireId: z.string().optional(),
    kind: z.enum(['initial', 'resend']).optional(),
});
export const RequestInfoBodySchema = z.object({
    message: z.string().optional(),
    requestedStep: z.string().optional(),
});
export const UwFormBodySchema = z.record(z.string(), z.unknown());
export const FollowUpBatchBodySchema = z.object({
    requests: z.array(FollowUpSchema),
});

// ─── Type ─────────────────────────────────────────────────────────
export type ErrorBody = ApiResponse<null>;

// ─── Pure Helpers ─────────────────────────────────────────────────

/**
 * Re-export the canonical `deepMergePlain` so existing call sites keep
 * working. The implementation lives at `backend/shared/lib/deepMerge.ts`
 * and is mirrored byte-for-byte by `frontend/src/shared/lib/deepMerge.ts`.
 *
 * Travel/home/motor questionnaire payloads nest data under top-level keys
 * (`trip`, `proposer`, `declarations`, ...). A shallow `{ ...base, ...patch }`
 * atomically replaces those nested objects when `patch` only carries the
 * touched leaf — silently dropping sibling fields. The shared helper
 * preserves siblings; arrays and primitives are still replaced atomically.
 */
export const deepMergePlain = canonicalDeepMergePlain;

export function sendError(res: Pick<Response, 'status' | 'json'>, status: number, code: string, message: string) {
    const body: ErrorBody = {
        success: false,
        error: { code, message },
    };
    return res.status(status).json(body);
}

export function actorFromRequest(req: { user?: Express.UserTokenPayload }) {
    const u = req.user;
    return {
        id: u?.userId || u?.id || '',
        email: u?.email || '',
        name: u?.name || '',
        role: u?.role || '',
        tenantId: u?.tenantId || '',
    };
}

export function getMethod(target: unknown, methodName: string): ((...args: unknown[]) => unknown) | null {
    const t = parseRecord(target);
    return typeof t[methodName] === 'function' ? (t[methodName] as (...args: unknown[]) => unknown) : null;
}

export function getBaseUrl(req: Pick<Request, 'headers' | 'protocol' | 'get'>): string {
    return resolvePublicAppBaseUrlFromRequest(req);
}

export function readContactEmail(policy: unknown): { email: string; contactName: string } {
    const p = parseRecord(policy);
    const holder = parseRecord(p.policyHolder);
    const quoteData = parseRecord(p.quoteData);
    const proposer = parseRecord(quoteData.proposer);

    let email = '';
    let contactName = String(holder.name || '') || String(proposer.firstName || '');

    try {
        const contactRaw = holder.contact;
        const contact = typeof contactRaw === 'string' ? parseRecord(JSON.parse(contactRaw)) : parseRecord(contactRaw);
        email = String(contact.email || '').trim();
        if (!contactName && contact.firstName) contactName = String(contact.firstName);
    } catch { /* skip */ }

    if (!email) email = String(proposer.email || '').trim();
    if (!email) email = String(holder.email || '').trim();

    if (!contactName) {
        const fn = String(proposer.firstName || '').trim();
        const ln = String(proposer.lastName || '').trim();
        contactName = [fn, ln].filter(Boolean).join(' ') || 'Customer';
    }

    return { email, contactName };
}

export function normalizeEmail(input: unknown): string {
    return String(input || '').trim().toLowerCase();
}

export async function ensureVerifiedContactEmail(
    policy: unknown,
    res: Pick<Response, 'status' | 'json'>,
    options?: { requireVerified?: boolean }
): Promise<{ ok: true; email: string; contactName: string } | { ok: false }> {
    const { email, contactName } = readContactEmail(policy);
    if (!email) {
        sendError(res, 400, 'MISSING_CONTACT', 'No contact email found');
        return { ok: false };
    }

    if (options?.requireVerified) {
        const holder = parseRecord(parseRecord(policy).policyHolder);
        const isVerified = holder.emailVerified === true || holder.isEmailVerified === true;
        if (!isVerified) {
            sendError(res, 403, 'EMAIL_NOT_VERIFIED', 'Contact email has not been verified');
            return { ok: false };
        }
    }

    return { ok: true, email, contactName };
}

export async function ensurePolicyPublicSessionToken(policyId: string, existing?: string | null): Promise<string> {
    if (existing) return existing;
    const token = newPublicSessionToken();
    await tenantScopedPrisma.policy.update({ where: { id: policyId }, data: { publicSessionToken: token } });
    return token;
}

export function parseSnapshotMaybe(v: unknown): Record<string, unknown> {
    if (!v) return {};
    if (typeof v === 'object') return parseRecord(v);
    if (typeof v === 'string') {
        try { return parseRecord(JSON.parse(v)); } catch { return {}; }
    }
    return {};
}

export function normalizeStepKey(v: unknown) {
    const s = String(v || '').trim();
    if (!s || s === 'undefined' || s === 'null') return undefined;
    return s;
}

/** First public wizard step when a follow-up has no stepKey. Never default to a motor-only step. */
export function defaultCustomerQuoteStep(productType: unknown): string {
    const code = String(productType || '').trim().toUpperCase();
    if (code === 'TRAVEL' || code === 'HEALTH') return 'eligibility';
    if (code === 'BUSINESS') return 'proposer';
    if (code === 'OPEN_MARKET') return 'intake';
    return 'policy-holder';
}

export function mapFollowUpsForQuoteData(raw: unknown[]): Array<{
    id: string;
    fieldKey: string;
    question: string;
    note: string;
    type: string;
    stepKey?: string;
    requestedAt?: string;
}> {
    return raw
        .map((item) => {
            const r = parseRecord(item);
            const fieldKey = String(r.fieldKey || '').trim();
            const question = String(r.question || r.questionLabel || '').trim();
            if (!fieldKey && !question) return null;
            return {
                id: String(r.id || crypto.randomUUID()),
                fieldKey,
                question,
                note: String(r.note || question || '').trim(),
                type: String(r.type || 'text').trim(),
                stepKey: r.stepKey ? String(r.stepKey).trim() : undefined,
                requestedAt: r.requestedAt ? String(r.requestedAt) : new Date().toISOString(),
            };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
}

export function policyAuditLog(req: Request, _res: Response, next: NextFunction): void {
    const actor = actorFromRequest(req);
    const { id } = req.params;
    if (id) {
        logger.info(
            { policyId: id, actor: actor.id || 'anon', method: req.method, path: req.path },
            'UW route access'
        );
    }
    next();
}

/**
 * Policy email orchestration: welcome emails, endorsement emails,
 * lifecycle promotion, PDF attachment resolution.
 *
 * Extracted from the god-file `queue.ts` during CHAMPS decomposition.
 * These functions are used by the document-generation worker handlers
 * to send customer-facing emails after document packs are generated.
 */

import type { Prisma } from '@prisma/client';
import { runTenantScopedTransaction, tenantScopedPrisma } from '../db/connection.js';
import { storageService } from '../storage/service.js';
import { logger } from '../utils/logger.js';
import {
    buildBackOfficePolicyUrl,
    buildPublicDashboardUrl,
    resolvePublicAppBaseUrlFromTenant,
} from '../http/publicAppLinks.js';
import {
    contactPhoneForCountry,
    getTenantConfig,
    onlinePolicyConfirmationCopyEmailsForCountry,
} from '../tenant/tenantConfig.js';

type UnknownRecord = Record<string, unknown>;
function asRecord(value: unknown): UnknownRecord {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : {};
}

// ─── Storage Helpers ──────────────────────────────────────────────

function extractLocalStorageFilename(storageUri: string): string | null {
    const m = String(storageUri || '').match(/^\/api\/documents\/([^/?#]+)$/);
    return m?.[1] || null;
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
    const chunks: Buffer[] = [];
    return await new Promise((resolve, reject) => {
        stream.on('data', (c: Buffer) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', reject);
    });
}

async function fetchPdfBufferFromStorageUri(storageUri: string): Promise<Buffer | null> {
    const uri = String(storageUri || '').trim();
    if (!uri) return null;
    if (/^https?:\/\//i.test(uri)) {
        const resp = await fetch(uri);
        if (!resp.ok) return null;
        const ab = await resp.arrayBuffer();
        return Buffer.from(ab);
    }
    const localFilename = extractLocalStorageFilename(uri);
    if (!localFilename) return null;
    const stream = await storageService.getFileStream(localFilename);
    if (!stream) return null;
    return await streamToBuffer(stream);
}

// ─── JSON Helpers ─────────────────────────────────────────────────
//
// Layer note (CHAMPS — `lint:layers`): this module lives in `platform/`
// and must not import from `modules/`. Doc-type resolution is therefore
// performed by the callers (workers / module app services), which pass
// the required type arrays in as arguments. The orchestrator stays
// product-agnostic.

function parseRecordJson(value: unknown): Record<string, unknown> {
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return asRecord(parsed);
        } catch {
            return {};
        }
    }
    return asRecord(value);
}

/**
 * Issued-pack email idempotency belongs to the immutable risk transaction.
 * A policy may have several issued transactions (including renewal), so a
 * previous transaction's confirmation must never suppress the next one.
 */
export function welcomeEmailAlreadySentForTransaction(
    welcomeEmail: UnknownRecord,
    riskTransactionId: string | null | undefined,
): boolean {
    const sentAt = String(welcomeEmail.sentAt || '').trim();
    if (!sentAt) return false;
    if (!riskTransactionId) return true;
    return String(welcomeEmail.riskTransactionId || '').trim() === riskTransactionId;
}

/**
 * The issued risk transaction snapshot is the canonical coverage record for
 * its email pack. Reading the mutable policy row can send an inapplicable
 * high-contents notice after a BO edit.
 */
export function quoteDataFromIssuedRiskTransactionSnapshot(snapshotFinal: unknown): UnknownRecord {
    const quoteData = asRecord(parseRecordJson(snapshotFinal).quoteData);
    if (Object.keys(quoteData).length === 0) {
        throw new Error('Issued risk transaction snapshot is missing quoteData');
    }
    return quoteData;
}

// ─── Policy Email Resolution ──────────────────────────────────────

async function resolvePolicyEmailTarget(policyId: string): Promise<{
    toEmail: string;
    contactName: string;
    policyNumber: string;
} | null> {
    const policy = await tenantScopedPrisma.policy.findUnique({
        where: { id: policyId },
        select: {
            id: true,
            policyNumber: true,
            quoteData: true,
            policyHolder: { select: { name: true, contact: true } },
        },
    });
    if (!policy) return null;

    const qd = asRecord(policy.quoteData);
    const proposer = asRecord(qd?.proposer);
    const holder = asRecord(policy.policyHolder);
    const contactRaw = String(holder.contact || '').trim();
    const parsedHolderContact = (() => {
        if (!contactRaw) return {};
        try {
            return asRecord(JSON.parse(contactRaw));
        } catch {
            return {};
        }
    })();
    const primaryContact = asRecord(parsedHolderContact.primary);
    const toEmail =
        String(proposer.email || '').trim() ||
        String(qd?.contactEmail || '').trim() ||
        String(parsedHolderContact.email || '').trim() ||
        String(primaryContact.email || '').trim() ||
        (contactRaw.includes('@') ? contactRaw : '');
    if (!toEmail) return null;

    const contactName =
        [proposer.firstName, proposer.lastName].filter(Boolean).join(' ').trim() ||
        String(holder.name || '').trim() ||
        'there';
    return {
        toEmail,
        contactName,
        policyNumber: String(policy.policyNumber || policyId),
    };
}

// ─── Welcome Email ────────────────────────────────────────────────

function resolveIssuanceProofWelcomeTo(): string {
    const sink = String(process.env.ISSUANCE_PROOF_WELCOME_TO || '').trim();
    if (!sink) {
        throw new Error('ISSUANCE_PROOF_WELCOME_TO is required for issuance-proof welcome email dispatch');
    }
    return sink;
}

async function markWelcomeEmailSent(args: {
    policyId: string;
    riskTransactionId?: string | null;
    toEmail: string;
    dashboardUrl: string;
    policyNumber: string;
    requiredDocTypes: string[];
}): Promise<void> {
    const sentAtIso = new Date().toISOString();
    await runTenantScopedTransaction(async (_tx) => {
      const tx = _tx as unknown as Prisma.TransactionClient;
        const state = await tx.policyStateCurrent.findUnique({
            where: { policyId: args.policyId },
            select: { snapshot: true },
        });
        const snapshot = parseRecordJson(state?.snapshot);
        const issuance = parseRecordJson(snapshot.issuance);
        const nextSnapshot = {
            ...snapshot,
            issuance: {
                ...issuance,
                welcomeEmail: {
                    sentAt: sentAtIso,
                    toEmail: args.toEmail,
                    dashboardUrl: args.dashboardUrl,
                    policyNumber: args.policyNumber,
                    riskTransactionId: args.riskTransactionId || null,
                        requiredDocTypes: [...args.requiredDocTypes],
                    sentBy: 'DOC.GENERATE_ISSUED_POLICY_PACK',
                },
            },
        };
        await tx.policyStateCurrent.upsert({
            where: { policyId: args.policyId },
            update: { snapshot: nextSnapshot },
            create: { policyId: args.policyId, snapshot: nextSnapshot } as unknown as Prisma.PolicyStateCurrentUncheckedCreateInput,
        });
    });
}

async function maybeRecordWelcomeEmailPaymentEvent(args: {
    policyId: string;
    toEmail: string;
    dashboardUrl: string;
}) {
    const payment = await tenantScopedPrisma.payment.findFirst({
        where: { policyId: args.policyId, provider: 'CARDCORP', status: 'PAID' },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
    });
    if (!payment?.id) return;

    const already = await tenantScopedPrisma.paymentEvent.findFirst({
        where: { paymentId: payment.id, eventType: 'WELCOME_EMAIL_SENT' },
        select: { id: true },
    });
    if (already) return;

    await tenantScopedPrisma.paymentEvent.create({
        data: {
            paymentId: payment.id,
            eventType: 'WELCOME_EMAIL_SENT',
            verified: true,
            payload: { toEmail: args.toEmail, dashboardUrl: args.dashboardUrl, via: 'DOC.GENERATE_ISSUED_POLICY_PACK' },
        },
    });
}

async function maybeRecordWelcomeEmailFailurePaymentEvent(args: {
    policyId: string;
    reason: string;
    riskTransactionId?: string | null;
}) {
    const payment = await tenantScopedPrisma.payment.findFirst({
        where: { policyId: args.policyId, provider: 'CARDCORP', status: 'PAID' },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
    });
    if (!payment?.id) return;
    await tenantScopedPrisma.paymentEvent.create({
        data: {
            paymentId: payment.id,
            eventType: 'WELCOME_EMAIL_FAILED',
            verified: true,
            payload: {
                reason: String(args.reason || 'unknown_failure'),
                policyId: args.policyId,
                riskTransactionId: args.riskTransactionId || null,
                via: 'DOC.GENERATE_ISSUED_POLICY_PACK',
            },
        },
    });
}

/**
 * Record a structured paymentEvent when the issued-policy-pack worker
 * handler discovers that required doc types are missing after a
 * generation attempt. After ADR-0013 (canonical issuance spine), the
 * doc-pack enqueue is transactional via the outbox, so an "enqueue
 * failed" failure mode no longer exists from the issuance side. This
 * helper is purely worker-side: it surfaces missing-doc-type failures
 * on the payment view so operators don't have to tail logs to spot a
 * stuck issued pack. Mirrors `maybeRecordWelcomeEmailFailurePaymentEvent`.
 */
/**
 * Issued-pack failure event types written by the worker. Read by
 * `evaluateIssueReadiness` to flip `customerOutcome` to the terminal
 * `'failed'` state (ADR-0017) when the latest such event is newer
 * than the latest GENERATED `ISSUED_POLICY_PACK` document.
 *
 *   - `ISSUED_PACK_MISSING_DOC_TYPES` — generation completed but the
 *     adapter returned without producing every required type.
 *   - `ISSUED_PACK_GENERATION_FAILED` — the adapter call itself threw
 *     (template not found, PDF render error, storage upload failure).
 *     Distinguishing this from a missing-types result lets BO and
 *     analytics tell "we built the wrong pack" from "we never produced
 *     a pack at all".
 */
export type IssuedPackFailureEventType =
    | 'ISSUED_PACK_MISSING_DOC_TYPES'
    | 'ISSUED_PACK_GENERATION_FAILED';

export const ISSUED_PACK_FAILURE_EVENT_TYPES: readonly IssuedPackFailureEventType[] = [
    'ISSUED_PACK_MISSING_DOC_TYPES',
    'ISSUED_PACK_GENERATION_FAILED',
] as const;

export async function recordIssuedPackFailurePaymentEvent(args: {
    policyId: string;
    eventType: IssuedPackFailureEventType;
    reason: string;
    riskTransactionId?: string | null;
    missingDocTypes?: readonly string[];
}): Promise<void> {
    const payment = await tenantScopedPrisma.payment.findFirst({
        where: { policyId: args.policyId, provider: 'CARDCORP', status: 'PAID' },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
    });
    if (!payment?.id) {
        // No CardCorp payment yet (e.g. BO-issued policy or worker
        // path that runs before payment captures). Logging is the
        // best we can do without a payment row to attach to.
        logger.warn(
            {
                policyId: args.policyId,
                eventType: args.eventType,
                reason: args.reason,
                riskTransactionId: args.riskTransactionId || null,
                missingDocTypes: args.missingDocTypes ? [...args.missingDocTypes] : undefined,
            },
            'issued_pack.failure.no_payment_row',
        );
        return;
    }
    await tenantScopedPrisma.paymentEvent.create({
        data: {
            paymentId: payment.id,
            eventType: args.eventType,
            verified: true,
            payload: {
                reason: String(args.reason || 'unknown_failure'),
                policyId: args.policyId,
                riskTransactionId: args.riskTransactionId || null,
                missingDocTypes: args.missingDocTypes ? [...args.missingDocTypes] : undefined,
                via: 'DOC.GENERATE_ISSUED_POLICY_PACK',
            },
        },
    });
}

/**
 * ABY-77 — build a product-aware "subject summary" for the welcome email.
 *
 * The `NEW_BUSINESS_CONFIRMATION` template requires `policy.vehicleDescription`
 * to be non-empty. If we pass `''` the canonical template renderer treats it
 * as missing and silently skips the dispatch (`templateRenderer.validateVariables`
 * line 67-70).
 *
 * This helper resolves a non-empty subject summary per product:
 *   • motor   → "{make} {model} ({registrationNumber})"
 *   • home    → "{address line}, {city}" or property type
 *   • travel  → "{tripType} to {destination(s)}"
 *   • fallback → "Policy {policyNumber}" (never empty).
 *
 * Kept inside the orchestrator (platform layer) on purpose: it consumes the
 * canonical Policy columns + per-product `quoteData` JSON shape and stays
 * free of any product-module imports (CHAMPS layer rule).
 */
export function buildPolicySubjectSummary(args: {
    policyNumber: string;
    productType: string | null | undefined;
    quoteData: unknown;
    vehicleInfo: unknown;
    vehicleRegistrationNumber?: string | null;
}): string {
    const qd = asRecord(args.quoteData);
    const vinfo = asRecord(args.vehicleInfo);
    const product = String(args.productType || '').toUpperCase();
    const fallback = `Policy ${String(args.policyNumber || '').trim()}`.trim();

    if (product === 'MOTOR') {
        const make = String(vinfo.make || qd.make || '').trim();
        const model = String(vinfo.model || qd.model || '').trim();
        const reg = String(
            vinfo.registrationNumber ||
            qd.registrationNumber ||
            args.vehicleRegistrationNumber ||
            ''
        ).trim();
        const summary = [make, model].filter(Boolean).join(' ').trim();
        const out = reg ? (summary ? `${summary} (${reg})` : reg) : summary;
        if (out) return out;
    }

    if (product === 'HOME') {
        const property = asRecord(qd.property);
        const address = asRecord(property.address || qd.address);
        const line = String(address.line1 || address.line || address.street || '').trim();
        const city = String(address.city || address.town || '').trim();
        const composed = [line, city].filter(Boolean).join(', ').trim();
        if (composed) return composed;
        const propertyTypeLabel = String(property.propertyType || '').trim();
        if (propertyTypeLabel) return propertyTypeLabel;
    }

    if (product === 'TRAVEL') {
        const trip = asRecord(qd.trip);
        const destinationsRaw = Array.isArray(trip.destinations) ? trip.destinations : [];
        const destinations = destinationsRaw.map((d) => String(d || '').trim()).filter(Boolean);
        const tripType = humanizeTravelPlanType(String(trip.planType || trip.tripType || '').trim());
        const destPart = destinations.length > 0
            ? (destinations.length <= 3 ? destinations.join(', ') : `${destinations.slice(0, 3).join(', ')} +${destinations.length - 3} more`)
            : '';
        const composed = [tripType, destPart && `to ${destPart}`].filter(Boolean).join(' ').trim();
        if (composed) return composed;
        if (destPart) return destPart;
        if (tripType) return tripType;
    }

    return fallback || 'your policy';
}

/**
 * Map a stored travel `trip.planType` token (e.g. `single_trip`,
 * `annual_multi_trip`) to its human-readable label so the welcome email
 * reads "Single Trip to Spain" instead of "single_trip to Spain". Falls
 * back to a generic title-case of the raw token for any unknown value.
 */
function humanizeTravelPlanType(raw: string): string {
    if (!raw) return '';
    const known: Record<string, string> = {
        single_trip: 'Single Trip',
        annual_multi_trip: 'Annual Multi-Trip',
    };
    const key = raw.toLowerCase();
    if (known[key]) return known[key];
    return raw
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Product-aware noun for the cover subject line in the welcome email. The
 * `NEW_BUSINESS_CONFIRMATION` template previously hard-coded "Vehicle:",
 * which was nonsensical for travel ("Vehicle: single trip Russia") and
 * home policies. This returns the correct noun per product.
 */
export function buildPolicySubjectLabel(productType: string | null | undefined): string {
    switch (String(productType || '').toUpperCase()) {
        case 'MOTOR':
            return 'Vehicle';
        case 'TRAVEL':
            return 'Trip';
        case 'HOME':
            return 'Property';
        case 'HEALTH':
            return 'Plan';
        default:
            return 'Cover';
    }
}

/**
 * ABY-77 — format a Date column to the en-GB long form used in welcome
 * emails. Returns empty string only when the input is null/invalid; the
 * caller is expected to fall back so we never let `''` reach the renderer
 * (see contract note above).
 */
export function formatPolicyDateForEmail(value: Date | null | undefined): string {
    if (!value) return '';
    const d = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(d.getTime())) return '';
    try {
        return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    } catch {
        return '';
    }
}

export async function maybeSendWelcomeEmailForIssuedPack(args: {
    policyId: string;
    riskTransactionId?: string | null;
    requiredIssuedDocTypes: readonly string[];
    /**
     * Issuance source (from the issued-pack worker envelope). When this is the
     * synthetic health canary (`ISSUANCE_PROOF`) we must NOT fan the issuance
     * out to the internal staff mailbox — the canary runs every few minutes and
     * that copy landed a fake "policy issued" in Theo's inbox each time. The
     * synthetic customer welcome still goes to the canary's configured test sink
     * so the end-to-end email path is still proven. Real issuances (any other
     * source) keep the internal sales copy unchanged.
     */
    source?: string | null;
    /**
     * Top-level envelope correlation id (request-scoped). Surfaced on the staff
     * sale notification so the sale can be reconciled against the originating
     * request and logs. Distinct from `riskTransactionId` (the aggregate id).
     */
    correlationId?: string | null;
}): Promise<boolean> {
    const isSyntheticProof = String(args.source || '').trim().toUpperCase() === 'ISSUANCE_PROOF';
    try {
        const requiredIssuedDocTypes = [...args.requiredIssuedDocTypes];
        const state = await tenantScopedPrisma.policyStateCurrent.findUnique({
            where: { policyId: args.policyId },
            select: { snapshot: true },
        });
        const snapshot = parseRecordJson(state?.snapshot);
        const issuance = parseRecordJson(snapshot.issuance);
        const welcomeEmail = parseRecordJson(issuance.welcomeEmail);
        if (welcomeEmailAlreadySentForTransaction(welcomeEmail, args.riskTransactionId)) {
            logger.info({ policyId: args.policyId }, 'email.welcome.already_sent');
            return true;
        }

        const policy = await tenantScopedPrisma.policy.findUnique({
            where: { id: args.policyId },
            select: {
                id: true,
                policyNumber: true,
                productType: true,
                inceptionDate: true,
                expiryDate: true,
                quoteData: true,
                vehicleInfo: true,
                vehicleRegistrationNumber: true,
                publicSessionToken: true,
                policyHolder: { select: { name: true, contact: true } },
            },
        });
        if (!policy) throw new Error(`Policy not found for welcome email: ${args.policyId}`);

        const qd = asRecord(policy.quoteData);
        const proposer = asRecord(qd?.proposer);
        const holder = asRecord(policy.policyHolder);
        const contactRaw = String(holder.contact || '').trim();
        const parsedHolderContact = (() : UnknownRecord => {
            if (!contactRaw) return {};
            try {
                return asRecord(JSON.parse(contactRaw));
            } catch {
                return {};
            }
        })();
        const primaryContact = asRecord(parsedHolderContact.primary);
        const toEmail = isSyntheticProof
            ? resolveIssuanceProofWelcomeTo()
            : (
                String(proposer.email || '').trim() ||
                String(qd?.contactEmail || '').trim() ||
                String(parsedHolderContact.email || '').trim() ||
                String(primaryContact.email || '').trim() ||
                (contactRaw.includes('@') ? contactRaw : '')
            );
        if (!toEmail) throw new Error(`Missing customer email in quoteData for policy ${args.policyId}`);

        const contactName =
            [proposer.firstName, proposer.lastName].filter(Boolean).join(' ').trim() ||
            String(holder.name || '').trim() ||
            'there';
        // Tenant-aware: this orchestrator runs inside a worker context that
        // has bound the policy's operating tenant via
        // `runWithPolicyOperatingTenant`. The helper reads ALS first so the
        // dashboard URL points at the customer's actual jurisdiction site.
        const baseUrl = resolvePublicAppBaseUrlFromTenant();
        const dashboardUrl = buildPublicDashboardUrl(baseUrl, toEmail);

        const docWhere: {
            policyId: string;
            docPack: string;
            status: string;
            type: { in: string[] };
            riskTransactionId?: string;
        } = {
            policyId: args.policyId,
            docPack: 'ISSUED_POLICY_PACK',
            status: 'GENERATED',
            type: { in: [...requiredIssuedDocTypes] },
        };
        if (args.riskTransactionId) docWhere.riskTransactionId = args.riskTransactionId;

        const docs = await tenantScopedPrisma.document.findMany({
            where: docWhere,
            orderBy: [{ type: 'asc' }, { version: 'desc' }],
            select: { type: true, storageUri: true, filename: true },
        });

        const byType = new Map<string, { storageUri: string; filename: string }>();
        for (const d of docs) {
            const t = String(d.type || '');
            if (!t || byType.has(t)) continue;
            byType.set(t, { storageUri: String(d.storageUri || ''), filename: String(d.filename || '') });
        }

        const missing = requiredIssuedDocTypes.filter((t) => !byType.get(t)?.storageUri);
        if (missing.length) {
            throw new Error(`Issued-pack DB validation failed (missing docs): ${missing.join(', ')}`);
        }

        const attachments: Array<{ filename: string; content: Buffer; contentType?: string }> = [];
        for (const t of requiredIssuedDocTypes) {
            const info = byType.get(t)!;
            const buf = await fetchPdfBufferFromStorageUri(String(info.storageUri || ''));
            if (!buf) throw new Error(`Issued-pack attachment load failed: ${t}`);
            attachments.push({
                filename: info.filename || `${t}.pdf`,
                content: buf,
                contentType: 'application/pdf',
            });
        }

        const { sendPolicyWelcomeEmail, sendInternalSaleNotificationEmail } = await import('../../modules/communications/domain/notifications/email.js');
        // ABY-77 — read dates from the canonical Policy columns; the previous
        // implementation read `qd.periodStartDate` / `qd.periodEndDate` which
        // are not part of the canonical motor/home/travel quoteData shape, so
        // both came back undefined and the template renderer marked them as
        // missing required vars → dispatch silently skipped → welcome email
        // failed for every customer.
        const policyStartDate = formatPolicyDateForEmail(policy.inceptionDate)
            || formatPolicyDateForEmail(new Date());
        const policyEndDate = formatPolicyDateForEmail(policy.expiryDate)
            || policyStartDate;
        const vehicleDetails = buildPolicySubjectSummary({
            policyNumber: String(policy.policyNumber || ''),
            productType: policy.productType,
            quoteData: policy.quoteData,
            vehicleInfo: policy.vehicleInfo,
            vehicleRegistrationNumber: policy.vehicleRegistrationNumber,
        });
        const coverType = String(qd?.coverType || qd?.cover || qd?.planType || '').trim() || undefined;
        const coverSubjectLabel = buildPolicySubjectLabel(policy.productType);
        const transaction = args.riskTransactionId
            ? await tenantScopedPrisma.riskTransaction.findUnique({
                where: { id: args.riskTransactionId },
                select: { transactionType: true, snapshotFinal: true },
            })
            : null;
        if (args.riskTransactionId && !transaction) {
            throw new Error(`Risk transaction not found for issued-pack email: ${args.riskTransactionId}`);
        }
        const issuedQuoteData = args.riskTransactionId
            ? quoteDataFromIssuedRiskTransactionSnapshot(transaction!.snapshotFinal)
            : qd;
        const coverage = asRecord(issuedQuoteData.coverage);
        const homeContentsSumInsured = Number(coverage.contents);
        const isRenewal = String(transaction?.transactionType || '').trim().toUpperCase() === 'RENEWAL';

        const tenantCountryCode = getTenantConfig().countryCode;
        const supportPhone = contactPhoneForCountry(tenantCountryCode);
        const policyBoundDate = formatPolicyDateForEmail(new Date());

        const ok = await sendPolicyWelcomeEmail({
            toEmail,
            contactName,
            policyNumber: String(policy.policyNumber || ''),
            dashboardUrl,
            policyStartDate,
            policyEndDate,
            // The bound/contracted date is issuance time — this email is sent
            // as part of the issued-pack flow, so "now" is the bound date.
            policyBoundDate,
            supportPhone,
            vehicleDetails,
            coverSubjectLabel,
            coverType,
            attachments,
            policyId: args.policyId,
            productCode: policy.productType ?? undefined,
            isRenewal,
            ...(Number.isFinite(homeContentsSumInsured) ? { homeContentsSumInsured } : {}),
            // Synthetic health-canary issuance: stamp the welcome email as a
            // test (subject prefix + banner) and force the transport allowlist.
            ...(isSyntheticProof ? { synthetic: true, source: 'ISSUANCE_PROOF' } : {}),
        });
        if (!ok) throw new Error('Welcome email transport rejected message');

        await markWelcomeEmailSent({
            policyId: args.policyId,
            riskTransactionId: args.riskTransactionId || null,
            toEmail,
            dashboardUrl,
            policyNumber: String(policy.policyNumber || ''),
            requiredDocTypes: requiredIssuedDocTypes,
        });
        await maybeRecordWelcomeEmailPaymentEvent({ policyId: args.policyId, toEmail, dashboardUrl });
        logger.info({ policyId: args.policyId, toEmail, attachmentCount: attachments.length }, 'email.welcome.sent');
        const customerEmailKey = toEmail.trim().toLowerCase();
        const internalCopyEmails = onlinePolicyConfirmationCopyEmailsForCountry(tenantCountryCode)
            .filter((email) => email.trim().toLowerCase() !== customerEmailKey);
        if (isSyntheticProof) {
            // Synthetic health-canary issuance: never notify staff. Suppressing
            // the internal copy here is what stops the issuance-proof run from
            // emailing the desk a fake "policy issued" every few minutes.
            logger.info({
                policyId: args.policyId,
                tenantCountryCode,
                suppressedInternalCopyTo: internalCopyEmails,
            }, 'email.welcome.internal_copy.suppressed_synthetic');
        } else if (internalCopyEmails.length) {
            // Genuine online sale: notify the FULL sales desk with a DEDICATED
            // staff template (INTERNAL_SALE_NOTIFICATION) — a structured
            // operational summary, never a duplicate of the customer welcome
            // copy. It carries purchaser, product, policy, payment reference,
            // source and correlation id so the team can reconcile and action the
            // sale. CY fans out to Danny + Peter + Theo (per-recipient idempotent).
            try {
                const paidPayment = await tenantScopedPrisma.payment.findFirst({
                    where: { policyId: args.policyId, provider: 'CARDCORP', status: 'PAID' },
                    orderBy: { createdAt: 'desc' },
                    select: { id: true, merchantTransactionId: true, paymentId: true, checkoutId: true },
                });
                const paymentReference = String(
                    paidPayment?.merchantTransactionId
                    || paidPayment?.paymentId
                    || paidPayment?.checkoutId
                    || paidPayment?.id
                    || '',
                ).trim();
                const productLabel = String(policy.productType || '')
                    .toLowerCase()
                    .replace(/\b\w/g, (c) => c.toUpperCase()) || 'Policy';
                for (const internalCopyEmail of internalCopyEmails) {
                    const copyOk = await sendInternalSaleNotificationEmail({
                        toEmail: internalCopyEmail,
                        purchaserName: contactName,
                        purchaserEmail: toEmail,
                        productLabel,
                        policyNumber: String(policy.policyNumber || ''),
                        coverSummary: vehicleDetails,
                        paymentReference,
                        source: String(args.source || 'ONLINE'),
                        correlationId: String(args.correlationId || args.riskTransactionId || args.policyId || ''),
                        adminUrl: buildBackOfficePolicyUrl(
                            resolvePublicAppBaseUrlFromTenant(),
                            args.policyId,
                        ),
                        policyId: args.policyId,
                    });
                    logger.info({
                        policyId: args.policyId,
                        toEmail: internalCopyEmail,
                        tenantCountryCode,
                        sent: copyOk,
                    }, copyOk ? 'email.internal_sale.sent' : 'email.internal_sale.skipped');
                }
            } catch (copyError) {
                logger.warn({
                    policyId: args.policyId,
                    toEmail: internalCopyEmails,
                    tenantCountryCode,
                    err: copyError,
                }, 'email.internal_sale.failed');
            }
        }
        return true;
    } catch (e) {
        const reason = (e as Error)?.message || 'welcome_email_failed';
        await maybeRecordWelcomeEmailFailurePaymentEvent({
            policyId: args.policyId,
            reason,
            riskTransactionId: args.riskTransactionId || null,
        });
        logger.error({ policyId: args.policyId, err: e, reason }, 'email.welcome.failed');
        throw e instanceof Error ? e : new Error(reason);
    }
}

// ─── Endorsement Email ────────────────────────────────────────────

async function resolveRequiredAttachments(args: {
    policyId: string;
    riskTransactionId?: string | null;
    requiredTypes: string[];
}) {
    const attachments: Array<{ filename: string; content: Buffer; contentType?: string }> = [];
    const missingTypes: string[] = [];
    const fallbackTypes: string[] = [];
    const attachmentTypes: string[] = [];

    for (const type of args.requiredTypes) {
        let doc = args.riskTransactionId
            ? await tenantScopedPrisma.document.findFirst({
                where: {
                    policyId: args.policyId,
                    riskTransactionId: args.riskTransactionId,
                    status: 'GENERATED',
                    type,
                },
                orderBy: [{ version: 'desc' }, { generatedAt: 'desc' }, { createdAt: 'desc' }],
                select: { type: true, storageUri: true, filename: true },
            })
            : null;

        if (!doc) {
            doc = await tenantScopedPrisma.document.findFirst({
                where: {
                    policyId: args.policyId,
                    status: 'GENERATED',
                    type,
                },
                orderBy: [{ generatedAt: 'desc' }, { version: 'desc' }, { createdAt: 'desc' }],
                select: { type: true, storageUri: true, filename: true },
            });
            if (doc) fallbackTypes.push(type);
        }

        if (!doc?.storageUri) {
            missingTypes.push(type);
            continue;
        }

        const buf = await fetchPdfBufferFromStorageUri(String(doc.storageUri || ''));
        if (!buf) {
            missingTypes.push(type);
            continue;
        }

        attachments.push({
            filename: String(doc.filename || `${type}.pdf`),
            content: buf,
            contentType: 'application/pdf',
        });
        attachmentTypes.push(type);
    }

    return {
        attachments,
        missingTypes,
        fallbackTypes,
        attachmentTypes,
    };
}

export async function sendEndorsementIssueEmailWithAttachments(args: {
    policyId: string;
    riskTransactionId?: string | null;
    includeEvidencePack: boolean;
    requiredIssuedDocTypes: readonly string[];
    requiredEndorsementDocTypes: readonly string[];
}) {
    const requiredIssuedDocTypes = [...args.requiredIssuedDocTypes];
    const requiredEndorsementDocTypes = [...args.requiredEndorsementDocTypes];
    const target = await resolvePolicyEmailTarget(args.policyId);
    if (!target) {
        logger.error({
            policyId: args.policyId,
            riskTransactionId: args.riskTransactionId || null,
        }, 'endorsement.email.missing_customer_email');
        return { sent: false, missingTypes: ['MISSING_EMAIL'], fallbackTypes: [], attachmentTypes: [] };
    }

    const requiredTypes = [
        ...requiredEndorsementDocTypes,
        ...(args.includeEvidencePack ? [...requiredIssuedDocTypes] : []),
    ];
    const resolved = await resolveRequiredAttachments({
        policyId: args.policyId,
        riskTransactionId: args.riskTransactionId || null,
        requiredTypes,
    });

    if (resolved.fallbackTypes.length > 0) {
        logger.warn({
            policyId: args.policyId,
            riskTransactionId: args.riskTransactionId || null,
            fallbackTypes: resolved.fallbackTypes,
        }, 'endorsement.email.attachments_fallback_used');
    }

    if (resolved.missingTypes.length > 0) {
        logger.error({
            policyId: args.policyId,
            riskTransactionId: args.riskTransactionId || null,
            requiredTypes,
            missingTypes: resolved.missingTypes,
            fallbackTypes: resolved.fallbackTypes,
        }, 'endorsement.email.attachments_missing');
        return {
            sent: false,
            missingTypes: resolved.missingTypes,
            fallbackTypes: resolved.fallbackTypes,
            attachmentTypes: resolved.attachmentTypes,
        };
    }

    const { sendRequestedDocumentsEmail } = await import('../../modules/communications/domain/notifications/email.js');
    const sent = await sendRequestedDocumentsEmail({
        toEmail: target.toEmail,
        contactName: target.contactName,
        policyNumber: target.policyNumber,
        attachments: resolved.attachments,
        policyId: args.policyId,
    });
    if (!sent) {
        logger.error({
            policyId: args.policyId,
            riskTransactionId: args.riskTransactionId || null,
            attachmentTypes: resolved.attachmentTypes,
        }, 'endorsement.email.transport_failed');
        return {
            sent: false,
            missingTypes: [],
            fallbackTypes: resolved.fallbackTypes,
            attachmentTypes: resolved.attachmentTypes,
        };
    }

    logger.info({
        policyId: args.policyId,
        riskTransactionId: args.riskTransactionId || null,
        toEmail: target.toEmail,
        attachmentTypes: resolved.attachmentTypes,
        fallbackTypes: resolved.fallbackTypes,
    }, 'endorsement.email.sent');
    return {
        sent: true,
        missingTypes: [],
        fallbackTypes: resolved.fallbackTypes,
        attachmentTypes: resolved.attachmentTypes,
    };
}

// ─── Doc Type Helpers ─────────────────────────────────────────────

function generatedDocTypesFromResult(result: unknown): Set<string> {
    const record = asRecord(result);
    const docs = Array.isArray(record.documents) ? record.documents : [];
    const out = new Set<string>();
    for (const d of docs) {
        const t = String(asRecord(d).type || '').trim();
        if (t) out.add(t);
    }
    return out;
}

export function missingIssuedDocTypes(result: unknown, requiredDocTypes?: readonly string[]): string[] {
    const generated = generatedDocTypesFromResult(result);
    const required = requiredDocTypes ?? [];
    return required.filter((t) => !generated.has(t));
}

// ─── Lifecycle Promotion ──────────────────────────────────────────

export async function promoteIssuedLifecycle(args: { policyId: string; riskTransactionId?: string | null }) {
    await runTenantScopedTransaction(async (_tx) => {
      const tx = _tx as unknown as Prisma.TransactionClient;
        const policy = await tx.policy.findUnique({
            where: { id: args.policyId },
            select: { id: true, status: true, inceptionDate: true, issuedAt: true },
        });
        if (!policy) throw new Error(`Policy not found for issuance promotion: ${args.policyId}`);

        if (String(policy.status || '') === 'ISSUING') {
            const now = new Date();
            const finalStatus =
                policy.inceptionDate && now < new Date(policy.inceptionDate)
                    ? 'ISSUED'
                    : 'ACTIVE';

            await tx.policy.update({
                where: { id: args.policyId },
                data: {
                    status: finalStatus,
                    issuedAt: policy.issuedAt || now,
                    isLocked: true,
                },
            });
            await tx.policySearchIndex.update({
                where: { policyId: args.policyId },
                data: { status: finalStatus },
            }).catch(() => undefined);
        }

        if (args.riskTransactionId) {
            const rt = await tx.riskTransaction.findUnique({
                where: { id: args.riskTransactionId },
                select: { id: true, status: true },
            });
            if (!rt) throw new Error(`Risk transaction not found: ${args.riskTransactionId}`);
            if (String(rt.status || '') === 'PENDING_DOCS') {
                await tx.riskTransaction.update({
                    where: { id: args.riskTransactionId },
                    data: { status: 'BOUND' },
                });
            }
        }
    });
}

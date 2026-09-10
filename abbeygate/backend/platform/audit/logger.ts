
import crypto from 'crypto';
import type { Prisma } from '@prisma/client';
import { getTenantConfig } from '../tenant/tenantConfig.js';
import { tenantScopedPrisma } from '../db/connection.js';
import { logger } from '../utils/logger.js';
import { getCorrelationId } from '../observability/context.js';

export type AuditEventType =
    | 'POLICY.CREATED'
    | 'POLICY.CREATED_FROM_QUOTE'
    | 'POLICY.BOUND'
    | 'QUOTE.GENERATED'
    | 'QUOTE.SENT'
    | 'QUOTE.PUBLIC_EMAIL_SENT'
    | 'QUESTIONNAIRE.SENT'
    | 'QUESTIONNAIRE.SUPERSEDED'
    | 'DECLARATION.UPLOADED'
    | 'DECLARATION.APPROVED'
    | 'INVOICE.CREATED'
    | 'ENDORSEMENT.CREATED'
    | 'ENDORSEMENT.BOUND'
    | 'ACCOUNT.CREATED'
    | 'FOLLOW_UP.SENT'
    | 'COVERAGE.UPDATED'
    | 'DOCUMENT.CREATED'
    | 'CLAIM.SUBMITTED'
    | 'CLAIM.UPDATED'
    | 'PAYMENT.CHECKOUT_CREATED'
    | 'PAYMENT.CONFIRMED'
    | 'INVOICE.ISSUED'
    | 'INVOICE.DELETED'
    | 'QUESTIONNAIRE.SUBMITTED'
    | 'POLICY.QUOTED'
    | 'POLICY.DELETED'
    | 'PROGRAM.CREATED'
    | 'PROGRAM.RATING_MODEL.SAVED'
    | 'PROGRAM.RATING_MODEL.PUBLISHED'
    | 'DOCUMENTS.GENERATED'
    | 'AUTO_QUOTE.INVITE_SENT'
    | 'UW.INFO_REQUIRED'
    | 'CANCELLATION.REQUESTED'
    | 'CANCELLATION.APPROVED'
    | 'CANCELLATION.REJECTED'
    | 'POLICY.ISSUED'
    | 'POLICY.ISSUING'
    | 'PROGRAM.UW_CONFIG.SAVED'
    | 'PROGRAM.MBE_CONFIG.SAVED'
    | 'PROGRAM.BINDER_LINK.CREATED'
    | 'PROGRAM.BINDER_LINK.DELETED'
    | 'POLICY.SESSION_CREATED'
    | 'AUTO_QUOTE.SESSION_CREATED'
    | 'AUTO_QUOTE.DRAFT_UPDATED'
    | 'AUTO_QUOTE.RATED'
    | 'AUTO_QUOTE.FORKED'
    | 'AUTO_QUOTE.UNLOCKED'
    | 'AUTO_QUOTE.CALLBACK_REQUESTED'
    // Recommendations / learning loop
    | 'RECO.EVENT'
    | 'BINDER.CREATED'
    | 'BINDER.SAVED'
    | 'BINDER.UPLOADED_AND_PARSED'
    // Endorsement (post-issuance) versioning
    | 'ENDORSEMENT.DRAFT.CREATED'
    | 'ENDORSEMENT.DRAFT.RATED'
    | 'ENDORSEMENT.VERSION_SAVED'
    | 'ENDORSEMENT.ISSUED'
    | 'RENEWAL.DRAFT.CREATED'
    | 'RENEWAL.DRAFT.RATED'
    | 'RENEWAL.BOUND'
    | 'RENEWAL.ISSUED'
    // BO quote versioning + policy coverage selection
    | 'POLICY.QUOTE_VERSION.ARCHIVED'
    | 'POLICY.QUOTE_VERSION.RESTORED'
    | 'POLICY.QUOTE_VERSION.SAVED'
    | 'POLICY.COVERAGE_SELECTION.SAVED'
    | 'POLICY.UW.MANUAL_APPROVAL'
    | 'POLICY.BOUND_MODE.CANCELLED'
    | 'POLICY.UPDATED'
    | 'COMPLIANCE.SANCTIONS.REQUESTED'
    | 'COMPLIANCE.SANCTIONS.CLEARED'
    | 'COMPLIANCE.SANCTIONS.BLOCKED'
    | 'COMPLIANCE.SANCTIONS.UNAVAILABLE_FAIL_CLOSED'
    // Config MCP V1 (ADR-0036 / ADR-0037)
    | 'CONFIG.DRAFT_CREATED'
    | 'CONFIG.DRAFT_UPDATED'
    | 'CONFIG.VALIDATION_PASSED'
    | 'CONFIG.VALIDATION_FAILED'
    | 'CONFIG.SIMULATION_COMPLETED'
    | 'CONFIG.SANDBOX_PUBLISHED'
    | 'CONFIG.PUBLISH_BLOCKED'
    // The tool-call audit row uses the literal `actionName` set to
    // `'CONFIG.TOOL_CALLED.<dotted.tool.name>'` (open dotted suffix);
    // the DB column is String, so the open-suffix literal is widened
    // here as a template type for type-side accuracy.
    | `CONFIG.TOOL_CALLED.${string}`
    // Operator MCP V1 (ADR-0036 amendment #2). Same open-suffix pattern
    // as CONFIG. `OPERATOR.COMM_SENT` covers wizard / quote / docs /
    // FNOL comms (the canonical send funnel logs its own COMM.* event
    // already; this row is the operator-action audit on top).
    | 'OPERATOR.COMM_SENT'
    | 'OPERATOR.ENTITY_RESOLVED'
    | 'OPERATOR.AMBIGUOUS_MATCH'
    | `OPERATOR.TOOL_CALLED.${string}`
    // Operator MCP V2 mutation governance (ADR-0039 / ADR-0036 amendment #3).
    // Each operator.* mutation tool emits exactly one of these on success;
    // the preview tools emit OPERATOR.QUOTE_PREVIEW_GENERATED with the
    // confirmation_token hash in the diff.
    | 'OPERATOR.QUOTE_PATCH_APPLIED'
    | 'OPERATOR.QUOTE_RERATED'
    | 'OPERATOR.QUOTE_PREVIEW_GENERATED'
    | 'OPERATOR.QUOTE_REVISION_SAVED'
    | 'OPERATOR.QUOTE_REVISION_SENT'
    | 'OPERATOR.ENDORSEMENT_DRAFT_CREATED'
    | 'OPERATOR.ENDORSEMENT_LINK_SENT'
    | 'OPERATOR.ENDORSEMENT_SUBMITTED_FOR_REVIEW'
    | 'OPERATOR.BO_DRAFT_AUTHORITY_BACKFILL_PREVIEWED'
    | 'OPERATOR.BO_DRAFT_AUTHORITY_BACKFILL_APPLIED'
    // MCP OAuth 2.1 (V2.1 — ADR-0040 §10). actorId = user:<id> for
    // consent rows (the BO user who clicked Allow); actorId =
    // oauth_client:<clientId> for autonomous refresh / revoke.
    | 'OAUTH.CLIENT_REGISTERED'
    | 'OAUTH.CLIENT_REVOKED'
    | 'OAUTH.AUTHORIZATION_GRANTED'
    | 'OAUTH.AUTHORIZATION_DENIED'
    | 'OAUTH.TOKEN_ISSUED'
    | 'OAUTH.TOKEN_REFRESHED'
    | 'OAUTH.TOKEN_REVOKED'
    // Claim Memory V1 (ADR-0041). Emitted by the CLAIM_MEMORY.REFRESH
    // BullMQ handler and the BO `POST /api/claims/:id/memory/refresh`
    // route. entityType is always 'CLAIM'; actorId is
    // 'claim-memory-worker' for worker-driven refreshes or the BO
    // user id for manual refreshes.
    | 'CLAIM_MEMORY.REFRESH_ENQUEUED'
    | 'CLAIM_MEMORY.REFRESHED'
    | 'CLAIM_MEMORY.REFRESH_FAILED'
    | 'CLAIM_MEMORY.CITATION_WARNING'
    | 'MOTOR_MARKET.SUBMISSION_PREPARED'
    | 'MOTOR_MARKET.SUBMISSION_ATTEMPTED'
    | 'PEOPLE.LEAVE.CANCELLED';

export class AuditLogger {
    private static toInputJson(value: unknown): Prisma.InputJsonValue {
        if (value === null || value === undefined) {
            return {};
        }
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            return value;
        }
        if (Array.isArray(value)) {
            return value.map((entry) => {
                if (entry === null) return null;
                if (entry === undefined || typeof entry === 'function' || typeof entry === 'symbol' || typeof entry === 'bigint') {
                    return null;
                }
                return this.toInputJson(entry);
            });
        }
        if (typeof value === 'object') {
            const out: Record<string, Prisma.InputJsonValue | null> = {};
            for (const [key, entry] of Object.entries(value)) {
                if (entry === undefined || typeof entry === 'function' || typeof entry === 'symbol' || typeof entry === 'bigint') {
                    continue;
                }
                out[key] = entry === null ? null : this.toInputJson(entry);
            }
            return out;
        }
        return {};
    }

    static async log(
        entityId: string,
        entityType: 'POLICY' | 'BINDER' | 'CLAIM' | 'USER' | 'PROGRAM' | 'CONFIG_DRAFT' | 'OPERATOR_ACTION' | 'COMMUNICATION' | 'OAUTH_CLIENT' | 'OAUTH_TOKEN' | 'STAFF_ABSENCE',
        actionName: AuditEventType,
        actorId: string = 'system', // Default to system if not authorized user
        actorType: 'USER' | 'SYSTEM' = 'SYSTEM',
        diff: Record<string, unknown> | null = null,
        actorName?: string // New optional field
    ) {
        // If audit table isn't available in a given environment (tests / partial schema),
        // fail silent without noise.
        if (!tenantScopedPrisma.auditAction?.create) return;

        const correlationId = getCorrelationId();
        const enrichedDiff = {
            ...(diff || {}),
            ...(correlationId ? { correlationId } : {}),
        };
        const safeDiff = this.toInputJson(enrichedDiff);
        // Compute SHA-256 Hash of the critical payload
        // Ideally we include a timestamp in the hash, but for consistency in this simplified implementation we'll hash the known inputs
        // In a real system the timestamp is critical for the chain.
        const payloadToHash = {
            entityId,
            entityType,
            actionName,
            actorId,
            actorType,
            diff: safeDiff,
            actorName
        };

        const hash = crypto.createHash('sha256').update(JSON.stringify(payloadToHash)).digest('hex');

        try {
            const auditData: Prisma.AuditActionUncheckedCreateInput = {
                operatingTenantId: getTenantConfig().id,
                entityId,
                entityType,
                actionName,
                actorId,
                actorName, // Persist name
                actorType,
                diff: safeDiff,
                hash,
            };
            await tenantScopedPrisma.auditAction.create({ data: auditData });
        } catch (err) {
            // Fail silent to not block main transaction; log only when explicitly enabled.
            if (String(process.env.AUDIT_LOG_ERRORS || '').toLowerCase() === 'true') {
                logger.warn({ err }, 'audit.write_failed');
            }
        }
    }
}

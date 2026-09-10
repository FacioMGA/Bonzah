/**
 * quoteSessionOps.ts — Session lifecycle operations for public auto quotes.
 *
 * Each function is a self-contained use-case:
 *   - createPublicAutoSession() — session creation + policyholder + search index
 *   - getPublicIssueReadiness() — thin delegate to evaluateIssueReadiness
 *   - queuePublicQuotePackGeneration() — readiness check + queue event
 *   - getOrQueuePublicIssuedPackLinks() — document lookup + auto-queue
 *   - unlockPublicAutoPolicy() — unlock + archive + audit
 *   - forkPublicAutoPolicy() — clone + rate limit + audit
 */
import type { Prisma } from '@prisma/client';
import { tenantScopedPrisma, runTenantScopedTransaction } from '../../../platform/db/connection.js';
import type { WithoutTenantScope } from '../../../platform/db/tenantExtension.js';
import { AuditLogger } from '../../../platform/audit/logger.js';
import { reserveNextQuoteId } from '../../../platform/utils/platformIds.js';
import { evaluateIssueReadiness } from '../../../modules/policy/app/issueReadiness.js';
import { routeEventToQueue } from '../../../platform/events/queue.js';
import { jsonStringify } from '../../../modules/policy/app/shared.js';
import { saveQuoteVersion } from '../../../modules/policy/app/history/saveQuoteVersion.js';
import { enqueuePolicyListIndexUpdate } from '../../../modules/policy/infra/projections/policyListIndex.js';
import { ProductConfigurationError, resolveJurisdictionProductConfig } from '../../../modules/jurisdiction/domain/productConfiguration.js';
import { getTenantConfig } from '../../../platform/tenant/tenantConfig.js';
import {
    assertBinderAuthorizesProduct,
    BinderAuthorityError,
    findLatestActiveBinderLinkForProduct,
} from '../../../modules/policy/app/binders/binderAuthority.js';
import {
    ProgramDefinitionConfigurationError,
    resolveMappedProgrammeChannelPermissions,
} from '../../../modules/programs/app/activeProgramDefinition.js';
import {
    buildIssuedPackReplayIdempotencyKey,
    enqueueIssuedPolicyPackStandalone,
    isDuplicateIssuedPackEventIdError,
} from '../../../modules/policy/app/commands/issuedPackEnqueue.js';
import { latestTermOrderBy } from '../../../modules/policy/app/policyTermFamily.js';

import type { PublicAutoOrigin } from './service.js';

type PublicSessionModule = typeof import('./publicSession.js');
const publicSessionModule: PublicSessionModule = await import('./publicSession.js');
const { newPublicSessionToken } = publicSessionModule;

type ErrorsModule = typeof import('./errors.js');
const errorsModule: ErrorsModule = await import('./errors.js');
const { PublicApiError } = errorsModule;

// ── createPublicAutoSession ───────────────────────────────────────

export async function createPublicAutoSession(args: {
    sessionKey?: string;
    origin?: PublicAutoOrigin;
    vehicleType?: string;
    allowChannelBypass?: boolean;
}) {
    try {
        resolveJurisdictionProductConfig({ productCode: 'MOTOR', tenant: getTenantConfig() });
    } catch (error) {
        if (!(error instanceof ProductConfigurationError)) throw error;
        throw new PublicApiError({ httpStatus: 403, code: 'PRODUCT_UNAVAILABLE', message: error.message });
    }
    const sessionKey = args.sessionKey ? String(args.sessionKey).trim() : '';
    const originSafe: PublicAutoOrigin = args.origin === 'bo' ? 'bo' : 'customer';
    const vehicleType = String(args.vehicleType || '').trim();

    // SECURITY: customer sessions must be accessed only via the opaque public
    // session token. Reopen-by-policyNumber was deleted in PR6 of the
    // aggressive-cleanup plan.
    if (sessionKey) {
        throw new PublicApiError({
            httpStatus: 400,
            code: 'BAD_REQUEST',
            message: 'sessionKey is not supported on this endpoint',
        });
    }

    // Optional idempotency: if the caller provides a sessionKey, reuse it.
    if (sessionKey) {
        const existing = await tenantScopedPrisma.policy.findFirst({
            where: { policyNumber: sessionKey, productType: 'MOTOR' },
            orderBy: latestTermOrderBy(),
            select: { id: true, policyNumber: true, status: true, publicSessionToken: true },
        });
        if (existing) {
            const token = existing.publicSessionToken || newPublicSessionToken();
            if (!existing.publicSessionToken) {
                // Self-heal: old sessions created before token rollout
                await tenantScopedPrisma.policy.update({ where: { id: existing.id }, data: { publicSessionToken: token } });
            }
            return {
                policyId: existing.id,
                policyNumber: existing.policyNumber,
                publicSessionToken: token,
                status: existing.status,
            };
        }
    }

    const now = new Date();
    const expiry = new Date(now);
    expiry.setFullYear(expiry.getFullYear() + 1);
    const tenantId = getTenantConfig().id;

    // ADR-0034 — motor session creation MUST refuse before reserving a policy
    // number when no active binder authorises MOTOR in this tenant. Previously
    // motor skipped the binder check that the generic public quote router did
    // for every other product, which surfaced as a Prisma unique-constraint
    // 500 on every PT/GR/ES motor wizard start (ABY-294). Now every public
    // session creator passes through the same canonical binder gate.
    const binderLink = await findLatestActiveBinderLinkForProduct({
        productCode: 'MOTOR',
        inceptionDate: now,
    });
    if (!binderLink) {
        throw new PublicApiError({
            httpStatus: 503,
            code: 'NO_ACTIVE_BINDER',
            message: 'No active binder linked for MOTOR in this tenant',
        });
    }
    try {
        await assertBinderAuthorizesProduct({ binderId: binderLink.binderId, productCode: 'MOTOR' });
    } catch (authErr) {
        if (authErr instanceof BinderAuthorityError) {
            throw new PublicApiError({
                httpStatus: 422,
                code: authErr.code,
                message: authErr.message,
                details: { reason: authErr.reason },
            });
        }
        throw authErr;
    }
    try {
        const channels = await resolveMappedProgrammeChannelPermissions({
            programId: binderLink.programId,
            binderProductAuthorityId: binderLink.binderProductAuthority.id,
        });
        if (!channels.questions && !args.allowChannelBypass) {
            throw new PublicApiError({
                httpStatus: 403,
                code: 'PRODUCT_CHANNEL_DISABLED',
                message: 'Online applications are not available for this programme right now. Please request a callback.',
            });
        }
    } catch (error) {
        if (error instanceof PublicApiError) throw error;
        if (error instanceof ProgramDefinitionConfigurationError) {
            throw new PublicApiError({
                httpStatus: 503,
                code: error.code,
                message: error.message,
            });
        }
        throw error;
    }

    const result = await runTenantScopedTransaction(async (_tx) => {
      const tx = _tx as Prisma.TransactionClient;
        const policyNumber = sessionKey || (await reserveNextQuoteId(tx, 'MOTOR'));
        const initialQuoteData = {
            __meta: { origin: originSafe },
            ...(vehicleType ? { vehicleType } : {}),
        };
        const publicSessionToken = newPublicSessionToken();

        const policyHolderData: Prisma.PolicyHolderUncheckedCreateInput = {
            operatingTenantId: tenantId,
            name: 'New Submission',
            segment: 'Auto Insurance',
            address: '',
        };
        const policyHolder = await tx.policyHolder.create({
            data: policyHolderData,
        });

        const policyData: Prisma.PolicyUncheckedCreateInput = {
            operatingTenantId: tenantId,
            policyNumber,
            publicSessionToken,
            productType: 'MOTOR',
            programId: binderLink.programId,
            binderId: binderLink.binderId,
            status: 'DRAFT',
            inceptionDate: now,
            expiryDate: expiry,
            policyHolderId: policyHolder.id,
            quoteData: initialQuoteData,
            vehicleInfo: {},
            driverInfo: {},
        };
        const policy = await tx.policy.create({
            data: policyData,
            // Keep create resilient during rolling DB migrations where new optional columns
            // may not exist yet (for example bo_status on older prod replicas).
            select: {
                id: true,
                policyNumber: true,
                publicSessionToken: true,
                status: true,
            },
        });

        const initialStateCreate: Prisma.PolicyStateCurrentUncheckedCreateInput = {
            operatingTenantId: tenantId,
            policyId: policy.id,
            snapshot: {
                quoteData: initialQuoteData,
                step: 'policy-holder',
                flow_context: { channel: originSafe === 'customer' ? 'customer_wizard' : 'bo', step: 'policy_holder' },
            },
        };
        await tx.policyStateCurrent.upsert({
            where: { policyId: policy.id },
            update: {
                snapshot: {
                    quoteData: initialQuoteData,
                    step: 'policy-holder',
                    flow_context: { channel: originSafe === 'customer' ? 'customer_wizard' : 'bo', step: 'policy_holder' },
                },
            },
            create: initialStateCreate,
        });

        const initialSearchIndexCreate: Prisma.PolicySearchIndexUncheckedCreateInput = {
            operatingTenantId: tenantId,
            policyId: policy.id,
            policyNumber: policy.policyNumber,
            insuredName: policyHolder.name,
            status: policy.status,
            segment: 'Auto Insurance',
            address: '',
        };
        await tx.policySearchIndex.upsert({
            where: { policyId: policy.id },
            update: {
                policyNumber: policy.policyNumber,
                insuredName: policyHolder.name,
                status: policy.status,
                segment: 'Auto Insurance',
                address: '',
            },
            create: initialSearchIndexCreate,
        });
        await enqueuePolicyListIndexUpdate(tx, policy.id);

        return { policy, policyHolder };
    });

    void AuditLogger.log(
        result.policy.id,
        'POLICY',
        'AUTO_QUOTE.SESSION_CREATED',
        'customer',
        'USER',
        { policyNumber: result.policy.policyNumber },
        'Customer'
    );

    return {
        policyId: result.policy.id,
        policyNumber: result.policy.policyNumber,
        publicSessionToken: result.policy.publicSessionToken,
        status: result.policy.status,
    };
}

// ── getPublicIssueReadiness ───────────────────────────────────────

export async function getPublicIssueReadiness(args: { policyId: string }) {
    return await evaluateIssueReadiness(args.policyId, 'customer');
}

// ── queuePublicQuotePackGeneration ────────────────────────────────

export async function queuePublicQuotePackGeneration(args: { policyId: string }) {
    const readiness = await evaluateIssueReadiness(args.policyId, 'customer');
    if (!readiness.canGenerateQuotePack) {
        throw new PublicApiError({
            httpStatus: 422,
            code: 'NOT_READY',
            message: 'Quote pack cannot be generated yet',
            details: readiness,
        });
    }

    await routeEventToQueue('DOC.GENERATE_QUOTE_PACK', {
        policyId: args.policyId,
        docPack: 'QUOTE_PACK',
        source: 'CUSTOMER',
        generatedByUserId: null,
    });

    return { status: 'PENDING' as const, message: 'Document generation queued.', policyId: args.policyId };
}

// ── getOrQueuePublicIssuedPackLinks ───────────────────────────────

export async function getOrQueuePublicIssuedPackLinks(args: { policyId: string; riskTransactionId: string | null }) {
    const requiredTypes = [
        'MOTOR_CERTIFICATE_PDF',
        'MOTOR_GREEN_CARD_PDF',
        'MOTOR_SCHEDULE_PDF',
        'MOTOR_STATEMENT_OF_FACT_PDF',
    ] as const;

    const docs = await tenantScopedPrisma.document.findMany({
        where: {
            policyId: args.policyId,
            riskTransactionId: args.riskTransactionId,
            docPack: 'ISSUED_POLICY_PACK',
            status: 'GENERATED',
            type: { in: [...requiredTypes] },
        },
        orderBy: [{ type: 'asc' }, { version: 'desc' }],
        select: { id: true, type: true, filename: true, generatedAt: true },
    });

    const byType = new Map<string, { id: string; type: string; filename: string | null; generatedAt: Date | null }>();
    for (const d of docs) {
        const t = String(d.type || '');
        if (!t || byType.has(t)) continue;
        byType.set(t, {
            id: String(d.id),
            type: t,
            filename: d.filename ? String(d.filename) : null,
            generatedAt: d.generatedAt ? new Date(d.generatedAt) : null,
        });
    }

    const missing = requiredTypes.filter((t) => !byType.get(t)?.id);
    if (missing.length) {
        // ADR-0013 — public-flow "missing docs, please regenerate"
        // path. There is no enclosing transaction here (read-then-act
        // backfill), so we use the standalone variant which writes the
        // outbox row in its own short transaction. The relay drains
        // it like every other DOC.GENERATE_ISSUED_POLICY_PACK event.
        // We use a time-bucketed replay key so concurrent retries in
        // the same window dedupe while still allowing later replays if
        // the previous dispatch already ran but docs are still missing.
        const replayKey = buildIssuedPackReplayIdempotencyKey({
            policyId: args.policyId,
            riskTransactionId: args.riskTransactionId,
            bucketSeconds: 60,
        });
        try {
            await enqueueIssuedPolicyPackStandalone({
                policyId: args.policyId,
                riskTransactionId: args.riskTransactionId,
                source: 'SYSTEM',
                idempotencyKey: replayKey,
            });
        } catch (error) {
            // "Already queued in this retry window" is not a hard failure.
            // Surface a normal pending response so the client keeps polling.
            if (!isDuplicateIssuedPackEventIdError(error)) throw error;
        }
        return {
            queued: true as const,
            retryAfterSeconds: 3,
            message: 'Policy document generation queued. Please retry shortly.',
            missingTypes: missing,
        };
    }

    const ttlMinutes = Number(process.env.PUBLIC_POLICY_DOC_TTL_MINUTES || 60);
    const newestGeneratedAt = Array.from(byType.values())
        .map((d) => d.generatedAt?.getTime() || 0)
        .reduce((a, b) => Math.max(a, b), 0);
    const base = newestGeneratedAt ? new Date(newestGeneratedAt) : new Date();
    const expiresAt = new Date(base.getTime() + ttlMinutes * 60_000);

    const items = requiredTypes.map((t) => {
        const d = byType.get(t)!;
        return {
            type: d.type,
            documentId: d.id,
            filename: d.filename,
            publicUrl: `/api/public/documents/${d.id}`,
        };
    });

    return {
        queued: false as const,
        publicExpiresAt: expiresAt.toISOString(),
        documents: items,
    };
}

// ── unlockPublicAutoPolicy ────────────────────────────────────────

export async function unlockPublicAutoPolicy(args: {
    policy: { id: string; isLocked: boolean; status: string; quoteData: unknown; quoteResponse: unknown; policyHolderId: string };
}) {
    const policy = args.policy;
    const policyStatusUpper = String(policy.status || '').toUpperCase();
    const immutableStatuses = new Set(['BOUND', 'BOUND_DRAFT_ISSUED', 'ISSUED', 'ACTIVE', 'CANCELLED', 'EXPIRED']);

    // If not locked, nothing to do
    if (!policy.isLocked) {
        return { alreadyUnlocked: true as const };
    }
    if (immutableStatuses.has(policyStatusUpper)) {
        throw new PublicApiError({
            httpStatus: 409,
            code: 'POLICY_NOT_EDITABLE',
            message: 'Issued/active policies cannot be unlocked for public wizard editing.',
        });
    }

    await runTenantScopedTransaction(async (_tx) => {
      const tx = _tx as Prisma.TransactionClient;
        // 1. Archive current state
        await saveQuoteVersion(tx, {
            policyId: policy.id,
            quoteData: policy.quoteData,
            quoteResponse: policy.quoteResponse,
            isLockedSnapshot: true,
        });

        // 2. Unlock Policy
        // We reset paymentStatus to NOT_REQUIRED because any edit invalidates the previous price/payment intent.
        await tx.policy.update({
            where: { id: policy.id },
            data: {
                isLocked: false,
                paymentStatus: 'NOT_REQUIRED',
                status: policy.status === 'AWAITING_PAYMENT' ? 'QUOTED' : policy.status,
            },
        });

        // 3. Mark the payment intent as CANCELLED (optional, but good for clarity)
        await tx.payment.updateMany({
            where: { policyId: policy.id, status: 'PENDING' },
            data: { status: 'CANCELLED' },
        });
    });

    void AuditLogger.log(policy.id, 'POLICY', 'AUTO_QUOTE.UNLOCKED', 'customer', 'USER', { reason: 'user_edit' }, 'Customer');

    return { alreadyUnlocked: false as const };
}

// ── forkPublicAutoPolicy ──────────────────────────────────────────

export async function forkPublicAutoPolicy(args: {
    originalPublicId: string;
    policy: { id: string; policyHolderId: string; inceptionDate: Date; expiryDate: Date; quoteData: unknown; vehicleInfo: unknown; driverInfo: unknown; policyNumber: string; publicSessionToken?: string | null };
}) {
    const policy = args.policy;

    // Start-Of-Day Rate Limit (Forking)
    // Prevent abuse by limiting the number of active/draft quotes a holder can generate.
    // Set QUOTE_FORK_LIMIT=0 in the environment to disable the check entirely (e.g. for
    // UAT / testing periods where testers need to iterate freely on parameters).
    // Unset or any positive integer restores the production cap (default: 5).
    const forkLimit = process.env.QUOTE_FORK_LIMIT !== undefined
      ? Number(process.env.QUOTE_FORK_LIMIT)
      : 5;

    if (forkLimit > 0) {
      const recentForks = await tenantScopedPrisma.policy.count({
          where: {
              policyHolderId: policy.policyHolderId,
              createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }, // Last 24h
              status: { not: 'CANCELLED' },
          },
      });

      if (recentForks >= forkLimit) {
          throw new PublicApiError({
              httpStatus: 429,
              code: 'RATE_LIMIT_EXCEEDED',
              message:
                  `You have reached the maximum number of quote variations allowed (${forkLimit}). Please contact us to finalize your policy.`,
          });
      }
    }

    // Create a new policy as a clone
    const result = await runTenantScopedTransaction(async (_tx) => {
      const tx = _tx as Prisma.TransactionClient;
        const newPolicyNumber = await reserveNextQuoteId(tx, 'MOTOR');
        const newToken = newPublicSessionToken();

        const newPolicyData: WithoutTenantScope<Prisma.PolicyUncheckedCreateInput> = {
            policyNumber: newPolicyNumber,
            publicSessionToken: newToken,
            productType: 'MOTOR',
            status: 'DRAFT', // Reset status
            inceptionDate: policy.inceptionDate,
            expiryDate: policy.expiryDate,
            policyHolderId: policy.policyHolderId, // Reuse same holder
            // Clone JSON fields explicitly
            quoteData: JSON.parse(JSON.stringify(policy.quoteData || {})),
            vehicleInfo: JSON.parse(JSON.stringify(policy.vehicleInfo || {})),
            driverInfo: JSON.parse(JSON.stringify(policy.driverInfo || {})),
            // Reset Quote/Payment state
            quoteResponse: undefined,
            isLocked: false,
            paymentStatus: 'NOT_REQUIRED',
        };
        const newPolicy = await tx.policy.create({
            data: newPolicyData as Prisma.PolicyUncheckedCreateInput,
            select: {
                id: true,
                policyNumber: true,
                publicSessionToken: true,
            },
        });

        // Clone Search Index
        const holder = await tx.policyHolder.findUnique({ where: { id: policy.policyHolderId } });
        const searchIndexData: WithoutTenantScope<Prisma.PolicySearchIndexUncheckedCreateInput> = {
            policyId: newPolicy.id,
            policyNumber: newPolicy.policyNumber,
            insuredName: holder?.name || 'New Submission',
            status: 'DRAFT',
            segment: 'Auto Insurance',
        };
        await tx.policySearchIndex.create({
            data: searchIndexData as Prisma.PolicySearchIndexUncheckedCreateInput,
        });
        await enqueuePolicyListIndexUpdate(tx, newPolicy.id);

        // Clone State
        const stateCreate: WithoutTenantScope<Prisma.PolicyStateCurrentUncheckedCreateInput> = {
            policyId: newPolicy.id,
            snapshot: {
                quoteData: jsonStringify(policy.quoteData),
                step: 'your-quote',
                flow_context: { channel: 'customer_wizard', step: 'quote' },
            },
        };
        await tx.policyStateCurrent.create({
            data: stateCreate as Prisma.PolicyStateCurrentUncheckedCreateInput,
        });

        return newPolicy;
    });

    void AuditLogger.log(
        policy.id,
        'POLICY',
        'AUTO_QUOTE.FORKED',
        'customer',
        'USER',
        { originalPublicId: args.originalPublicId, originalPolicyId: policy.id, newPolicyId: result.id, newReference: result.policyNumber },
        'Customer'
    );

    return { policyId: result.id, reference: result.policyNumber, publicSessionToken: result.publicSessionToken };
}

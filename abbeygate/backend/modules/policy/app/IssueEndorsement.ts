import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import { AuditLogger } from '../../../platform/audit/logger.js';
import { DocumentService } from '../../documents/app/documentService.js';
import { sendEndorsementIssueEmailWithAttachments } from '../../../platform/events/queue.js';
import { enqueuePolicyListIndexUpdate } from '../infra/projections/policyListIndex.js';
import { enqueueIssuedPolicyPack } from './commands/issuedPackEnqueue.js';
import { evaluateEndorsementDocumentActions } from '../../documents/app/endorsementDocumentRules.js';
import { transitionPolicyLifecycle } from './commands/policyLifecycleCommands.js';
import { logger } from '../../../platform/utils/logger.js';
import { computeCancellationFinancials } from '../domain/proration.js';
import type { Prisma } from '@prisma/client';
import { derivePremiumFinancials } from '../domain/premiumFinancials.js';
import {
    isEndorsementTransactionType,
    isRenewalTransactionType,
    VERSION_HISTORY_TRANSACTION_TYPES,
} from '../domain/riskTransactionTypes.js';
import { jsonStringify } from './shared.js';
import { ProductRegistry } from '../domain/ProductRegistry.js';
import { parseRecord } from '../../../platform/json/parseRecord.js';

function parseSnapshot(value: unknown): Record<string, unknown> {
    if (!value) return {};
    if (typeof value === 'string') {
        try {
            return parseRecord(JSON.parse(value));
        } catch {
            return {};
        }
    }
    return parseRecord(value);
}

function jsonParse(str: unknown): unknown {
    if (!str) return {};
    if (typeof str === 'string') {
        try { return JSON.parse(str); } catch { return {}; }
    }
    return str;
}

function resolveRequiredIssuedDocTypes(productType: string | null | undefined): string[] {
    const adapter = productType ? ProductRegistry.getInstance().getAdapter(productType) : null;
    return adapter?.getRequiredIssuedDocTypes() ?? [];
}

/**
 * Read the set of issued-pack doc types that are still missing for a
 * policy. Used post-issuance to populate the response payload's
 * `missingIssuedPackTypes` audit field. Always reads through the
 * tenant-scoped client (this is a read after the issuance transaction
 * has committed; there is no enclosing tx to thread).
 */
async function getMissingIssuedPackTypes(
    policyId: string,
    productType: string | null | undefined,
): Promise<string[]> {
    const requiredTypes = resolveRequiredIssuedDocTypes(productType);
    if (requiredTypes.length === 0) return [];
    const docs = await tenantScopedPrisma.document.findMany({
        where: {
            policyId,
            docPack: 'ISSUED_POLICY_PACK',
            status: 'GENERATED',
            type: { in: requiredTypes },
        },
        orderBy: [{ type: 'asc' }, { version: 'desc' }],
        select: { type: true },
    });
    const generated = new Set<string>();
    for (const d of docs) {
        const t = String(d.type || '').trim();
        if (t) generated.add(t);
    }
    return requiredTypes.filter((t) => !generated.has(t));
}

export interface EndorsementActor {
    id: string | null;
    name: string | null;
    email: string | null;
    role: string | null;
}

export interface IssueEndorsementInput {
    policyId: string;
    riskTransactionId: string;
    actor: EndorsementActor;
    confirmManualRefundAck: boolean;
    correlationId?: string;
}

export type UseCaseResult<T> =
    | { status: 'SUCCESS'; data: T }
    | { status: 'NOT_FOUND' | 'BAD_REQUEST' | 'INVALID_STATUS' | 'MANUAL_REFUND_ACK_REQUIRED' | 'SERVER_ERROR'; error: unknown };

export async function executeIssueEndorsement(
    input: IssueEndorsementInput
): Promise<UseCaseResult<Record<string, unknown>>> {
    const { policyId, riskTransactionId, actor, confirmManualRefundAck, correlationId } = input;

    try {
        const rt = await tenantScopedPrisma.riskTransaction.findFirst({ where: { id: riskTransactionId, policyId } });
        if (!rt) return { status: 'NOT_FOUND', error: { code: 'NOT_FOUND', message: 'Endorsement not found' } };
        const isRenewal = isRenewalTransactionType(rt.transactionType);
        const auditAction: 'ENDORSEMENT.ISSUED' | 'RENEWAL.ISSUED' =
            isRenewal ? 'RENEWAL.ISSUED' : 'ENDORSEMENT.ISSUED';
        if (!isEndorsementTransactionType(rt.transactionType) && !isRenewal) {
            return { status: 'BAD_REQUEST', error: { code: 'BAD_REQUEST', message: 'Not a policy change transaction' } };
        }
        if (String(rt.status || '').toUpperCase() !== 'BOUND') {
            return { status: 'INVALID_STATUS', error: { code: 'INVALID_STATUS', message: 'Policy change transaction must be bound before issue' } };
        }

        const latestPriorBoundForDocs = await tenantScopedPrisma.riskTransaction.findFirst({
            where: {
                policyId,
                status: 'BOUND',
                transactionType: { in: [...VERSION_HISTORY_TRANSACTION_TYPES] },
                transactionNumber: { lt: rt.transactionNumber },
            },
            orderBy: { transactionNumber: 'desc' },
        });

        const baselineSnapshotForDocs = parseSnapshot(jsonParse(latestPriorBoundForDocs?.snapshotFinal));
        const endorsementSnapshotForDocs = parseSnapshot(jsonParse(rt.snapshotFinal ?? rt.snapshotDraft));
        const docDecision = evaluateEndorsementDocumentActions({
            baselineSnapshot: baselineSnapshotForDocs,
            endorsementSnapshot: endorsementSnapshotForDocs,
        });

        logger.info({
            policyId,
            riskTransactionId,
            changedFields: docDecision.changedFields,
            decisionFlags: docDecision.flags,
            requiresEvidencePack: docDecision.requiresEvidencePack,
            reasons: docDecision.reasons,
        }, 'endorsement.doc_rules_evaluated');

        const draftSnap = parseSnapshot(jsonParse(rt.snapshotDraft));
        const workspace = parseRecord(draftSnap.endorsementWorkspace);
        const reasonCodeUpper = String(workspace.reasonCode || rt.changeReason || '').toUpperCase();
        const isCancellationEndorsement = reasonCodeUpper === 'CANCELLATION';

        if (isCancellationEndorsement && !confirmManualRefundAck) {
            return {
                status: 'MANUAL_REFUND_ACK_REQUIRED',
                error: {
                    code: 'MANUAL_REFUND_ACK_REQUIRED',
                    message: 'Manual refund acknowledgement is required before issuing a cancellation endorsement',
                },
            };
        }

        // ADR-0013 — endorsement issuance distinguishes two doc-pack
        // concerns:
        //   1. ENDORSEMENT_PACK — the delta documents (endorsement
        //      schedule etc.). Generated synchronously here so the BO
        //      operator can verify the result on the response. This
        //      doc pack is NOT subject to the spine because it is
        //      delta-specific, not lifecycle-bound; renewals are the
        //      one exception (they regenerate the full issued pack
        //      and use the spine instead).
        //   2. ISSUED_POLICY_PACK — full pack regen, required for
        //      renewals or material endorsements. ALWAYS goes through
        //      the canonical spine (`enqueueIssuedPolicyPack`); no
        //      inline `DocumentService.generate({docPack:
        //      'ISSUED_POLICY_PACK'})` path exists.
        const generatedPacks: string[] = [];
        const requiresIssuedPackRegen = isRenewal || docDecision.requiresEvidencePack;
        logger.info({
            policyId,
            riskTransactionId,
            packs: [
                ...(!isRenewal ? ['ENDORSEMENT_PACK'] : []),
                ...(requiresIssuedPackRegen ? ['ISSUED_POLICY_PACK (spine)'] : []),
            ],
        }, 'endorsement.doc_generation_started');

        const gen = isRenewal
            ? { version: 0, documents: [] }
            : await DocumentService.generate({
                policyId,
                riskTransactionId,
                docPack: 'ENDORSEMENT_PACK',
                source: 'BO',
                generatedByUserId: actor?.id || null,
            });
        if (!isRenewal) {
            generatedPacks.push('ENDORSEMENT_PACK');
        }
        if (requiresIssuedPackRegen) {
            generatedPacks.push('ISSUED_POLICY_PACK');
        }

        logger.info({
            policyId,
            riskTransactionId,
            generatedPacks,
        }, 'endorsement.doc_generation_completed');

        let txIssuedPackEventId: string | null = null;
        await tenantScopedPrisma.$transaction(async (_tx) => {
          const tx = _tx as unknown as Prisma.TransactionClient;
            const policy = await tx.policy.findUnique({ where: { id: policyId } });
            if (!policy) throw new Error('Policy not found');
            const issuedSnapshot = parseSnapshot(jsonParse(rt.snapshotFinal ?? rt.snapshotDraft));
            const issuedQuoteData = parseRecord(issuedSnapshot.quoteData);
            const issuedQuoteResponse = parseRecord(issuedSnapshot.quoteResponse);

            const latestPrior = await tx.riskTransaction.findFirst({
                where: {
                    policyId,
                    status: 'BOUND',
                    transactionType: { in: [...VERSION_HISTORY_TRANSACTION_TYPES] },
                    transactionNumber: { lt: rt.transactionNumber },
                },
                orderBy: { transactionNumber: 'desc' },
            });

            const currPricing = parseRecord(jsonParse(rt.pricingFinal));
            const prevPricing = latestPrior ? parseRecord(jsonParse(latestPrior.pricingFinal)) : {};
            const currPrem = Number(currPricing.premium ?? 0) || 0;
            const prevPrem = Number(prevPricing.premium ?? 0) || 0;
            const delta = currPrem - prevPrem;
            const currency = String(currPricing.currency || prevPricing.currency || 'EUR');

            let premiumDelta = isRenewal ? currPrem : delta;
            let cancellationSnapshot: Record<string, unknown> | null = null;

            if (isCancellationEndorsement) {
                const policyStart = policy.inceptionDate ? new Date(policy.inceptionDate) : new Date();
                const policyEnd = policy.expiryDate ? new Date(policy.expiryDate) : new Date(policyStart.getTime() + 365 * 24 * 60 * 60 * 1000);
                const cancellationDate = rt.effectiveDate ? new Date(rt.effectiveDate) : new Date();
                const policyQuoteData = parseRecord(policy.quoteData ? jsonParse(policy.quoteData) : null);
                const nonRefundedFixedAmount = Number(policyQuoteData.nonRefundedFixedAmount ?? 0) || 0;
                const nonRefundedPct = Number(policyQuoteData.nonRefundedPct ?? 0) || 0;
                const grossPremium = Math.max(0, Number(prevPricing.premium ?? currPrem ?? 0) || 0);

                const financials = computeCancellationFinancials({
                    grossPremium,
                    policyStart,
                    policyEnd,
                    cancellationDate,
                    nonRefundedFixedAmount,
                    nonRefundedPct,
                });
                premiumDelta = -Math.abs(financials.refundAmount);

                cancellationSnapshot = {
                    type: 'cancellation',
                    policyStart: policyStart.toISOString(),
                    policyEnd: policyEnd.toISOString(),
                    cancellationDate: cancellationDate.toISOString(),
                    grossPremium,
                    ...financials,
                };

                await transitionPolicyLifecycle({
                    tx,
                    policyId,
                    to: 'CANCELLATION_REQUESTED',
                    actorId: actor?.id || 'system',
                    actorType: 'USER',
                    reasonCode: 'ENDORSEMENT_CANCELLATION_ISSUE',
                    correlationId: correlationId || undefined,
                });
                await transitionPolicyLifecycle({
                    tx,
                    policyId,
                    to: 'CANCELLED',
                    actorId: actor?.id || 'system',
                    actorType: 'USER',
                    reasonCode: 'ENDORSEMENT_CANCELLATION_ISSUE',
                    correlationId: correlationId || undefined,
                    causationId: 'POLICY.CANCELLATION_REQUESTED',
                });

                await tx.policy.update({
                    where: { id: policyId },
                    data: { expiryDate: cancellationDate },
                });

                const currState = await tx.policyStateCurrent.findUnique({ where: { policyId } });
                const prevSnapshot = parseSnapshot(currState?.snapshot);
                const prevCancellationRequest = parseRecord(prevSnapshot.cancellationRequest);

                await tx.policyStateCurrent.upsert({
                    where: { policyId },
                    update: {
                        snapshot: jsonStringify({
                            ...prevSnapshot,
                            cancellationRequest: {
                                ...prevCancellationRequest,
                                status: 'CANCELLED',
                                issuedAt: new Date().toISOString(),
                                issuedBy: actor?.id || 'system',
                            },
                            flow_context: { channel: 'backoffice', step: 'service' },
                        }),
                    },
                    create: {
                        policyId,
                        snapshot: jsonStringify({
                            cancellationRequest: {
                                status: 'CANCELLED',
                                issuedAt: new Date().toISOString(),
                                issuedBy: actor?.id || 'system',
                            },
                            flow_context: { channel: 'backoffice', step: 'service' },
                        }),
                    } as unknown as Prisma.PolicyStateCurrentUncheckedCreateInput,
                });

                await tx.policySearchIndex.update({
                    where: { policyId },
                    data: { status: 'CANCELLED' },
                }).catch(() => undefined);

                if (financials.refundAmount > 0) {
                    const requestPayload: Prisma.InputJsonValue = JSON.parse(JSON.stringify({
                        source: 'endorsement.issue.cancellation',
                        note: 'Manual refund required via Billing tab',
                        cancellation: cancellationSnapshot,
                    }));
                    const responsePayload: Prisma.InputJsonValue = JSON.parse(JSON.stringify({
                        note: `Cancellation credit created (${financials.refundAmount.toFixed(2)} ${currency})`,
                    }));
                    await tx.payment.create({
                        data: {
                            policyId,
                            riskTransactionId,
                            provider: 'SYSTEM',
                            purpose: 'CANCELLATION_CREDIT',
                            initiatedBy: 'BO',
                            amount: financials.refundAmount,
                            currency,
                            paymentType: 'RF',
                            status: 'CREDIT_CREATED',
                            requestPayload,
                            responsePayload,
                        } as unknown as Prisma.PaymentUncheckedCreateInput,
                    });
                }
            }

            // Apply issued endorsement snapshot to canonical policy records.
            // This ensures post-issue reads (client dashboard, BO reads, APIs)
            // see the endorsed quoteData/quoteResponse immediately.
            await tx.policy.update({
                where: { id: policyId },
                data: {
                    quoteData: JSON.parse(JSON.stringify(issuedQuoteData)) as Prisma.InputJsonValue,
                    quoteResponse: JSON.parse(JSON.stringify(issuedQuoteResponse)) as Prisma.InputJsonValue,
                    ...(isRenewal ? {
                        inceptionDate: rt.effectiveDate || undefined,
                        expiryDate: rt.expiryDate || undefined,
                    } : {}),
                },
            });
            await tx.policyStateCurrent.upsert({
                where: { policyId },
                update: { snapshot: jsonStringify(issuedSnapshot) },
                create: { policyId, snapshot: jsonStringify(issuedSnapshot) } as unknown as Prisma.PolicyStateCurrentUncheckedCreateInput,
            });
            await enqueuePolicyListIndexUpdate(tx, policyId);

            const binder = policy.binderId
                ? await tx.binder.findUnique({
                    where: { id: policy.binderId },
                    include: { financials: true },
                })
                : null;
            const binderFinancials = binder?.financials || null;
            const pricingQuoteResponse = parseRecord(currPricing.quoteResponse);
            const premiumFinancials = derivePremiumFinancials({
                grossPremium: premiumDelta,
                quoteResponse: pricingQuoteResponse,
                binder: parseRecord(binder),
                binderFinancials,
                riskTransactionType: rt.transactionType,
                premiumTransactionType: isRenewal ? 'ORIGINAL' : (premiumDelta >= 0 ? 'ADDITIONAL' : 'RETURN'),
            });
            await tx.premiumTransaction.create({
                data: {
                    riskTransactionId,
                    transactionType: isRenewal ? 'ORIGINAL' : (premiumDelta >= 0 ? 'ADDITIONAL' : 'RETURN'),
                    currency,
                    grossPremium: premiumFinancials.grossPremium,
                    commissionPercent: premiumFinancials.commissionPercent,
                    commissionAmount: premiumFinancials.commissionAmount,
                    taxesTotal: premiumFinancials.taxesTotal,
                    feesTotal: premiumFinancials.feesTotal,
                    netToLondon: premiumFinancials.netToLondon,
                },
            });

            await tx.riskTransaction.update({
                where: { id: riskTransactionId },
                data: {
                    issuedByUserId: actor?.id || null,
                    pricingFinal: jsonStringify({
                        ...currPricing,
                        cancellationSnapshot: cancellationSnapshot || undefined,
                        documentDecision: {
                            changedFields: docDecision.changedFields,
                            decisionFlags: docDecision.flags,
                            requiresEvidencePack: docDecision.requiresEvidencePack,
                            reasons: docDecision.reasons,
                            unknownCriticalDiff: docDecision.unknownCriticalDiff,
                            generatedPacks,
                            evaluatedAt: new Date().toISOString(),
                        },
                    }),
                },
            });

            // ADR-0013 — every endorsement that requires an issued
            // pack regeneration (renewals + material endorsements
            // identified by `docDecision.requiresEvidencePack`) goes
            // through the canonical spine. The outbox row is
            // committed atomically with the risk-transaction update,
            // so the regen is durable iff the issuance commits.
            // Idempotency key keys off the riskTransactionId so
            // endorsement re-issuance dedupes at the relay.
            if (requiresIssuedPackRegen) {
                const docEvent = await enqueueIssuedPolicyPack(tx, {
                    policyId,
                    riskTransactionId,
                    source: 'BO',
                    generatedByUserId: actor?.id || null,
                    idempotencyKey: `issued-pack:${policyId}:${riskTransactionId}`,
                    correlationId: correlationId || undefined,
                });
                txIssuedPackEventId = docEvent.eventId;
            }
        });

        const policyForDocs = await tenantScopedPrisma.policy.findUnique({ where: { id: policyId }, select: { productType: true } });
        // Post-tx visibility read: surfaces any docs still missing
        // even after the transaction committed (the spine outbox row
        // exists but the worker has not yet generated). Used only for
        // audit + response payload, never for control flow.
        const missingIssuedPackTypes = await getMissingIssuedPackTypes(
            policyId,
            policyForDocs?.productType,
        );
        const issuedPackJobId: string | null = txIssuedPackEventId;

        const adapterForEmail = ProductRegistry.getInstance().getAdapter(
            String(policyForDocs?.productType || '').toUpperCase(),
        );
        const requiredIssuedDocTypesForEmail = adapterForEmail?.getRequiredIssuedDocTypes() ?? [];
        const requiredEndorsementDocTypesForEmail = (() => {
            const docTypes = adapterForEmail?.getDocumentTypes() ?? {};
            const endorsementTypes = Object.keys(docTypes).filter((k) => k.includes('ENDORSEMENT'));
            return endorsementTypes;
        })();

        // ADR-0013 — endorsement email orchestration.
        //  * Renewals: skip the inline endorsement email entirely. The
        //    spine handler regenerates the issued pack and triggers
        //    the welcome-pack email path (idempotent — no double-send).
        //  * Material endorsements (`requiresEvidencePack`): the issued
        //    pack is regenerated by the spine. Since the spine is
        //    async, the inline call would race the worker; emit
        //    `ASYNC_DOCS_PENDING` as the missing-types signal so BO sees
        //    the email is deferred. The worker spine handler is the
        //    canonical follow-up sender (tracked: spine endorsement
        //    email dispatch).
        //  * Endorsement-only deltas: send inline (all attachments are
        //    delta docs that were generated synchronously above).
        const endorsementEmail = isRenewal
            ? { sent: true, missingTypes: [], fallbackTypes: [], attachmentTypes: [] }
            : requiresIssuedPackRegen
            ? { sent: false, missingTypes: ['ASYNC_DOCS_PENDING'], fallbackTypes: [], attachmentTypes: [] }
            : await sendEndorsementIssueEmailWithAttachments({
                policyId,
                riskTransactionId,
                includeEvidencePack: false,
                requiredIssuedDocTypes: requiredIssuedDocTypesForEmail,
                requiredEndorsementDocTypes: requiredEndorsementDocTypesForEmail,
            });

        if (!endorsementEmail.sent) {
            logger.warn({
                policyId,
                riskTransactionId,
                missingTypes: endorsementEmail.missingTypes,
                fallbackTypes: endorsementEmail.fallbackTypes,
                attachmentTypes: endorsementEmail.attachmentTypes,
            }, 'endorsement.email.retry_required');
        }

        const endorsementMeta = parseRecord(draftSnap.endorsementMeta);
        void AuditLogger.log(policyId, 'POLICY', auditAction, actor?.id || 'system', 'USER', {
            riskTransactionId,
            documentCount: gen?.documents?.length || 0,
            docDecision: {
                changedFields: docDecision.changedFields,
                decisionFlags: docDecision.flags,
                requiresEvidencePack: docDecision.requiresEvidencePack,
                reasons: docDecision.reasons,
                unknownCriticalDiff: docDecision.unknownCriticalDiff,
                generatedPacks,
            },
            issuedPackJobId: issuedPackJobId || undefined,
            missingIssuedPackTypes: missingIssuedPackTypes.length ? missingIssuedPackTypes : undefined,
            customerComms: {
                sent: endorsementEmail.sent,
                missingTypes: endorsementEmail.missingTypes.length ? endorsementEmail.missingTypes : undefined,
                fallbackTypes: endorsementEmail.fallbackTypes.length ? endorsementEmail.fallbackTypes : undefined,
                attachmentTypes: endorsementEmail.attachmentTypes,
            },
            reasonCode: String(workspace.reasonCode || rt.changeReason || '').trim() || undefined,
            cancellation: isCancellationEndorsement || undefined,
            renewal: isRenewal || undefined,
            driversDelta: endorsementMeta.driversDelta,
        }, actor?.name ?? undefined);

        return {
            status: 'SUCCESS',
            data: {
                status: 'ISSUED',
                riskTransactionId,
                issuedPackJobId,
                missingIssuedPackTypes,
                customerComms: endorsementEmail,
            },
        };
    } catch (error: unknown) {
        logger.error({ err: error }, 'Issue endorsement error:');
        const message = error instanceof Error ? error.message : 'Failed to issue endorsement';
        return { status: 'SERVER_ERROR', error: { code: 'SERVER_ERROR', message } };
    }
}

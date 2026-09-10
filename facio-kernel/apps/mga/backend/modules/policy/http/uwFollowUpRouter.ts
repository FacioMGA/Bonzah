import type { Prisma } from '@prisma/client';
/**
 * UW Follow-Up & Questionnaire routes.
 * CHAMPS: Extracted from uwRouter.ts god-file decomposition.
 *
 * POST /:id/send-questionnaire
 * POST /:id/send-follow-up-batch
 */
import type { Router } from 'express';
import { tenantScopedPrisma, runTenantScopedTransaction } from '../../../platform/db/connection.js';
import { AuditLogger } from '../../../platform/audit/logger.js';
import { sendAutoQuoteInviteEmail, sendUwQuestionnaireRequestEmail } from '../app/communicationsInterop.js';
import { jsonParse, jsonStringify } from '../app/shared.js';
import { transitionUwWorkflow } from '../app/commands/uwWorkflowCommands.js';
import { logger } from '../../../platform/utils/logger.js';
import { resolveProductAvailability } from '../../jurisdiction/app/productAvailability.js';

import {
    FollowUpBatchBodySchema,
    SendQuestionnaireBodySchema,
    parseRecord,
    sendError,
    errorMessage,
    actorFromRequest,
    getBaseUrl,
    ensureVerifiedContactEmail,
    ensurePolicyPublicSessionToken,
    parseSnapshotMaybe,
    normalizeStepKey,
    defaultCustomerQuoteStep,
    mapFollowUpsForQuoteData,
    policyAuditLog,
} from './uwHelpers.js';

export function registerUwFollowUpRoutes(router: Router) {
    /**
     * POST /api/policies/:id/send-questionnaire
     * Send a questionnaire to the insured
     */
    router.post('/:id/send-questionnaire', policyAuditLog, async (req, res) => {
        try {
            const { id } = req.params;
            const parsedBody = SendQuestionnaireBodySchema.safeParse(req.body);
            const questionnaireId = parsedBody.success ? parsedBody.data.questionnaireId : undefined;
            const kind = parsedBody.success ? parsedBody.data.kind : undefined;

            logger.info(`Sending questionnaire ${questionnaireId || '(auto)'} for policy ${id}`);

            // 1. Fetch Policy & Holder
            const policy = await tenantScopedPrisma.policy.findUnique({
                where: { id },
                include: { policyHolder: true, stateCurrent: true }
            });

            if (!policy || !policy.policyHolder) {
                return sendError(res, 404, 'NOT_FOUND', 'Policy or Policy Holder not found');
            }

            if (!policy.productType) {
                return sendError(res, 400, 'PRODUCT_TYPE_REQUIRED', 'Policy has no product type; cannot open a customer quote session');
            }
            const availability = resolveProductAvailability(policy.productType);
            if (!availability.available) {
                return sendError(res, 403, 'PRODUCT_UNAVAILABLE', availability.message);
            }

            // 2. Extract Contact Info
            const actor = actorFromRequest(req);
            const actorRole = String(actor.role || '').toUpperCase();
            const requireVerified = actorRole === 'CLIENT' || actorRole === 'POLICYHOLDER' || actorRole === 'CUSTOMER';
            const verifiedContact = await ensureVerifiedContactEmail(policy, res, { requireVerified });
            if (!verifiedContact.ok) return;
            const { email, contactName } = verifiedContact;

            // 3. Generate Link
            const baseUrl = getBaseUrl(req);
            const token = await ensurePolicyPublicSessionToken(id, policy.publicSessionToken);
            const productParam = encodeURIComponent(String(policy.productType).trim().toLowerCase());
            let autoQuoteUrl = `${baseUrl}/quote/${token}?step=policy-holder&product=${productParam}`;
            let syncedQuoteData = parseRecord(policy.quoteData);

            // If there are outstanding follow-ups, deep-link customer to the first follow-up field.
            try {
                const snap = parseSnapshotMaybe(policy.stateCurrent?.snapshot);
                const uw = parseRecord(snap.smartUwFormData);
                const outstanding = Array.isArray(uw.outstandingRequests) ? uw.outstandingRequests : [];
                const drafts = Array.isArray(uw.followUpRequests) ? uw.followUpRequests : [];
                const combined = [...outstanding, ...drafts];
                const mapped = mapFollowUpsForQuoteData(combined);

                if (mapped.length > 0) {
                    const prevQuoteData = parseRecord(policy.quoteData);
                    const prevReqs = Array.isArray(prevQuoteData.__followUpRequests) ? prevQuoteData.__followUpRequests : [];
                    const existing = new Set(prevReqs.map((item: unknown) => {
                        const r = parseRecord(item);
                        return `${String(r.fieldKey || '')}::${String(r.note || '')}::${String(r.type || '')}`;
                    }));
                    const mergedNew = mapped.filter((r) => !existing.has(`${r.fieldKey}::${r.note}::${r.type}`));
                    const nextQuoteData = {
                        ...prevQuoteData,
                        __followUpRequests: [...prevReqs, ...mergedNew],
                        __meta: { ...parseRecord(prevQuoteData.__meta), lastFollowUpRequestedAt: new Date().toISOString() },
                    };
                    syncedQuoteData = nextQuoteData;
                    await tenantScopedPrisma.policy.update({ where: { id }, data: { quoteData: nextQuoteData } }).catch(() => undefined);

                    const first = mergedNew[0] || prevReqs[0] || mapped[0];
                    const stepKey = normalizeStepKey(first?.stepKey) || defaultCustomerQuoteStep(policy.productType);
                    const focus = String(first?.fieldKey || '').trim();
                    autoQuoteUrl = `${baseUrl}/quote/${token}?step=${encodeURIComponent(stepKey)}&followUp=1&focus=${encodeURIComponent(focus)}&product=${productParam}`;
                }
            } catch {
                // ignore
            }

            // 4. Send Email
            const inviteKind: 'initial' | 'resend' = (kind === 'initial' || kind === 'resend') ? kind : 'resend';
            const firstName = String(contactName || '').trim().split(/\s+/)[0] || 'there';
            const success = await sendUwQuestionnaireRequestEmail({
                toEmail: email,
                firstName,
                applicationUrl: autoQuoteUrl,
                policyId: id,
                productCode: policy.productType,
            });

            if (success) {
                // Persist for cross-user visibility (BFF merges snapshot into GET /policies/:id)
                await runTenantScopedTransaction(async (_tx) => {
                  const tx = _tx as unknown as Prisma.TransactionClient;
                    const currentState = await tx.policyStateCurrent.findUnique({ where: { policyId: id } });
                    const prevSnapshot = currentState ? parseSnapshotMaybe(jsonParse(currentState.snapshot)) : {};
                    const nextSnapshot = {
                        ...prevSnapshot,
                        quoteData: syncedQuoteData,
                        customerFlow: {
                            ...parseRecord(prevSnapshot.customerFlow),
                            inviteSentAt: new Date().toISOString(),
                            inviteKind,
                            inviteTo: email,
                            quoteUrl: autoQuoteUrl,
                            // Clear superseded state — a new invitation for the current product is now active.
                            questionnaireSupersededAt: null,
                            supersededProductType: null,
                        }
                    };
                    await tx.policyStateCurrent.upsert({
                        where: { policyId: id },
                        update: { snapshot: jsonStringify(nextSnapshot) },
                        create: { policyId: id, snapshot: jsonStringify(nextSnapshot) } as unknown as Prisma.PolicyStateCurrentUncheckedCreateInput
                    });
                    await transitionUwWorkflow({
                        tx,
                        policyId: id,
                        to: 'QUESTIONNAIRE_SENT',
                        actorId: String(actor.id || 'system'),
                        actorType: 'UNDERWRITER',
                        reasonCode: 'QUESTIONNAIRE_SENT',
                        correlationId: req.correlationId,
                        data: { inviteKind, inviteTo: email },
                    }).catch(() => undefined);
                });
            }

            if (success) {
                // Audit Log
                const auditActor = actorFromRequest(req);
                const actorName = auditActor.name || auditActor.email || 'Unknown User';
                void AuditLogger.log(id, 'POLICY', 'QUESTIONNAIRE.SENT', String(auditActor.id || 'system'), 'USER', {
                    recipient: email,
                    recipientName: contactName,
                    type: 'Questionnaire Request',
                    link: autoQuoteUrl,
                }, String(actorName || 'Unknown User'));

                return res.json({
                    success: true,
                    data: {
                        sentAt: new Date(),
                        recipient: email,
                        kind: inviteKind,
                        link: autoQuoteUrl,
                    }
                });
            } else {
                return sendError(res, 500, 'EMAIL_PROVIDER_ERROR', 'Failed to dispatch email');
            }
        } catch (error) {
            logger.error({ err: error }, 'Send questionnaire error:');
            return sendError(res, 500, 'SEND_ERROR', errorMessage(error, 'Failed to send questionnaire'));
        }
    });

    /**
     * POST /api/policies/:id/send-follow-up-batch
     * Send list of questions to policy holder
     */
    router.post('/:id/send-follow-up-batch', policyAuditLog, async (req, res) => {
        try {
            const { id } = req.params;
            const parsedBody = FollowUpBatchBodySchema.safeParse(req.body);
            if (!parsedBody.success) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid request body');
            }

            const policy = await tenantScopedPrisma.policy.findUnique({
                where: { id },
                include: { policyHolder: true }
            });
            if (!policy || !policy.policyHolder) {
                return sendError(res, 404, 'NOT_FOUND', 'Policy not found');
            }
            if (!policy.productType) {
                return sendError(res, 400, 'PRODUCT_TYPE_REQUIRED', 'Policy has no product type; cannot open a customer quote session');
            }
            const availability = resolveProductAvailability(policy.productType);
            if (!availability.available) {
                return sendError(res, 403, 'PRODUCT_UNAVAILABLE', availability.message);
            }

            const verifiedContact = await ensureVerifiedContactEmail(policy, res);
            if (!verifiedContact.ok) return;
            const { email, contactName } = verifiedContact;

            const baseUrl = getBaseUrl(req);
            const token = await ensurePolicyPublicSessionToken(id, policy.publicSessionToken);
            const productParam = encodeURIComponent(String(policy.productType).trim().toLowerCase());

            const incoming = mapFollowUpsForQuoteData(parsedBody.data.requests as unknown[]).filter((r) => r.fieldKey && r.question);

            if (!incoming.length) {
                return sendError(res, 400, 'INVALID_REQUEST', 'Requests must include fieldKey + question');
            }

            const prevQuoteData = parseRecord(policy.quoteData);
            const prevReqs = Array.isArray(prevQuoteData.__followUpRequests) ? prevQuoteData.__followUpRequests : [];

            const dedupeKey = (item: unknown) => {
                const r = parseRecord(item);
                return `${String(r.fieldKey || '').trim()}::${String(r.note || '').trim()}::${String(r.type || '').trim()}`;
            };
            const existingKeys = new Set(prevReqs.map(dedupeKey));
            const mergedNew = incoming.filter((r) => !existingKeys.has(dedupeKey(r)));
            const nextQuoteData = {
                ...prevQuoteData,
                __followUpRequests: [...prevReqs, ...mergedNew],
                __meta: { ...parseRecord(prevQuoteData.__meta), lastFollowUpRequestedAt: new Date().toISOString() },
            };

            await runTenantScopedTransaction(async (_tx) => {
              const tx = _tx as unknown as Prisma.TransactionClient;
                await tx.policy.update({ where: { id }, data: { quoteData: nextQuoteData } });
                const currentState = await tx.policyStateCurrent.findUnique({ where: { policyId: id } });
                const prevSnapshot = currentState ? parseSnapshotMaybe(jsonParse(currentState.snapshot)) : {};
                const nextSnapshot = {
                    ...prevSnapshot,
                    quoteData: nextQuoteData,
                };
                await tx.policyStateCurrent.upsert({
                    where: { policyId: id },
                    update: { snapshot: jsonStringify(nextSnapshot) },
                    create: { policyId: id, snapshot: jsonStringify(nextSnapshot) } as unknown as Prisma.PolicyStateCurrentUncheckedCreateInput,
                });
            });

            const first = mergedNew[0] || prevReqs[0] || incoming[0];
            const stepKey = normalizeStepKey(first?.stepKey) || defaultCustomerQuoteStep(policy.productType);
            const focus = String(first?.fieldKey || '').trim();
            const quoteUrl = `${baseUrl}/quote/${token}?step=${encodeURIComponent(stepKey)}&followUp=1&focus=${encodeURIComponent(focus)}&product=${productParam}`;

            const success = await sendAutoQuoteInviteEmail({
                toEmail: email,
                contactName,
                insuredName: policy.policyHolder.name,
                quoteUrl,
                kind: 'resend',
                policyId: id,
                productCode: policy.productType,
            });

            if (success) {
                const actor = actorFromRequest(req);
                void AuditLogger.log(id, 'POLICY', 'FOLLOW_UP.SENT', String(actor.id || 'system'), 'USER', {
                    recipient: email,
                    followUpCount: incoming.length,
                    link: quoteUrl,
                });
                return res.json({ success: true, message: 'Batch sent', data: { link: quoteUrl } });
            }

            return res.status(500).json({ success: false, message: 'Failed to send email' });

        } catch (error) {
            logger.error({ err: error }, 'Send batch error:');
            return res.status(500).json({ success: false, message: 'Server error' });
        }
    });
}

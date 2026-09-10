import type { Prisma } from '@prisma/client';
/**
 * UW Decision routes (workflow transitions).
 * CHAMPS: Extracted from uwRouter.ts god-file decomposition.
 *
 * POST /:id/uw/request-info
 */
import type { Router } from 'express';
import { tenantScopedPrisma, runTenantScopedTransaction } from '../../../platform/db/connection.js';
import { AuditLogger } from '../../../platform/audit/logger.js';
import { jsonStringify } from '../app/shared.js';
import { enqueuePolicyListIndexUpdate } from '../app/policyListIndex.js';
import { transitionPolicyLifecycle } from '../app/commands/policyLifecycleCommands.js';
import { transitionUwWorkflow } from '../app/commands/uwWorkflowCommands.js';
import { logger } from '../../../platform/utils/logger.js';

import {
    RequestInfoBodySchema,
    parseRecord,
    getMethod,
    sendError,
    errorMessage,
    actorFromRequest,
    getBaseUrl,
    ensureVerifiedContactEmail,
    ensurePolicyPublicSessionToken,
    parseSnapshotMaybe,
    policyAuditLog,
} from './uwHelpers.js';

export function registerUwDecisionRoutes(router: Router) {
    /**
     * POST /api/policies/:id/uw/request-info
     * Transition: REFERRAL -> INFO_REQUIRED (Yellow lane)
     * Sends customer a secure resume link + message.
     */
    router.post('/:id/uw/request-info', policyAuditLog, async (req, res) => {
        try {
            const { id } = req.params;
            const parsedBody = RequestInfoBodySchema.safeParse(req.body);
            const message = parsedBody.success ? parsedBody.data.message : undefined;
            const requestedStep = parsedBody.success ? parsedBody.data.requestedStep : undefined;

            const policy = await tenantScopedPrisma.policy.findUnique({
                where: { id },
                include: { policyHolder: true, stateCurrent: true }
            });
            if (!policy) return sendError(res, 404, 'NOT_FOUND', 'Policy not found');

            const currentStatus = String(policy.status || '').toUpperCase();
            if (currentStatus !== 'REFERRAL') {
                return sendError(res, 400, 'BAD_REQUEST', `Cannot request info from status '${policy.status}'`);
            }

            const verifiedContact = await ensureVerifiedContactEmail(policy, res);
            if (!verifiedContact.ok) return;
            const { email: to } = verifiedContact;

            const baseUrl = getBaseUrl(req);
            const token = await ensurePolicyPublicSessionToken(id, policy.publicSessionToken);
            const customerLink = `${baseUrl}/quote/${token}${requestedStep ? `#${requestedStep}` : ''}`;

            const prevSnapshot = parseSnapshotMaybe(policy.stateCurrent?.snapshot);
            const actor = actorFromRequest(req);
            const nextSnapshot = {
                ...prevSnapshot,
                infoRequest: {
                    requestedAt: new Date().toISOString(),
                    requestedBy: actor.id || 'user',
                    requestedStep: requestedStep || null,
                    message: message || null,
                },
                flow_context: { channel: 'backoffice', step: 'underwriting' },
            };

            await runTenantScopedTransaction(async (_tx) => {
              const tx = _tx as unknown as Prisma.TransactionClient;
                await transitionPolicyLifecycle({
                    tx,
                    policyId: id,
                    to: 'INFO_REQUIRED',
                    actorId: String(actor.id || 'system'),
                    actorType: 'USER',
                    reasonCode: 'UW_INFO_REQUESTED',
                    correlationId: req.correlationId,
                    data: { requestedStep: requestedStep || null },
                });
                await transitionUwWorkflow({
                    tx,
                    policyId: id,
                    to: 'FOLLOWUPS_OPEN',
                    actorId: String(actor.id || 'system'),
                    actorType: 'UNDERWRITER',
                    reasonCode: 'UW_INFO_REQUESTED',
                    correlationId: req.correlationId,
                }).catch(() => undefined);
                await tx.policySearchIndex.update({ where: { policyId: id }, data: { status: 'INFO_REQUIRED' } }).catch(() => undefined);
                await enqueuePolicyListIndexUpdate(tx, id);
                await tx.policyStateCurrent.upsert({
                    where: { policyId: id },
                    update: { snapshot: jsonStringify(nextSnapshot) },
                    create: { policyId: id, snapshot: jsonStringify(nextSnapshot) } as unknown as Prisma.PolicyStateCurrentUncheckedCreateInput
                });

                // Customer notification (best-effort)
                const outboxObj = parseRecord(parseRecord(tx).outbox);
                const createOutbox = getMethod(outboxObj, 'create');
                if (createOutbox) {
                    await Promise.resolve(
                        createOutbox({
                            data: {
                                eventType: 'EMAIL.INFO_REQUIRED',
                                aggregateId: id,
                                payload: {
                                    policyId: id,
                                    policyNumber: policy.policyNumber,
                                    to,
                                    message,
                                    requestedStep,
                                    customerLink,
                                },
                            },
                        })
                    ).catch(() => undefined);
                }
            });

            void AuditLogger.log(id, 'POLICY', 'UW.INFO_REQUIRED', String(actor.id || 'system'), 'USER', { requestedStep, to: to || null }, String(actor.name || 'System'));

            return res.json({ success: true, data: { status: 'INFO_REQUIRED', customerLink } });
        } catch (error) {
            logger.error({ err: error }, 'Request info error:');
            return sendError(res, 500, 'SERVER_ERROR', errorMessage(error, 'Failed to request info'));
        }
    });
}

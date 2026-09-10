import { CommunicationsService } from '../communicationsService.js';
import { prisma } from '../../../../platform/db/connection.js';
import { Prisma } from '@prisma/client';
import { logger } from '../../../../platform/utils/logger.js';
import type { SendMessageInput, CommunicationType } from '../../domain/types.js';

function toInputJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

/**
 * SendMessageCommand — App-layer orchestrator for creating a communication.
 *
 * Responsibilities:
 * 1. Get or create thread for the subject entity
 * 2. Create the message with transactional outbox event
 * 3. Trigger async side-effects (claim instrumentation, email dispatch)
 *    via domain events — NOT inline in the HTTP handler.
 */
export class SendMessageCommand {
    async execute(input: SendMessageInput) {
        // 1. Resolve thread
        const thread = await CommunicationsService.getOrCreateThread(
            input.entityType,
            input.entityId,
            input.primaryPartyId,
        );

        // 2. Derive communication type
        const communicationType: CommunicationType =
            input.communicationType ??
            (input.direction === 'INTERNAL' ? 'INTERNAL_NOTE' : 'EXTERNAL');

        // 3. Create message (includes outbox event for OUTBOUND+QUEUED)
        const message = await CommunicationsService.createMessage(thread.id, {
            direction: input.direction,
            channel: input.channel,
            provider: input.provider,
            fromActor: input.fromActor,
            toRecipients: input.toRecipients,
            subject: input.subject,
            body: input.body,
            attachments: toInputJson(input.attachments ?? []),
            status: input.status,
            communicationType,
            externalRefs: toInputJson(input.externalRefs ?? {
                template: input.templateId
                    ? {
                        templateId: input.templateId,
                        templateName: input.templateName,
                        variables: input.templateVariables,
                        renderedBody: input.renderedBody,
                        renderedSubject: input.renderedSubject,
                        missingVariables: input.missingVariables,
                        approvalRequired: input.approvalRequired,
                    }
                    : undefined,
                approval: input.approvalState
                    ? {
                        state: input.approvalState,
                        requestedBy: input.approvalState === 'PENDING' ? input.fromActor : undefined,
                        requestedAt: input.approvalState === 'PENDING' ? new Date().toISOString() : undefined,
                    }
                    : undefined,
            }),
            idempotencyKey: input.idempotencyKey,
        });

        // 4. Async claim instrumentation (fire-and-forget)
        if (input.entityType === 'CLAIM') {
            setImmediate(() => {
                void this.instrumentClaim(input, message.id).catch((err) => {
                    logger.error(
                        { event: 'comms.claim_instrumentation.failed', err, claimId: input.entityId },
                        'comms.claim_instrumentation.failed',
                    );
                });
            });
        }

        return message;
    }

    // ── Claim instrumentation ─────────────────────────────────────────────
    private async instrumentClaim(input: SendMessageInput, _messageId: string) {
        const { executeClaimWorksheetCommand } = await import('../claimsInterop.js');

        const actorId = String(input.fromActor || 'system');
        const actor =
            actorId && actorId !== 'system'
                ? await prisma.user.findUnique({
                      where: { id: actorId },
                      select: { id: true, role: true, name: true },
                  })
                : null;
        const actorType = this.actorTypeFromRole(actor?.role);
        const actorName = String(actor?.name || '');

        const commandInput = {
            actorType,
            actorId: String(actor?.id || actorId),
            actorName,
        };

        await executeClaimWorksheetCommand({
            claimId: input.entityId,
            type:
                input.direction === 'OUTBOUND'
                    ? 'LOG_COMMUNICATION_SENT'
                    : 'LOG_COMMUNICATION_RECEIVED',
            payload: {
                communicationType: String(input.claimMeta?.communicationType || 'GENERAL'),
                partyType: String(input.claimMeta?.partyType || 'FIRST_PARTY'),
                channel: String(input.channel || ''),
                occurredAt: new Date().toISOString(),
            },
            input: commandInput,
        });

        if (input.direction === 'OUTBOUND') {
            await executeClaimWorksheetCommand({
                claimId: input.entityId,
                type: 'ACKNOWLEDGE_CLAIM',
                payload: {
                    acknowledgedAt: new Date().toISOString(),
                    channel: String(input.channel || ''),
                },
                input: commandInput,
            });
        }
    }

    // ── Helpers ──────────────────────────────────────────────────────────
    private actorTypeFromRole(
        roleRaw: unknown,
    ): 'USER' | 'SYSTEM' | 'CUSTOMER' | 'UNDERWRITER' | 'OPS' {
        const role = String(roleRaw || '').toUpperCase();
        if (role === 'CUSTOMER') return 'CUSTOMER';
        if (role === 'UNDERWRITER') return 'UNDERWRITER';
        if (role === 'ADMIN' || role === 'PROGRAM ADMINISTRATOR') return 'OPS';
        return 'USER';
    }
}

export const sendMessageCommand = new SendMessageCommand();

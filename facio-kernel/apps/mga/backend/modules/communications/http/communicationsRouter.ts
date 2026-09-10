import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { tenantScopedPrisma, runTenantScopedTransaction } from '../../../platform/db/connection.js';
import { sendMessageCommand } from '../app/commands/sendMessageCommand.js';
import { RecipientResolver } from '../app/recipientResolver.js';
import { getCommunicationTimeline, getConversationSummaries, getFailedDeliveries } from '../app/queries/timelineProjections.js';
import { canSendWithoutApproval, canViewInternalNotes, filterMessagesByPermission, guardInternalNoteCreation } from '../app/permissions.js';
import { filterOfficeThreads, officeViewerFromUser } from '../app/officeMessageVisibility.js';
import { generateDrafts } from '../app/draftAssistant.js';
import { suggestNextActions } from '../app/nextBestAction.js';
import { getCrossContextThreads } from '../app/crossContextIntelligence.js';
import { renderTemplate, validateVariables } from '../app/templateRenderService.js';
import { logger } from '../../../platform/utils/logger.js';
import { retryFailedMessage } from '../app/retryFailedMessageUseCase.js';
import { createRestrictedMemoryUpload } from '../../../platform/security/uploadPolicy.js';
import { storageService } from '../../../platform/storage/service.js';
import { buildDomainEvent } from '../../../platform/events/domainEvents.js';

const router = Router();

// ── Input validation schemas ────────────────────────────────────────────────

const CreateMessageSchema = z.object({
    entityType: z.string(),
    entityId: z.string(),
    primaryPartyId: z.string().optional(),
    direction: z.string(),
    channel: z.string(),
    provider: z.string(),
    fromActor: z.string().optional(),
    toRecipients: z.array(z.string()),
    subject: z.string().optional(),
    body: z.string().optional(),
    attachments: z.array(z.record(z.string(), z.unknown())).optional(),
    status: z.string().optional(),
    communicationType: z.string().optional(),
    templateId: z.string().optional(),
    templateVariables: z.record(z.string(), z.unknown()).optional(),
    renderedBody: z.string().optional(),
    renderedSubject: z.string().optional(),
    missingVariables: z.array(z.string()).optional(),
    idempotencyKey: z.string().trim().optional(),
    // Claim-specific instrumentation context
    claimCommunicationType: z.string().optional(),
    claimPartyType: z.string().optional(),
});

const ApprovalActionSchema = z.object({
    reason: z.string().optional(),
});

const upload = createRestrictedMemoryUpload({
    maxFileSizeBytes: 10 * 1024 * 1024,
    maxFiles: 5,
    allowedMimeTypes: [
        'application/pdf',
        'image/png',
        'image/jpeg',
        'image/webp',
        'text/plain',
        'text/csv',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],
    allowedExtensions: ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.txt', '.csv', '.docx', '.xlsx'],
});

type AttachmentRef = {
    filename: string;
    size?: number;
    mimetype?: string;
    url?: string;
    storageUri?: string;
    contentBase64?: string;
};

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}

function normalizeAttachments(value: unknown): AttachmentRef[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const attachments = value
        .map((entry) => asRecord(entry))
        .filter((entry) => String(entry.filename || '').trim())
        .map((entry) => ({
            filename: String(entry.filename || '').trim(),
            size: typeof entry.size === 'number' ? entry.size : undefined,
            mimetype: entry.mimetype ? String(entry.mimetype) : undefined,
            url: entry.url ? String(entry.url) : undefined,
            storageUri: entry.storageUri ? String(entry.storageUri) : undefined,
            contentBase64: entry.contentBase64 ? String(entry.contentBase64) : undefined,
        }));
    return attachments.length ? attachments : undefined;
}

// ── GET /api/communications/threads ─────────────────────────────────────────

router.get('/threads', async (req, res) => {
    try {
        const { entityType, entityId } = req.query;

        if (!entityType || !entityId) {
            return res.status(400).json({ success: false, error: { message: 'entityType and entityId are required' } });
        }

        const viewer = officeViewerFromUser(req.user);
        if (String(entityType) === 'OFFICE' && !viewer) {
            return res.json({ success: true, data: [] });
        }

        const threads = await tenantScopedPrisma.communicationThread.findMany({
            where: {
                entityType: String(entityType),
                entityId: String(entityId),
            },
            include: {
                messages: {
                    orderBy: { createdAt: 'desc' },
                    take: 50,
                },
            },
            orderBy: { lastActivityAt: 'desc' },
        });

        const participantScoped = String(entityType) === 'OFFICE' && viewer
            ? filterOfficeThreads(threads, viewer)
            : threads;

        // Filter out internal notes for non-ADMIN/UNDERWRITER users
        const filtered = participantScoped.map((t) => ({
            ...t,
            messages: filterMessagesByPermission(t.messages, req),
        }));

        return res.json({ success: true, data: filtered });
    } catch (error) {
        logger.error({ event: 'comms.threads.fetch_failed', err: error }, 'comms.threads.fetch_failed');
        return res.status(500).json({ success: false, error: { message: 'Failed to get threads' } });
    }
});

// ── GET /api/communications/recipients ──────────────────────────────────────

router.get('/recipients', async (req, res) => {
    try {
        const { entityType, entityId } = req.query;

        if (!entityType || !entityId) {
            return res.status(400).json({ success: false, error: { message: 'entityType and entityId are required' } });
        }

        const recipients = await RecipientResolver.resolveForSubject(
            String(entityType) as 'POLICY' | 'CLAIM' | 'ACCOUNT' | 'QUOTE' | 'INVOICE' | 'PARTY' | 'CASE',
            String(entityId),
        );

        return res.json({ success: true, data: recipients });
    } catch (error) {
        logger.error({ event: 'comms.recipients.resolve_failed', err: error }, 'comms.recipients.resolve_failed');
        return res.status(500).json({ success: false, error: { message: 'Failed to resolve recipients' } });
    }
});

// ── GET /api/communications/timeline ────────────────────────────────────────

router.get('/timeline', async (req, res) => {
    try {
        const { entityType, entityId } = req.query;
        if (!entityType || !entityId) {
            return res.status(400).json({ success: false, error: { message: 'entityType and entityId are required' } });
        }
        const timeline = await getCommunicationTimeline(
            String(entityType),
            String(entityId),
            officeViewerFromUser(req.user),
        );
        const filteredTimeline = canViewInternalNotes(req)
            ? timeline
            : {
                ...timeline,
                items: timeline.items.filter((item) => item.kind !== 'NOTE'),
            };
        return res.json({ success: true, data: filteredTimeline });
    } catch (error) {
        logger.error({ event: 'comms.timeline.fetch_failed', err: error }, 'comms.timeline.fetch_failed');
        return res.status(500).json({ success: false, error: { message: 'Failed to get timeline' } });
    }
});

// ── POST /api/communications/attachments ────────────────────────────────────

router.post('/attachments', upload.array('files', 5), async (req, res) => {
    try {
        const files = Array.isArray(req.files) ? req.files : [];
        if (!files.length) {
            return res.status(400).json({ success: false, error: { message: 'At least one file is required' } });
        }
        const uploaded = await Promise.all(files.map((file) =>
            storageService.uploadFile(file.buffer, file.originalname, file.mimetype),
        ));
        return res.json({
            success: true,
            data: uploaded.map((item, index) => ({
                filename: files[index]?.originalname || item.filename,
                storageUri: item.filename,
                url: item.url,
                mimetype: item.mimetype,
                size: item.size,
            })),
        });
    } catch (error) {
        logger.error({ event: 'comms.attachments.upload_failed', err: error }, 'comms.attachments.upload_failed');
        return res.status(500).json({ success: false, error: { message: 'Failed to upload attachments' } });
    }
});

// ── POST /api/communications/messages ───────────────────────────────────────
// Thin transport shell — all business logic lives in sendMessageCommand.

router.post('/messages', guardInternalNoteCreation, async (req, res) => {
    try {
        const input = CreateMessageSchema.parse(req.body);
        const user = req.user;
        const fromActor = String(input.fromActor || user?.id || 'system').trim();
        const isInternalSender = canSendWithoutApproval(req);

        let templateMeta: {
            templateId: string;
            templateName?: string;
            variables: Record<string, unknown>;
            renderedBody: string;
            renderedSubject?: string | null;
            missingVariables: string[];
            approvalRequired: boolean;
        } | undefined;

        if (input.templateId) {
            const template = await tenantScopedPrisma.communicationTemplate.findUnique({
                where: { id: input.templateId },
            });
            if (!template) {
                return res.status(404).json({ success: false, error: { message: 'Template not found' } });
            }
            const variables = input.templateVariables || {};
            const schema = (template.variablesSchema && typeof template.variablesSchema === 'object')
                ? template.variablesSchema as Record<string, unknown>
                : {};
            const validation = validateVariables(schema, variables);
            const bodyRendered = renderTemplate(template.bodyTemplate, variables);
            const subjectRendered = template.subjectTemplate
                ? renderTemplate(template.subjectTemplate, variables)
                : null;
            templateMeta = {
                templateId: template.id,
                templateName: template.name,
                variables,
                renderedBody: input.renderedBody || bodyRendered.rendered,
                renderedSubject: input.renderedSubject || subjectRendered?.rendered || null,
                missingVariables: Array.from(new Set([
                    ...bodyRendered.missingVariables,
                    ...(subjectRendered?.missingVariables || []),
                    ...(validation.missing || []),
                ])),
                approvalRequired: Boolean(template.approvalRequired),
            };
        }

        const needsApproval = Boolean(templateMeta?.approvalRequired && !isInternalSender);
        const status = needsApproval
            ? 'DRAFT_PENDING_APPROVAL'
            : (input.status as 'QUEUED' | 'LOGGED' | undefined) ?? 'QUEUED';

        const body = templateMeta?.renderedBody || input.body || '';
        const subject = templateMeta?.renderedSubject || input.subject;

        if (!body.trim()) {
            return res.status(400).json({ success: false, error: { message: 'Message body is required' } });
        }

        const message = await sendMessageCommand.execute({
            entityType: input.entityType,
            entityId: input.entityId,
            primaryPartyId: input.primaryPartyId,
            direction: input.direction as 'OUTBOUND' | 'INBOUND' | 'INTERNAL',
            channel: input.channel as 'EMAIL' | 'SMS' | 'WHATSAPP' | 'PHONE_CALL' | 'NOTE' | 'INTERNAL_CHAT' | 'SYSTEM',
            provider: input.provider,
            communicationType: (input.communicationType as 'EXTERNAL' | 'INTERNAL_NOTE' | 'SYSTEM_EVENT') ?? undefined,
            fromActor,
            toRecipients: input.toRecipients,
            subject,
            body,
            attachments: normalizeAttachments(input.attachments),
            status,
            templateId: templateMeta?.templateId,
            templateName: templateMeta?.templateName,
            templateVariables: templateMeta?.variables,
            renderedBody: templateMeta?.renderedBody,
            renderedSubject: templateMeta?.renderedSubject,
            missingVariables: templateMeta?.missingVariables,
            approvalRequired: templateMeta?.approvalRequired,
            approvalState: needsApproval ? 'PENDING' : (templateMeta?.approvalRequired ? 'APPROVED' : 'NONE'),
            claimMeta: input.claimCommunicationType
                ? {
                      communicationType: input.claimCommunicationType,
                      partyType: input.claimPartyType,
                  }
                : undefined,
            idempotencyKey: input.idempotencyKey,
        });

        return res.json({ success: true, data: message });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ success: false, error: { message: error.issues[0]?.message || 'Invalid input' } });
        }
        logger.error({ event: 'comms.message.create_failed', err: error }, 'comms.message.create_failed');
        return res.status(500).json({ success: false, error: { message: 'Failed to create message' } });
    }
});

// ── POST /api/communications/messages/:id/request-approval ──────────────────

router.post('/messages/:id/request-approval', async (req, res) => {
    try {
        const { id } = req.params;
        const body = ApprovalActionSchema.parse(req.body || {});
        const actorId = String(req.user?.id || 'system');
        const message = await tenantScopedPrisma.communicationMessage.findUnique({ where: { id } });
        if (!message) {
            return res.status(404).json({ success: false, error: { message: 'Message not found' } });
        }
        const refs = asRecord(message.externalRefs);
        const nextRefs = {
            ...refs,
            approval: {
                ...asRecord(refs.approval),
                state: 'PENDING',
                requestedBy: actorId,
                requestedAt: new Date().toISOString(),
                reason: body.reason || '',
            },
        };
        const updated = await tenantScopedPrisma.communicationMessage.update({
            where: { id },
            data: {
                status: 'DRAFT_PENDING_APPROVAL',
                externalRefs: nextRefs as Prisma.InputJsonValue,
            },
        });
        return res.json({ success: true, data: updated });
    } catch (error) {
        logger.error({ event: 'comms.approval.request_failed', err: error }, 'comms.approval.request_failed');
        return res.status(500).json({ success: false, error: { message: 'Failed to request approval' } });
    }
});

// ── POST /api/communications/messages/:id/approve ───────────────────────────

router.post('/messages/:id/approve', async (req, res) => {
    try {
        if (!canSendWithoutApproval(req)) {
            return res.status(403).json({ success: false, error: { message: 'Only internal approvers can approve communications' } });
        }
        const { id } = req.params;
        const body = ApprovalActionSchema.parse(req.body || {});
        const actorId = String(req.user?.id || 'system');
        const message = await tenantScopedPrisma.communicationMessage.findUnique({ where: { id } });
        if (!message) {
            return res.status(404).json({ success: false, error: { message: 'Message not found' } });
        }
        const refs = asRecord(message.externalRefs);
        const nextRefs = {
            ...refs,
            approval: {
                ...asRecord(refs.approval),
                state: 'APPROVED',
                approvedBy: actorId,
                approvedAt: new Date().toISOString(),
                reason: body.reason || '',
            },
        };
        const updated = await runTenantScopedTransaction(async (_tx) => {
          const tx = _tx as unknown as Prisma.TransactionClient;
            const envelope = buildDomainEvent({
                eventType: 'COMM.OUTBOUND_QUEUED',
                aggregateType: 'COMMUNICATION',
                aggregateId: id,
                aggregateVersion: Date.now(),
                actorType: 'SYSTEM',
                actorId: actorId || 'system',
                idempotencyKey: `approve:${id}`,
                data: { messageId: id },
            });
            const msg = await tx.communicationMessage.update({
                where: { id },
                data: {
                    status: 'QUEUED',
                    externalRefs: nextRefs as Prisma.InputJsonValue,
                },
            });
            await tx.outbox.create({
                data: {
                    eventId: envelope.eventId,
                    idempotencyKey: envelope.idempotencyKey || null,
                    aggregateId: id,
                    eventType: 'COMM.OUTBOUND_QUEUED',
                    payload: envelope as Prisma.InputJsonValue,
                } as unknown as Prisma.OutboxUncheckedCreateInput,
            });
            return msg;
        });
        return res.json({ success: true, data: updated });
    } catch (error) {
        logger.error({ event: 'comms.approval.approve_failed', err: error }, 'comms.approval.approve_failed');
        return res.status(500).json({ success: false, error: { message: 'Failed to approve message' } });
    }
});

// ── POST /api/communications/messages/:id/reject ────────────────────────────

router.post('/messages/:id/reject', async (req, res) => {
    try {
        if (!canSendWithoutApproval(req)) {
            return res.status(403).json({ success: false, error: { message: 'Only internal approvers can reject communications' } });
        }
        const { id } = req.params;
        const body = ApprovalActionSchema.parse(req.body || {});
        const actorId = String(req.user?.id || 'system');
        const message = await tenantScopedPrisma.communicationMessage.findUnique({ where: { id } });
        if (!message) {
            return res.status(404).json({ success: false, error: { message: 'Message not found' } });
        }
        const refs = asRecord(message.externalRefs);
        const nextRefs = {
            ...refs,
            approval: {
                ...asRecord(refs.approval),
                state: 'REJECTED',
                rejectedBy: actorId,
                rejectedAt: new Date().toISOString(),
                reason: body.reason || '',
            },
        };
        const updated = await tenantScopedPrisma.communicationMessage.update({
            where: { id },
            data: {
                status: 'DRAFT_PENDING_APPROVAL',
                externalRefs: nextRefs as Prisma.InputJsonValue,
            },
        });
        return res.json({ success: true, data: updated });
    } catch (error) {
        logger.error({ event: 'comms.approval.reject_failed', err: error }, 'comms.approval.reject_failed');
        return res.status(500).json({ success: false, error: { message: 'Failed to reject message' } });
    }
});

// ── POST /api/communications/messages/:id/retry ─────────────────────────────
// Re-queue a FAILED message for redelivery.

router.post('/messages/:id/retry', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await retryFailedMessage(id);
        if (result.status !== 'REQUEUED') {
            if (result.status === 'NOT_FOUND') {
                return res.status(404).json({ success: false, error: { message: 'Message not found' } });
            }
            if (result.status === 'NOT_FAILED') {
                return res.status(400).json({ success: false, error: { message: 'Only FAILED messages can be retried' } });
            }
            return res.status(400).json({ success: false, error: { message: 'Maximum delivery attempts (3) reached' } });
        }
        return res.json({ success: true, data: { messageId: result.messageId, status: 'QUEUED', previousAttempts: result.previousAttempts } });
    } catch (error) {
        logger.error({ event: 'comms.retry.failed', err: error }, 'comms.retry.failed');
        return res.status(500).json({ success: false, error: { message: 'Failed to retry message' } });
    }
});

// ── GET /api/communications/messages/:id/delivery-attempts ──────────────────

router.get('/messages/:id/delivery-attempts', async (req, res) => {
    try {
        const { id } = req.params;

        const attempts = await tenantScopedPrisma.communicationDeliveryAttempt.findMany({
            where: { messageId: id },
            orderBy: { attemptedAt: 'desc' },
        });

        return res.json({ success: true, data: attempts });
    } catch (error) {
        logger.error({ event: 'comms.attempts.fetch_failed', err: error }, 'comms.attempts.fetch_failed');
        return res.status(500).json({ success: false, error: { message: 'Failed to get delivery attempts' } });
    }
});
// ── GET /api/communications/summary ────────────────────────────────────────

router.get('/summary', async (req, res) => {
    try {
        const { entityType, entityId } = req.query;
        if (!entityType || !entityId) {
            return res.status(400).json({ success: false, error: { message: 'entityType and entityId are required' } });
        }
        const summaries = await getConversationSummaries(
            String(entityType),
            String(entityId),
            officeViewerFromUser(req.user),
        );
        return res.json({ success: true, data: summaries });
    } catch (error) {
        logger.error({ event: 'comms.summary.fetch_failed', err: error }, 'comms.summary.fetch_failed');
        return res.status(500).json({ success: false, error: { message: 'Failed to get summaries' } });
    }
});

// ── GET /api/communications/failed-deliveries ───────────────────────────────

router.get('/failed-deliveries', async (req, res) => {
    try {
        const { entityType, entityId } = req.query;
        if (!entityType || !entityId) {
            return res.status(400).json({ success: false, error: { message: 'entityType and entityId are required' } });
        }
        const failures = await getFailedDeliveries(
            String(entityType),
            String(entityId),
            officeViewerFromUser(req.user),
        );
        return res.json({ success: true, data: failures });
    } catch (error) {
        logger.error({ event: 'comms.failures.fetch_failed', err: error }, 'comms.failures.fetch_failed');
        return res.status(500).json({ success: false, error: { message: 'Failed to get failed deliveries' } });
    }
});

// ── POST /api/communications/draft ─────────────────────────────────────────

const DraftSchema = z.object({
    entityType: z.string(),
    entityId: z.string(),
    threadId: z.string().optional(),
    intent: z.string().optional(),
});

router.post('/draft', async (req, res) => {
    try {
        const input = DraftSchema.parse(req.body);
        const result = await generateDrafts(input.entityType, input.entityId, {
            threadId: input.threadId,
            intent: input.intent,
        });
        return res.json({ success: true, data: result });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ success: false, error: { message: error.issues[0]?.message || 'Invalid input' } });
        }
        logger.error({ event: 'comms.draft.generate_failed', err: error }, 'comms.draft.generate_failed');
        return res.status(500).json({ success: false, error: { message: 'Failed to generate drafts' } });
    }
});

// ── GET /api/communications/next-actions ───────────────────────────────────

router.get('/next-actions', async (req, res) => {
    try {
        const { entityType, entityId } = req.query;
        if (!entityType || !entityId) {
            return res.status(400).json({ success: false, error: { message: 'entityType and entityId are required' } });
        }
        const actions = await suggestNextActions(String(entityType), String(entityId));
        return res.json({ success: true, data: actions });
    } catch (error) {
        logger.error({ event: 'comms.next_actions.failed', err: error }, 'comms.next_actions.failed');
        return res.status(500).json({ success: false, error: { message: 'Failed to suggest actions' } });
    }
});

// ── GET /api/communications/cross-context ──────────────────────────────────

router.get('/cross-context', async (req, res) => {
    try {
        const { entityType, entityId } = req.query;
        if (!entityType || !entityId) {
            return res.status(400).json({ success: false, error: { message: 'entityType and entityId are required' } });
        }
        const result = await getCrossContextThreads(String(entityType), String(entityId));
        return res.json({ success: true, data: result });
    } catch (error) {
        logger.error({ event: 'comms.cross_context.failed', err: error }, 'comms.cross_context.failed');
        return res.status(500).json({ success: false, error: { message: 'Failed to get cross-context' } });
    }
});

export default router;

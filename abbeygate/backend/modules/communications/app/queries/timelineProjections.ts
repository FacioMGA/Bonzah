/**
 * Timeline Projections — read-model queries for conversation-level insights.
 *
 * Surfaces: conversation summaries, failed delivery counts, follow-up detection.
 * Pure query layer — no mutations.
 */
import { prisma, tenantScopedPrisma } from '../../../../platform/db/connection.js';
import {
  filterOfficeMessages,
  type OfficeViewer,
} from '../officeMessageVisibility.js';

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as JsonRecord)
        : {};
}

function asArray<T>(value: unknown): T[] {
    return Array.isArray(value) ? (value as T[]) : [];
}

export interface CommunicationTimelineItem {
    id: string;
    kind:
        | 'MESSAGE_OUTBOUND'
        | 'MESSAGE_INBOUND'
        | 'NOTE'
        | 'DELIVERY_FAILURE'
        | 'RETRY'
        | 'APPROVAL_REQUESTED'
        | 'APPROVAL_APPROVED'
        | 'APPROVAL_REJECTED'
        | 'TEMPLATE_RENDERED'
        | 'SYSTEM_EVENT';
    occurredAt: string;
    threadId: string;
    messageId?: string;
    title?: string;
    body?: string;
    status?: string;
    channel?: string;
    fromActor?: string;
    toRecipients?: string[];
    attachments?: TimelineAttachment[];
    errorCode?: string | null;
    errorDetail?: string | null;
    attemptId?: string;
    templateId?: string;
    templateName?: string;
    approvalState?: string;
    /**
     * Human label of the entity this item's thread belongs to, set only when the
     * timeline aggregates across entities (an ACCOUNT view merges its policy and
     * claim threads). e.g. "Policy BZ/CY5000001". Undefined for a single-entity
     * timeline where every item shares the viewed entity.
     */
    sourceLabel?: string;
}

export interface CommunicationTimelinePayload {
    items: CommunicationTimelineItem[];
    users: Array<{ id: string; name: string | null; email: string }>;
}

export type TimelineViewer = OfficeViewer;

export type TimelineAttachment = {
    filename: string;
    url?: string;
    storageUri?: string;
    mimetype?: string;
};

type PolicyDocumentRef = {
    policyId: string;
    filename: string;
    storageUri: string;
};

/**
 * Document.storageUri for generated packs is already `/api/documents/<filename>`.
 * documentsRouter rejects slashes in :filename, so never wrap an API URL again
 * and never encode path segments as the filename.
 */
function documentDownloadUrl(storageUri: string): string | undefined {
    const uri = String(storageUri || '').trim();
    if (!uri) return undefined;
    const apiMatch = uri.match(/^\/api\/documents\/([^/?#]+)$/);
    if (apiMatch?.[1]) return `/api/documents/${apiMatch[1]}`;
    const filename = uri.split(/[\\/]/).filter(Boolean).pop() || uri;
    if (!filename || filename.includes('..')) return undefined;
    return `/api/documents/${encodeURIComponent(filename)}`;
}

function normalizeTimelineAttachment(value: unknown): TimelineAttachment | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const filename = 'filename' in value ? String(value.filename || '').trim() : '';
    if (!filename) return null;
    const url = 'url' in value && value.url ? String(value.url) : undefined;
    const storageUri = 'storageUri' in value && value.storageUri ? String(value.storageUri) : undefined;
    const mimetype = 'mimetype' in value && value.mimetype ? String(value.mimetype) : undefined;
    return { filename, url, storageUri, mimetype };
}

function hydrateSentDocumentAttachments(args: {
    raw: unknown;
    policyId: string;
    documents: PolicyDocumentRef[];
}): TimelineAttachment[] {
    const policyDocs = args.documents.filter((doc) => doc.policyId === args.policyId);
    const fromMessage = asArray<unknown>(args.raw)
        .map(normalizeTimelineAttachment)
        .filter((item): item is TimelineAttachment => Boolean(item))
        .map((item) => {
            if (item.url) {
                if (!item.url.startsWith('/api/documents/')) return item;
                const url = documentDownloadUrl(item.url);
                return url ? { ...item, url } : item;
            }
            if (item.storageUri) {
                const url = documentDownloadUrl(item.storageUri);
                return url ? { ...item, url } : item;
            }
            const match = policyDocs.find((doc) => doc.filename === item.filename || doc.storageUri === item.filename);
            if (!match) return item;
            const url = documentDownloadUrl(match.storageUri);
            return url ? { ...item, storageUri: match.storageUri, url } : item;
        });

    return fromMessage;
}

async function loadGeneratedPolicyDocuments(policyIds: string[]): Promise<PolicyDocumentRef[]> {
    if (!policyIds.length) return [];
    const rows = await tenantScopedPrisma.document.findMany({
        where: { policyId: { in: policyIds }, status: 'GENERATED' },
        select: { policyId: true, filename: true, storageUri: true },
    });
    return rows.flatMap((row) => {
        if (!row.policyId || !row.filename || !row.storageUri) return [];
        return [{
            policyId: row.policyId,
            filename: row.filename,
            storageUri: row.storageUri,
        }];
    });
}

export interface ConversationSummary {
    threadId: string;
    entityType: string;
    entityId: string;
    status: string;
    lastActivityAt: string | null;
    messageCount: number;
    inboundCount: number;
    outboundCount: number;
    internalNoteCount: number;
    failedDeliveryCount: number;
    lastMessage: {
        id: string;
        direction: string;
        channel: string;
        fromActor: string;
        bodyPreview: string;
        status: string;
        createdAt: string;
    } | null;
    needsFollowUp: boolean;
    daysSinceLastInbound: number | null;
}

/**
 * Build conversation summaries for a given entity.
 */
export async function getConversationSummaries(
    entityType: string,
    entityId: string,
    viewer?: TimelineViewer | null,
): Promise<ConversationSummary[]> {
    if (entityType === 'OFFICE' && !viewer) return [];

    const threads = await prisma.communicationThread.findMany({
        where: { entityType, entityId },
        include: {
            messages: {
                orderBy: { createdAt: 'desc' },
                include: {
                    deliveryAttempts: {
                        orderBy: { attemptedAt: 'desc' },
                        take: 1,
                    },
                },
            },
        },
        orderBy: { lastActivityAt: 'desc' },
    });

    return threads.flatMap((thread) => {
        const msgs = entityType === 'OFFICE' && viewer
            ? filterOfficeMessages(thread.messages, viewer)
            : thread.messages;
        if (entityType === 'OFFICE' && msgs.length === 0) return [];
        const lastMsg = msgs[0] || null;

        const inboundMsgs = msgs.filter((m) => m.direction === 'INBOUND');
        const outboundMsgs = msgs.filter((m) => m.direction === 'OUTBOUND');
        const notesMsgs = msgs.filter((m) => m.communicationType === 'INTERNAL_NOTE');
        const failedMsgs = msgs.filter((m) => m.status === 'FAILED');

        // Follow-up detection: no inbound reply for 3+ days after an outbound message
        const lastOutbound = outboundMsgs[0];
        const lastInbound = inboundMsgs[0];
        let needsFollowUp = false;
        let daysSinceLastInbound: number | null = null;

        if (lastInbound?.createdAt) {
            daysSinceLastInbound = Math.floor(
                (Date.now() - new Date(lastInbound.createdAt).getTime()) / (1000 * 60 * 60 * 24),
            );
        }

        if (lastOutbound && (!lastInbound || lastInbound.createdAt < lastOutbound.createdAt)) {
            const daysSinceOutbound = Math.floor(
                (Date.now() - new Date(lastOutbound.createdAt).getTime()) / (1000 * 60 * 60 * 24),
            );
            if (daysSinceOutbound >= 3) {
                needsFollowUp = true;
            }
        }

        return [{
            threadId: thread.id,
            entityType: thread.entityType,
            entityId: thread.entityId,
            status: thread.status,
            lastActivityAt: thread.lastActivityAt?.toISOString() ?? null,
            messageCount: msgs.length,
            inboundCount: inboundMsgs.length,
            outboundCount: outboundMsgs.length,
            internalNoteCount: notesMsgs.length,
            failedDeliveryCount: failedMsgs.length,
            lastMessage: lastMsg
                ? {
                      id: lastMsg.id,
                      direction: lastMsg.direction,
                      channel: lastMsg.channel,
                      fromActor: lastMsg.fromActor,
                      bodyPreview: lastMsg.body.slice(0, 120) + (lastMsg.body.length > 120 ? '…' : ''),
                      status: lastMsg.status,
                      createdAt: lastMsg.createdAt.toISOString(),
                  }
                : null,
            needsFollowUp,
            daysSinceLastInbound,
        }];
    });
}

/**
 * Bound the account-aggregated timeline so a pathological account (e.g. a legacy
 * BDX placeholder holding thousands of policies, ADR-0056) can never fan the
 * read out unboundedly. We take the most recently created policies/claims under
 * the account — the ones an operator is realistically acting on.
 */
const ACCOUNT_TIMELINE_POLICY_CAP = 200;
const ACCOUNT_TIMELINE_CLAIM_CAP = 200;
/**
 * Upper bound on the number of timeline items returned for an aggregated account
 * view. The DB fan-out is already bounded by the policy/claim caps above; this
 * additionally bounds the response payload to the most recent N items so a busy
 * account cannot return an unbounded page (ADR-0072). Single-entity views are
 * unaffected — they read one thread and are not capped here.
 */
const ACCOUNT_TIMELINE_ITEM_CAP = 500;

/**
 * Resolve which communication threads a timeline should read, plus a per-entity
 * display label used to tag items when the view aggregates more than one entity.
 *
 * For an ACCOUNT we merge the account's own thread with the threads of its child
 * policies and their claims, so an issued-policy confirmation email (written to
 * the POLICY thread) is visible on the account Communications tab. Every other
 * entity type reads only its own thread, exactly as before.
 */
export async function resolveTimelineScope(
    entityType: string,
    entityId: string,
): Promise<{ where: { OR: Array<{ entityType: string; entityId: string | { in: string[] } }> } | { entityType: string; entityId: string }; labelByKey: Map<string, string> }> {
    const labelByKey = new Map<string, string>();
    if (entityType !== 'ACCOUNT') {
        return { where: { entityType, entityId }, labelByKey };
    }

    const policies = await tenantScopedPrisma.policy.findMany({
        where: { accountId: entityId },
        select: { id: true, policyNumber: true },
        orderBy: { createdAt: 'desc' },
        take: ACCOUNT_TIMELINE_POLICY_CAP,
    });
    const policyIds = policies.map((policy) => policy.id);
    const claims = policyIds.length
        ? await tenantScopedPrisma.claim.findMany({
            where: { policyId: { in: policyIds } },
            select: { id: true, claimNumber: true },
            // Claim has no createdAt; firstNotifiedAt is the FNOL creation time.
            orderBy: { firstNotifiedAt: 'desc' },
            take: ACCOUNT_TIMELINE_CLAIM_CAP,
        })
        : [];

    for (const policy of policies) labelByKey.set(`POLICY:${policy.id}`, `Policy ${policy.policyNumber || policy.id}`);
    for (const claim of claims) labelByKey.set(`CLAIM:${claim.id}`, `Claim ${claim.claimNumber || claim.id}`);

    const or: Array<{ entityType: string; entityId: string | { in: string[] } }> = [
        { entityType: 'ACCOUNT', entityId },
    ];
    if (policyIds.length) or.push({ entityType: 'POLICY', entityId: { in: policyIds } });
    if (claims.length) or.push({ entityType: 'CLAIM', entityId: { in: claims.map((claim) => claim.id) } });

    return { where: { OR: or }, labelByKey };
}

export async function getCommunicationTimeline(
    entityType: string,
    entityId: string,
    viewer?: TimelineViewer | null,
): Promise<CommunicationTimelinePayload> {
    if (entityType === 'OFFICE' && !viewer) {
        return { items: [], users: [] };
    }

    const { where, labelByKey } = await resolveTimelineScope(entityType, entityId);
    const threads = await prisma.communicationThread.findMany({
        where,
        include: {
            messages: {
                include: {
                    deliveryAttempts: {
                        orderBy: { attemptedAt: 'asc' },
                    },
                },
                orderBy: { createdAt: 'asc' },
            },
        },
        orderBy: { lastActivityAt: 'asc' },
    });

    const policyIds = [...new Set(
        threads
            .filter((thread) => thread.entityType === 'POLICY')
            .map((thread) => thread.entityId),
    )];
    const policyDocuments = await loadGeneratedPolicyDocuments(policyIds);

    const items: CommunicationTimelineItem[] = [];
    const userIds = new Set<string>();

    for (const thread of threads) {
        const threadItemsStart = items.length;
        const sourceLabel = labelByKey.get(`${thread.entityType}:${thread.entityId}`);
        const visibleMessages = entityType === 'OFFICE' && viewer
            ? filterOfficeMessages(thread.messages, viewer)
            : thread.messages;
        for (const message of visibleMessages) {
            const externalRefs = asRecord(message.externalRefs);
            const template = asRecord(externalRefs.template);
            const approval = asRecord(externalRefs.approval);
            const attachments = thread.entityType === 'POLICY'
                ? hydrateSentDocumentAttachments({
                    raw: message.attachments,
                    policyId: thread.entityId,
                    documents: policyDocuments,
                })
                : asArray<unknown>(message.attachments)
                    .map(normalizeTimelineAttachment)
                    .filter((item): item is TimelineAttachment => Boolean(item));

            if (message.fromActor && message.fromActor !== 'system' && message.fromActor !== 'SYSTEM') {
                userIds.add(message.fromActor);
            }

            if (template.templateId || template.renderedBody || template.renderedSubject) {
                items.push({
                    id: `${message.id}:template`,
                    kind: 'TEMPLATE_RENDERED',
                    occurredAt: message.createdAt.toISOString(),
                    threadId: thread.id,
                    messageId: message.id,
                    title: template.templateName ? `Template: ${String(template.templateName)}` : 'Template rendered',
                    body: String(template.renderedSubject || template.renderedBody || ''),
                    templateId: String(template.templateId || ''),
                    templateName: String(template.templateName || ''),
                    status: message.status,
                    channel: message.channel,
                });
            }

            if (approval.state === 'PENDING') {
                items.push({
                    id: `${message.id}:approval-requested`,
                    kind: 'APPROVAL_REQUESTED',
                    occurredAt: String(approval.requestedAt || message.createdAt.toISOString()),
                    threadId: thread.id,
                    messageId: message.id,
                    title: 'Approval requested',
                    body: String(approval.reason || ''),
                    approvalState: 'PENDING',
                    fromActor: String(approval.requestedBy || message.fromActor || ''),
                });
            }

            if (approval.state === 'APPROVED') {
                items.push({
                    id: `${message.id}:approval-approved`,
                    kind: 'APPROVAL_APPROVED',
                    occurredAt: String(approval.approvedAt || message.createdAt.toISOString()),
                    threadId: thread.id,
                    messageId: message.id,
                    title: 'Approval granted',
                    body: String(approval.reason || ''),
                    approvalState: 'APPROVED',
                    fromActor: String(approval.approvedBy || ''),
                });
            }

            if (approval.state === 'REJECTED') {
                items.push({
                    id: `${message.id}:approval-rejected`,
                    kind: 'APPROVAL_REJECTED',
                    occurredAt: String(approval.rejectedAt || message.createdAt.toISOString()),
                    threadId: thread.id,
                    messageId: message.id,
                    title: 'Approval rejected',
                    body: String(approval.reason || ''),
                    approvalState: 'REJECTED',
                    fromActor: String(approval.rejectedBy || ''),
                });
            }

            const messageKind: CommunicationTimelineItem['kind'] =
                message.communicationType === 'SYSTEM_EVENT'
                    ? 'SYSTEM_EVENT'
                    : message.communicationType === 'INTERNAL_NOTE' || message.channel === 'NOTE'
                        ? 'NOTE'
                        : message.direction === 'INBOUND'
                            ? 'MESSAGE_INBOUND'
                            : 'MESSAGE_OUTBOUND';

            items.push({
                id: message.id,
                kind: messageKind,
                occurredAt: message.createdAt.toISOString(),
                threadId: thread.id,
                messageId: message.id,
                title: message.subject || undefined,
                body: message.body,
                status: message.status,
                channel: message.channel,
                fromActor: message.fromActor,
                toRecipients: asArray<string>(message.toRecipients),
                attachments,
            });

            message.deliveryAttempts.forEach((attempt, index) => {
                if (index > 0) {
                    items.push({
                        id: `${attempt.id}:retry`,
                        kind: 'RETRY',
                        occurredAt: attempt.attemptedAt.toISOString(),
                        threadId: thread.id,
                        messageId: message.id,
                        attemptId: attempt.id,
                        title: `Retry ${index}`,
                        body: `Retry via ${attempt.provider}`,
                        status: attempt.status,
                        channel: attempt.channel,
                    });
                }
                if (attempt.status === 'FAILED') {
                    items.push({
                        id: `${attempt.id}:failure`,
                        kind: 'DELIVERY_FAILURE',
                        occurredAt: (attempt.resolvedAt || attempt.attemptedAt).toISOString(),
                        threadId: thread.id,
                        messageId: message.id,
                        attemptId: attempt.id,
                        title: 'Delivery failed',
                        body: attempt.errorDetail || undefined,
                        status: attempt.status,
                        channel: attempt.channel,
                        errorCode: attempt.errorCode,
                        errorDetail: attempt.errorDetail,
                    });
                }
            });
        }

        if (sourceLabel) {
            for (let i = threadItemsStart; i < items.length; i += 1) {
                items[i].sourceLabel = sourceLabel;
            }
        }
    }

    items.sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());

    // Aggregated account view (labelByKey populated): bound the response to the
    // most recent items so a busy account cannot return an unbounded page. Items
    // are sorted oldest→newest, so the tail is the most recent (ADR-0072).
    const isAggregated = labelByKey.size > 0;
    const boundedItems = isAggregated && items.length > ACCOUNT_TIMELINE_ITEM_CAP
        ? items.slice(items.length - ACCOUNT_TIMELINE_ITEM_CAP)
        : items;
    const finalUserIds = boundedItems === items
        ? userIds
        : new Set(
            boundedItems
                .map((item) => item.fromActor)
                .filter((actor): actor is string => Boolean(actor && actor !== 'system' && actor !== 'SYSTEM')),
        );

    const users = finalUserIds.size
        ? await prisma.user.findMany({
            where: { id: { in: Array.from(finalUserIds) } },
            select: { id: true, name: true, email: true },
        })
        : [];

    return { items: boundedItems, users };
}

/**
 * Get failed deliveries for a given entity — used for alerting/dashboard.
 */
export async function getFailedDeliveries(
    entityType: string,
    entityId: string,
    viewer?: TimelineViewer | null,
): Promise<{ messageId: string; channel: string; fromActor: string; errorCode: string | null; failedAt: string }[]> {
    if (entityType === 'OFFICE' && !viewer) return [];

    const failedMessages = await prisma.communicationMessage.findMany({
        where: {
            status: 'FAILED',
            thread: { entityType, entityId },
        },
        include: {
            deliveryAttempts: {
                where: { status: 'FAILED' },
                orderBy: { attemptedAt: 'desc' },
                take: 1,
            },
        },
        orderBy: { createdAt: 'desc' },
    });

    const visibleFailures = entityType === 'OFFICE' && viewer
        ? filterOfficeMessages(failedMessages, viewer)
        : failedMessages;

    return visibleFailures.map((msg) => ({
        messageId: msg.id,
        channel: msg.channel,
        fromActor: msg.fromActor,
        errorCode: msg.deliveryAttempts[0]?.errorCode ?? null,
        failedAt: msg.createdAt.toISOString(),
    }));
}

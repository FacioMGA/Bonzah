/**
 * Communications Domain Types — Frontend
 *
 * Canonical types for the communications product module.
 */

// ── Core enums ──────────────────────────────────────────────────────────────

export type MessageDirection = 'OUTBOUND' | 'INBOUND' | 'INTERNAL';
export type CommunicationChannel = 'EMAIL' | 'SMS' | 'WHATSAPP' | 'PHONE_CALL' | 'NOTE' | 'INTERNAL_CHAT' | 'SYSTEM';
export type MessageStatus = 'QUEUED' | 'SENDING' | 'SENT' | 'DELIVERED' | 'FAILED' | 'RECEIVED' | 'LOGGED' | 'DRAFT_PENDING_APPROVAL';
export type CommunicationType = 'EXTERNAL' | 'INTERNAL_NOTE' | 'SYSTEM_EVENT';
export type ParticipantRole = 'POLICYHOLDER' | 'BROKER' | 'ADJUSTER' | 'UNDERWRITER' | 'INTERNAL' | 'CLAIMANT' | 'INSURED' | 'PAYER';
export type ApprovalState = 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';
export type TimelineItemKind =
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

// ── Data shapes ─────────────────────────────────────────────────────────────

export interface CommunicationUser {
    id?: string;
    name?: string;
    email?: string;
    phone?: string;
    role?: string;
}

export interface CommunicationAttachment {
    filename: string;
    size?: number;
    storageUri?: string;
    url?: string;
    mimetype?: string;
}

export interface CommunicationMessage {
    id?: string;
    channel?: CommunicationChannel | string;
    direction?: MessageDirection | string;
    communicationType?: CommunicationType | string;
    fromActor?: string;
    toRecipients?: string[];
    createdAt?: string;
    body?: string;
    subject?: string;
    status?: MessageStatus | string;
    attachments?: CommunicationAttachment[];
    sentAt?: string;
    deliveredAt?: string;
    receivedAt?: string;
    externalRefs?: Record<string, unknown>;
}

export interface CommunicationThread {
    id?: string;
    entityType?: string;
    entityId?: string;
    status?: string;
    lastActivityAt?: string;
    messages?: CommunicationMessage[];
}

export interface ResolvedRecipient {
    participantId: string;
    contactName: string;
    role: ParticipantRole | string;
    channel: CommunicationChannel | string;
    address: string;
    consent: boolean;
    recipientClass?: 'EXTERNAL' | 'INTERNAL';
    groupLabel?: string;
    source?: string;
    preferredChannel?: CommunicationChannel | string;
    disabledReason?: string;
    isPrimary?: boolean;
}

export interface CommunicationTemplate {
    id: string;
    name: string;
    templateKey?: string;
    channel?: string;
    body?: string;
    bodyTemplate?: string;
    subjectTemplate?: string;
    variablesSchema?: Record<string, unknown>;
    approvalRequired?: boolean;
    enabled?: boolean;
    systemOnly?: boolean;
}

export interface TemplateVariableDescriptor {
    templateId: string;
    templateName: string;
    variables: string[];
    variablesSchema?: Record<string, unknown>;
}

export interface TemplateRenderPreview {
    renderedBody: string;
    renderedSubject?: string | null;
    missingVariables: string[];
    usedVariables: string[];
    schemaValidation?: {
        valid: boolean;
        missing: string[];
    };
}

export interface CommunicationSummary {
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
    needsFollowUp: boolean;
    daysSinceLastInbound: number | null;
}

export interface FailedDelivery {
    messageId: string;
    channel: string;
    fromActor: string;
    errorCode: string | null;
    failedAt: string;
}

export interface DeliveryAttempt {
    id: string;
    messageId: string;
    provider: string;
    channel: string;
    status: string;
    externalId?: string | null;
    errorCode?: string | null;
    errorDetail?: string | null;
    attemptedAt: string;
    resolvedAt?: string | null;
}

export interface NextActionSuggestion {
    title: string;
    description?: string;
    actionType?: string;
    messageId?: string;
}

export interface CrossContextThread {
    entityType: string;
    entityId: string;
    threadId: string;
    lastActivityAt?: string | null;
    summary?: string;
}

export interface CommunicationTimelineItem {
    id: string;
    kind: TimelineItemKind;
    occurredAt: string;
    threadId: string;
    messageId?: string;
    title?: string;
    body?: string;
    status?: string;
    channel?: string;
    fromActor?: string;
    toRecipients?: string[];
    attachments?: CommunicationAttachment[];
    errorCode?: string | null;
    errorDetail?: string | null;
    attemptId?: string;
    templateId?: string;
    templateName?: string;
    approvalState?: ApprovalState | string;
    /**
     * Label of the entity this item's thread belongs to, present only on an
     * aggregated view (the account Communications tab merges its policy/claim
     * threads). e.g. "Policy BZ/CY5000001".
     */
    sourceLabel?: string;
}

export interface CommunicationTimelinePayload {
    items: CommunicationTimelineItem[];
    users: CommunicationUser[];
}

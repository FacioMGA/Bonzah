/**
 * ingestEmails — Org2Vec email ingestion orchestrator (ADR-0044).
 *
 * Funnels every ingestion source (sample inbox, upload, live Graph) through
 * one path:
 *   1. group normalized messages into operational conversations,
 *   2. resolve each conversation onto a business object (claim/submission/
 *      unresolved) via the org2vec resolver,
 *   3. persist as canonical CommunicationThread / CommunicationMessage rows
 *      (NOT loose demo data) keyed/idempotent on the provider message id,
 *   4. emit one `COMM.EMAIL_INGESTED` domain event per conversation so the
 *      worker can trigger the scoped Org2Vec memory refresh.
 *
 * App layer: orchestrates SoR writes + event emit. No transport, no LLM.
 */

import type { Prisma } from '@prisma/client';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import { appendDomainEvent, buildDomainEvent } from '../../../platform/events/domainEvents.js';
import { logger } from '../../../platform/utils/logger.js';
import { getTenantConfig } from '../../../platform/tenant/tenantConfig.js';
import { resolveBusinessObject, type ResolvedScope } from '../../org2vec/index.js';
import { extractEmailIdentifiers } from '../domain/providers/identifierExtraction.js';
import type { NormalizedOutlookMessage } from '../domain/providers/outlookMessage.js';
import { CommunicationsService } from './communicationsService.js';

export type IngestSource = 'sample' | 'upload' | 'graph';

/**
 * Explicit business-object link supplied by an operator/demo console. When
 * present it replaces identifier resolution, but the id is still resolved
 * against canonical Postgres (tenant-scoped) — an unknown id falls through
 * to UNRESOLVED rather than being force-linked.
 */
export interface IngestTarget {
  scopeType: 'CLAIM' | 'SUBMISSION';
  scopeId: string;
}

export interface IngestEmailsInput {
  messages: NormalizedOutlookMessage[];
  source: IngestSource;
  actorId?: string;
  target?: IngestTarget;
}

export interface IngestedThreadResult {
  conversationId: string;
  threadId: string;
  scopeType: ResolvedScope['scopeType'];
  scopeId: string | null;
  messageCount: number;
  matchedBy: string;
}

export interface IngestEmailsResult {
  source: IngestSource;
  totalMessages: number;
  ingestedMessages: number;
  threads: IngestedThreadResult[];
}

function groupByConversation(messages: NormalizedOutlookMessage[]): Map<string, NormalizedOutlookMessage[]> {
  const groups = new Map<string, NormalizedOutlookMessage[]>();
  for (const message of messages) {
    const key = message.conversationId || message.externalMessageId;
    const existing = groups.get(key);
    if (existing) existing.push(message);
    else groups.set(key, [message]);
  }
  return groups;
}

function mergeIdentifiers(messages: NormalizedOutlookMessage[]) {
  const combinedText = messages.map((m) => `${m.subject}\n${m.bodyText}`).join('\n\n');
  const extracted = extractEmailIdentifiers(combinedText);
  // Deterministic link hints (set by source) win over regex extraction.
  const hint = messages.map((m) => m.linkHints).find(Boolean);
  return {
    claimId: hint?.claimId,
    claimReference: hint?.claimReference ?? extracted.claimReference,
    policyId: hint?.policyId,
    policyReference: hint?.policyReference ?? extracted.policyReference,
    submissionId: hint?.submissionId,
    vehicleRegistration: hint?.vehicleRegistration ?? extracted.vehicleRegistration,
    contactEmails: Array.from(new Set(messages.map((m) => m.from.email).filter(Boolean))),
  };
}

function entityFor(scope: ResolvedScope, conversationId: string): { entityType: string; entityId: string } {
  if (scope.scopeType === 'UNRESOLVED') {
    return { entityType: 'UNRESOLVED', entityId: conversationId };
  }
  return { entityType: scope.scopeType, entityId: scope.scopeId };
}

export async function ingestEmails(input: IngestEmailsInput): Promise<IngestEmailsResult> {
  const groups = groupByConversation(input.messages);
  const threads: IngestedThreadResult[] = [];
  let ingestedMessages = 0;

  for (const [conversationId, groupMessages] of groups) {
    const identifiers = mergeIdentifiers(groupMessages);
    // An explicit target still goes through canonical resolution (existence
    // + tenant scope) — we resolve by the supplied id, never force-link.
    const scope = input.target
      ? await resolveBusinessObject(
          input.target.scopeType === 'CLAIM'
            ? { claimId: input.target.scopeId }
            : { submissionId: input.target.scopeId },
        )
      : await resolveBusinessObject(identifiers);
    const { entityType, entityId } = entityFor(scope, conversationId);

    const thread = await CommunicationsService.getOrCreateThread(entityType, entityId);

    const ordered = [...groupMessages].sort((a, b) => a.sentAt.localeCompare(b.sentAt));
    for (const message of ordered) {
      const toRecipients: Prisma.InputJsonValue = [
        ...message.to.map((c) => c.email),
        ...(message.cc ?? []).map((c) => c.email),
      ];
      const externalRefs: Prisma.InputJsonValue = {
        providerMessageId: message.externalMessageId,
        conversationId: message.conversationId,
        source: input.source,
      };
      const attachments: Prisma.InputJsonValue = message.attachments.map((a) => ({
        name: a.name,
        contentType: a.contentType ?? null,
        sizeBytes: a.sizeBytes ?? null,
        externalId: a.externalId ?? null,
      }));
      await CommunicationsService.createMessage(thread.id, {
        direction: 'INBOUND',
        channel: 'EMAIL',
        provider: input.source === 'graph' ? 'OUTLOOK' : 'IMPORT',
        fromActor: message.from.email,
        toRecipients,
        subject: message.subject,
        body: message.bodyText,
        attachments,
        externalRefs,
        status: 'RECEIVED',
        communicationType: 'EXTERNAL',
        idempotencyKey: message.externalMessageId,
      });
      ingestedMessages += 1;
    }

    const envelope = buildDomainEvent({
      eventType: 'COMM.EMAIL_INGESTED',
      aggregateType: 'COMMUNICATION',
      aggregateId: thread.id,
      aggregateVersion: Date.now(),
      actorType: 'SYSTEM',
      actorId: input.actorId ?? 'org2vec-ingest',
      reasonCode: 'EMAIL_INGESTED',
      data: {
        operatingTenantId: getTenantConfig().id,
        threadId: thread.id,
        conversationId,
        scopeType: scope.scopeType,
        scopeId: scope.scopeType === 'UNRESOLVED' ? null : scope.scopeId,
        matchedBy: scope.scopeType === 'UNRESOLVED' ? scope.reason : scope.matchedBy,
        identifiers,
        messageCount: ordered.length,
        source: input.source,
      },
    });
    await appendDomainEvent(tenantScopedPrisma, envelope);

    threads.push({
      conversationId,
      threadId: thread.id,
      scopeType: scope.scopeType,
      scopeId: scope.scopeType === 'UNRESOLVED' ? null : scope.scopeId,
      messageCount: ordered.length,
      matchedBy: scope.scopeType === 'UNRESOLVED' ? scope.reason : scope.matchedBy,
    });

    logger.info(
      {
        event: 'org2vec.ingest.thread',
        threadId: thread.id,
        scopeType: scope.scopeType,
        conversationId,
        messageCount: ordered.length,
        source: input.source,
      },
      'org2vec.ingest.thread',
    );
  }

  return {
    source: input.source,
    totalMessages: input.messages.length,
    ingestedMessages,
    threads,
  };
}

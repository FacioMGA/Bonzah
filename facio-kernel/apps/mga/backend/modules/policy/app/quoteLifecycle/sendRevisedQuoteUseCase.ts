/**
 * Canonical service for sending a quote PDF to the customer — the
 * write half of the BO Premium tab "Send quote" action exposed via
 * `POST /api/policies/:id/quote/send`.
 *
 * Operator MCP V2 (ADR-0039) `operator.send_revised_quote` calls this
 * after consuming a confirmation token. UI-preservation pin: the BO
 * route delegates to this service so writes are byte-identical
 * (identical lifecycle transition, identical audit row, identical
 * `enqueuePolicyListIndexUpdate`).
 *
 * Idempotency: re-sending an already QUOTED policy does NOT attempt a
 * QUOTED → QUOTED lifecycle transition (matches the existing BO
 * behaviour pinned by `usePolicyLifecycleActions.test.tsx` and the
 * contract-fast suite).
 */
import type { Prisma } from '@prisma/client';
import type { Policy, PolicyHolder, PolicyStateCurrent } from '@prisma/client';
import { tenantScopedPrisma, runTenantScopedTransaction } from '../../../../platform/db/connection.js';
import { AuditLogger } from '../../../../platform/audit/logger.js';
import { logger } from '../../../../platform/utils/logger.js';
import { DocumentService } from '../../../documents/app/documentService.js';
import { dispatchQuoteEmail } from '../communicationsInterop.js';
import { newPublicSessionToken } from '../shared.js';
import { enqueuePolicyListIndexUpdate } from '../policyListIndex.js';
import { transitionPolicyLifecycle } from '../commands/policyLifecycleCommands.js';
import { buildQuoteEmailContext } from '../quoteEmailContext.js';
import { buildPublicQuoteUrl } from '../../../../platform/http/publicAppLinks.js';
import { storageService } from '../../../../platform/storage/service.js';
import { parseRecord } from '../../../../platform/json/parseRecord.js';
import { assertPolicyTransitionAllowed } from '../../domain/lifecycle/stateMachines.js';

export interface SendRevisedQuoteActor {
    id: string;
    role: 'OPERATOR_AGENT' | 'UNDERWRITER' | 'SYSTEM';
    name?: string;
}

export interface SendRevisedQuoteInput {
    policyId: string;
    actor: SendRevisedQuoteActor;
    correlationId?: string;
    /** Optional override; defaults to public app base URL. */
    publicAppBaseUrl: string;
    /** Optional audit metadata source (defaults to bo / operator-mcp-v2). */
    auditSource?: string;
    /** Product-owned resume stage for the customer quotation journey. */
    quoteWizardStep?: string;
    /** Stable delivery key when an automated producer must retry safely. */
    idempotencySeed?: string;
}

export type SendRevisedQuoteResult =
    | {
          ok: true;
          status: 'queued';
          recipient: string;
          url: string;
          messageId: string | null;
          lifecycleRecorded: boolean;
      }
    | {
          ok: false;
          code: 'NOT_FOUND' | 'MISSING_EMAIL' | 'PRODUCT_ASSIGNMENT_REQUIRED' | 'INVALID_STATUS' | 'EMAIL_FAILED';
          message: string;
      };

function extractLocalStorageFilename(storageUri: string): string | null {
    const m = String(storageUri || '').match(/^\/api\/documents\/([^/?#]+)$/);
    return m?.[1] || null;
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
    const chunks: Buffer[] = [];
    return await new Promise((resolve, reject) => {
        stream.on('data', (c: Buffer) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', reject);
    });
}

async function fetchPdfBufferFromStorageUri(storageUri: string): Promise<Buffer | null> {
    const uri = String(storageUri || '').trim();
    if (!uri) return null;
    if (/^https?:\/\//i.test(uri)) {
        const resp = await fetch(uri);
        if (!resp.ok) return null;
        const ab = await resp.arrayBuffer();
        return Buffer.from(ab);
    }
    const localFilename = extractLocalStorageFilename(uri);
    if (!localFilename) return null;
    const stream = await storageService.getFileStream(localFilename);
    if (!stream) return null;
    return await streamToBuffer(stream);
}

type PolicyWithRelations = Policy & {
    policyHolder: PolicyHolder | null;
    stateCurrent: PolicyStateCurrent | null;
};

function resolveAuditSource(actor: SendRevisedQuoteActor, override?: string): string {
    const explicit = String(override || '').trim();
    if (explicit) return explicit;
    return actor.role === 'OPERATOR_AGENT' ? 'operator-mcp-v2' : 'bo';
}

export async function sendRevisedQuoteUseCase(
    input: SendRevisedQuoteInput,
): Promise<SendRevisedQuoteResult> {
    const policy = (await tenantScopedPrisma.policy.findUnique({
        where: { id: input.policyId },
        include: { policyHolder: true, stateCurrent: true },
    })) as PolicyWithRelations | null;
    if (!policy) {
        return { ok: false, code: 'NOT_FOUND', message: 'Policy not found' };
    }
    const snap = parseRecord(policy.stateCurrent?.snapshot);
    const qd = parseRecord(snap.quoteData || policy.quoteData);
    const proposer = parseRecord(qd.proposer);
    const productType = String(policy.productType || '').trim().toUpperCase();
    const binderId = String(policy.binderId || '').trim();
    const programId = String(policy.programId || '').trim();

    // Product identity is established by the canonical program/binder
    // assignment transaction. A quote email is a customer-facing projection
    // of that identity, so it must fail closed when the assignment is absent.
    // Never invent a product slug: that previously turned incomplete BO
    // quotes into Motor customer links.
    if (!productType || !binderId || !programId) {
        return {
            ok: false,
            code: 'PRODUCT_ASSIGNMENT_REQUIRED',
            message: 'Select and save an active binder and program before sending this quote.',
        };
    }
    const isManualProposalProduct = productType === 'BUSINESS' || productType === 'OPEN_MARKET';
    const email = String(proposer.email || '').trim();
    if (!email) {
        return {
            ok: false,
            code: 'MISSING_EMAIL',
            message: 'Customer email is missing from quote data',
        };
    }

    const currentStatus = String(policy.status || '').trim().toUpperCase();
    if (currentStatus !== 'QUOTED') {
        try {
            // The lifecycle state machine is the canonical owner. Check it
            // before generating a document or queueing customer email: a
            // terminal policy must never receive a stale quote.
            assertPolicyTransitionAllowed(currentStatus, 'QUOTED');
        } catch {
            return {
                ok: false,
                code: 'INVALID_STATUS',
                message: `Cannot send a quote while the policy status is ${currentStatus || 'unknown'}`,
            };
        }
    }

    const token = policy.publicSessionToken || newPublicSessionToken();
    if (!policy.publicSessionToken) {
        await tenantScopedPrisma.policy.update({
            where: { id: input.policyId },
            data: { publicSessionToken: token },
        });
    }

    const quoteLink = buildPublicQuoteUrl(input.publicAppBaseUrl, token, {
        productType,
        step: input.quoteWizardStep,
    });
    const auditSource = resolveAuditSource(input.actor, input.auditSource);
    logger.info(
        {
            event: 'policy.quote.send.started',
            policyId: input.policyId,
            recipient: email,
            actorId: input.actor.id,
            correlationId: input.correlationId,
            source: auditSource,
        },
        'policy.quote.send.started',
    );

    // Resolve product-owned disclosure before generating a pack. A product can
    // fail closed when a required regulated asset is unavailable, preventing
    // both a misleading email and a substitute document from being created.
    const emailContext = buildQuoteEmailContext(policy);
    const quotePackAttachments = await (async () => {
        if (isManualProposalProduct) return [];
        const pack = await DocumentService.generate({
            policyId: policy.id,
            riskTransactionId: null,
            docPack: 'QUOTE_PACK',
            source: 'BO',
            generatedByUserId: input.actor.id || null,
        });
        const docs = Array.isArray(pack.documents) ? pack.documents : [];
        if (docs.length === 0) {
            throw new Error(`QUOTE_PACK generation returned no documents for policy ${policy.id}`);
        }
        return await Promise.all(docs.map(async (document) => {
            const record = parseRecord(document);
            const storageUri = String(record.storageUri || '').trim();
            const filenameRaw = String(record.filename || '').trim();
            if (!storageUri || !filenameRaw) {
                throw new Error(`QUOTE_PACK document is incomplete for policy ${policy.id}`);
            }
            const content = await fetchPdfBufferFromStorageUri(storageUri);
            if (!content || content.length === 0) {
                throw new Error(`QUOTE_PACK document could not be loaded for policy ${policy.id}: ${filenameRaw}`);
            }
            return {
                filename: filenameRaw.toLowerCase().endsWith('.pdf') ? filenameRaw : `${filenameRaw}.pdf`,
                content,
            };
        }));
    })();

    const dispatchResult = await dispatchQuoteEmail(
        email,
        `${String(proposer.firstName || '')} ${String(proposer.lastName || '')}`.trim() || 'Insured',
        quoteLink,
        undefined,
        undefined,
        {
            policyId: policy.id,
            quote: emailContext.quote,
            policy: emailContext.policy,
            productCode: productType,
            idempotencySeed: `quote-send:${policy.id}:${input.idempotencySeed || input.correlationId || Date.now()}`,
            attachments: quotePackAttachments,
        },
    );
    if (!dispatchResult.queued) {
        logger.warn(
            {
                event: 'policy.quote.send.email_not_queued',
                policyId: input.policyId,
                recipient: email,
                reason: dispatchResult.skippedReason,
                correlationId: input.correlationId,
            },
            'policy.quote.send.email_not_queued',
        );
        return {
            ok: false,
            code: 'EMAIL_FAILED',
            message: `Failed to send quote email${dispatchResult.skippedReason ? ` (${dispatchResult.skippedReason})` : ''}`,
        };
    }

    // Mark policy as QUOTED. Re-sending an already QUOTED policy is
    // idempotent — same posture as the existing BO route.
    let lifecycleRecorded = true;
    await runTenantScopedTransaction(async (_tx) => {
        const tx = _tx as unknown as Prisma.TransactionClient;
        const status = String(policy.status || '').trim().toUpperCase();
        if (status !== 'QUOTED') {
            await transitionPolicyLifecycle({
                tx,
                policyId: input.policyId,
                to: 'QUOTED',
                actorId: input.actor.id,
                actorType: input.actor.role === 'SYSTEM' ? 'SYSTEM' : 'USER',
                reasonCode: 'QUOTE_SENT',
                correlationId: input.correlationId,
                data: { recipient: email, messageId: dispatchResult.messageId },
            });
        }
        await enqueuePolicyListIndexUpdate(tx, input.policyId);
    }).catch((err) => {
        lifecycleRecorded = false;
        logger.error(
            {
                event: 'policy.quote.send.lifecycle_record_failed',
                policyId: input.policyId,
                messageId: dispatchResult.messageId,
                err,
                correlationId: input.correlationId,
            },
            'policy.quote.send.lifecycle_record_failed',
        );
    });

    await AuditLogger.log(
        input.policyId,
        'POLICY',
        'QUOTE.SENT',
        input.actor.id,
        input.actor.role === 'SYSTEM' ? 'SYSTEM' : 'USER',
        {
            recipient: email,
            url: quoteLink,
            messageId: dispatchResult.messageId,
            lifecycleRecorded,
            source: auditSource,
        },
        input.actor.name || 'System',
    );

    return {
        ok: true,
        status: 'queued',
        recipient: email,
        url: quoteLink,
        messageId: dispatchResult.messageId ?? null,
        lifecycleRecorded,
    };
}

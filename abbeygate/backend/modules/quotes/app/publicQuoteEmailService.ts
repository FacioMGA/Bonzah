import fs from 'node:fs';
import type { Prisma } from '@prisma/client';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import { appendDomainEvent, buildDomainEvent } from '../../../platform/events/domainEvents.js';
import { parseRecord } from '../../../platform/json/parseRecord.js';
import { AuditLogger } from '../../../platform/audit/logger.js';
import { logger } from '../../../platform/utils/logger.js';
import { DocumentService } from '../../documents/app/documentService.js';
import { dispatchQuoteEmail } from '../../policy/app/communicationsInterop.js';
import { buildQuoteEmailContext, type PolicyForQuoteEmail } from '../../policy/app/quoteEmailContext.js';
import { resolveProductIpidAsset } from '../../policy/app/productRegistryService.js';
import { getTenantConfig } from '../../../platform/tenant/tenantConfig.js';
import { normalizePublicAppBaseUrl } from '../../../platform/http/publicAppLinks.js';
import { storageService } from '../../../platform/storage/service.js';
import type { CommunicationAttachmentRef } from '../../communications/domain/types.js';

type QuotePackAttachment = {
  type: string;
  filename: string;
  content: Buffer;
};

/**
 * ABY-514 — canonical public quote-email spine for non-motor customer wizards.
 *
 * Lloyd's requires the quote correspondence (quotation PDF, IPID, and Terms
 * of Business) to reach the customer immediately when a quote is provided.
 * Home had no `POST …/quote/send` route and never invoked the communications
 * spine after `/rate`, so customers reached payment without any email.
 *
 * Motor keeps its legacy handler under `backend/products/motor/quotes/` (OTP
 * gate, recommendations, etc.). Home/Travel/Health funnel here.
 */

export type SendPublicQuoteEmailResult =
  | { ok: true; queued: true; recipient: string; messageId?: string }
  | { ok: true; queued: false; recipient: string; skippedReason?: string }
  | { ok: false; code: 'NOT_FOUND' | 'MISSING_EMAIL' | 'NOT_QUOTED' | 'PDF_FAILED' | 'EMAIL_FAILED'; message: string };

export interface SendPublicQuoteEmailInput {
  productCode: string;
  publicSessionToken: string;
  baseUrl: string;
  /** Distinguishes auto-send-on-rate from manual resend for audit/idempotency. */
  source?: 'rate' | 'manual';
  correlationId?: string;
}

export type QueuePublicQuoteEmailResult =
  | { ok: true; queued: true; recipient: string }
  | { ok: false; code: 'NOT_FOUND' | 'MISSING_EMAIL' | 'NOT_QUOTED'; message: string };

/**
 * Queue public correspondence through the transactional outbox. Quote-pack
 * generation can involve document renderers and storage; it must never run in
 * a public HTTP request or in the shared rating spine.
 */
export async function queuePublicQuoteEmailForSession(
  input: SendPublicQuoteEmailInput,
): Promise<QueuePublicQuoteEmailResult> {
  const productCode = String(input.productCode || '').trim().toUpperCase();
  const token = String(input.publicSessionToken || '').trim();
  if (!productCode || !token) return { ok: false, code: 'NOT_FOUND', message: 'Session not found' };

  const policy = await tenantScopedPrisma.policy.findFirst({
    where: { publicSessionToken: token, productType: productCode },
    select: { id: true, status: true, quoteData: true },
  });
  if (!policy) return { ok: false, code: 'NOT_FOUND', message: 'Session not found' };
  if (String(policy.status || '').trim().toUpperCase() !== 'QUOTED') {
    return { ok: false, code: 'NOT_QUOTED', message: 'Quote email is available only after a successful quote.' };
  }
  const quoteEmail = String(parseRecord(parseRecord(policy.quoteData).proposer).email || '').trim().toLowerCase();
  if (!quoteEmail) return { ok: false, code: 'MISSING_EMAIL', message: 'Customer email is missing from quote data.' };

  await tenantScopedPrisma.$transaction(async (tx) => {
    await appendDomainEvent(tx, buildDomainEvent({
      aggregateType: 'POLICY',
      aggregateId: policy.id,
      aggregateVersion: Date.now(),
      eventType: 'EMAIL.PUBLIC_QUOTE',
      actorType: 'CUSTOMER',
      actorId: 'public-quote-send',
      correlationId: input.correlationId,
      data: {
        policyId: policy.id,
        productCode,
        source: input.source || 'manual',
      },
    }));
  });

  return { ok: true, queued: true, recipient: quoteEmail };
}

function extractLocalStorageFilename(storageUri: string): string | null {
  const match = String(storageUri || '').match(/^\/api\/documents\/([^/?#]+)$/);
  return match?.[1] || null;
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  return await new Promise((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
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
    return Buffer.from(await resp.arrayBuffer());
  }
  const localFilename = extractLocalStorageFilename(uri);
  if (!localFilename) return null;
  const stream = await storageService.getFileStream(localFilename);
  if (!stream) return null;
  return streamToBuffer(stream);
}

function productSlugForQuoteUrl(productType: string): string {
  const normalized = String(productType || '').trim().toUpperCase();
  if (normalized === 'OPEN_MARKET') return 'open-market';
  return normalized.toLowerCase().replace(/_/g, '-');
}

function buildIpidAttachment(productType: string, countryCode: string): CommunicationAttachmentRef {
  const asset = resolveProductIpidAsset(productType, countryCode);
  if (!asset?.absolutePath || !asset.filename) {
    throw new Error(`No approved IPID asset is configured for ${productType} in ${countryCode}`);
  }
  const contentBase64 = fs.readFileSync(asset.absolutePath).toString('base64');
  return {
    filename: asset.filename,
    mimetype: 'application/pdf',
    size: Buffer.byteLength(contentBase64, 'base64'),
    contentBase64,
  };
}

async function loadQuotePackAttachments(
  documents: unknown[],
  policyId: string,
): Promise<QuotePackAttachment[]> {
  if (documents.length === 0) {
    throw new Error(`QUOTE_PACK generation returned no documents for policy ${policyId}`);
  }

  return await Promise.all(documents.map(async (document) => {
    const record = parseRecord(document);
    const type = String(record.type || '').trim();
    const storageUri = String(record.storageUri || '').trim();
    const filenameRaw = String(record.filename || '').trim();
    if (!type || !storageUri || !filenameRaw) {
      throw new Error(`QUOTE_PACK document is incomplete for policy ${policyId}`);
    }
    const content = await fetchPdfBufferFromStorageUri(storageUri);
    if (!content || content.length === 0) {
      throw new Error(`QUOTE_PACK document could not be loaded for policy ${policyId}: ${filenameRaw}`);
    }
    return {
      type,
      filename: filenameRaw.toLowerCase().endsWith('.pdf') ? filenameRaw : `${filenameRaw}.pdf`,
      content,
    };
  }));
}

type PolicyRow = Prisma.PolicyGetPayload<{
  include: { stateCurrent: true };
}>;

export async function sendPublicQuoteEmailForSession(
  input: SendPublicQuoteEmailInput,
): Promise<SendPublicQuoteEmailResult> {
  const productCode = String(input.productCode || '').trim().toUpperCase();
  const token = String(input.publicSessionToken || '').trim();
  if (!productCode || !token) {
    return { ok: false, code: 'NOT_FOUND', message: 'Session not found' };
  }

  const policy = await tenantScopedPrisma.policy.findFirst({
    where: { publicSessionToken: token, productType: productCode },
    include: { stateCurrent: true },
  }) as PolicyRow | null;
  if (!policy) {
    return { ok: false, code: 'NOT_FOUND', message: 'Session not found' };
  }

  const status = String(policy.status || '').trim().toUpperCase();
  if (status !== 'QUOTED') {
    return {
      ok: false,
      code: 'NOT_QUOTED',
      message: 'Quote email is available only after a successful quote.',
    };
  }

  const snap = parseRecord(policy.stateCurrent?.snapshot);
  const quoteData = parseRecord(snap.quoteData || policy.quoteData);
  const proposer = parseRecord(quoteData.proposer);
  const quoteEmail = String(proposer.email || '').trim().toLowerCase();
  if (!quoteEmail) {
    return { ok: false, code: 'MISSING_EMAIL', message: 'Customer email is missing from quote data.' };
  }

  const quoteResponse = parseRecord(snap.quoteResponse || policy.quoteResponse);
  const quoteReference = String(quoteResponse.reference || policy.policyNumber || policy.id).trim();

  logger.info({
    event: 'quote.public_email.started',
    policyId: policy.id,
    product: productCode,
    recipient: quoteEmail,
    source: input.source || 'manual',
    correlationId: input.correlationId,
  }, 'quote.public_email.started');

  const pack = await DocumentService.generate({
    policyId: policy.id,
    riskTransactionId: null,
    docPack: 'QUOTE_PACK',
    source: 'CUSTOMER',
    generatedByUserId: null,
  });

  const docs = Array.isArray(pack.documents) ? pack.documents : [];
  let quotePackAttachments: QuotePackAttachment[];
  try {
    quotePackAttachments = await loadQuotePackAttachments(docs, policy.id);
  } catch (error) {
    logger.error({ err: error, policyId: policy.id, productCode }, 'quote.public_email.quote_pack_unavailable');
    return { ok: false, code: 'PDF_FAILED', message: 'Quote email could not be sent because its document pack is unavailable.' };
  }

  const baseUrl = normalizePublicAppBaseUrl(input.baseUrl);
  const productSlug = productSlugForQuoteUrl(productCode);
  const quoteLink = `${baseUrl}/quote/${encodeURIComponent(token)}?product=${encodeURIComponent(productSlug)}&step=your-quote`;

  const recipientName = `${String(proposer.firstName || '')} ${String(proposer.lastName || '')}`.trim() || 'Insured';
  const emailContext = buildQuoteEmailContext(policy satisfies PolicyForQuoteEmail);
  const packIncludesIpid = quotePackAttachments.some((attachment) => attachment.type.toUpperCase().includes('IPID'));
  let extraAttachments: CommunicationAttachmentRef[] = [];
  if (!packIncludesIpid) {
    try {
      extraAttachments = [buildIpidAttachment(productCode, getTenantConfig().countryCode)];
    } catch (error) {
      logger.error({ err: error, policyId: policy.id, productCode }, 'quote.public_email.ipid_unavailable');
      return { ok: false, code: 'PDF_FAILED', message: 'Quote email could not be sent because its required IPID is unavailable.' };
    }
  }
  const idempotencySeed = `public-quote-email:${policy.id}:${quoteReference}:${input.source || 'manual'}`;

  const dispatchResult = await dispatchQuoteEmail(
    quoteEmail,
    recipientName,
    quoteLink,
    undefined,
    undefined,
    {
      policyId: policy.id,
      quote: emailContext.quote,
      policy: emailContext.policy,
      productCode,
      idempotencySeed,
      attachments: quotePackAttachments.map(({ filename, content }) => ({ filename, content })),
      extraAttachments,
    },
  );

  if (!dispatchResult.queued) {
    logger.warn({
      event: 'quote.public_email.not_queued',
      policyId: policy.id,
      recipient: quoteEmail,
      reason: dispatchResult.skippedReason,
      correlationId: input.correlationId,
    }, 'quote.public_email.not_queued');
    return {
      ok: true,
      queued: false,
      recipient: quoteEmail,
      skippedReason: dispatchResult.skippedReason,
    };
  }

  void AuditLogger.log(
    policy.id,
    'POLICY',
    'QUOTE.PUBLIC_EMAIL_SENT',
    'customer',
    'USER',
    {
      recipient: quoteEmail,
      attachmentFilenames: quotePackAttachments.map(({ filename }) => filename),
      attachmentCount: quotePackAttachments.length + extraAttachments.length,
      ipidAttached: packIncludesIpid || extraAttachments.length > 0,
      source: input.source || 'manual',
      messageId: dispatchResult.messageId,
    },
    String(proposer.firstName || 'Customer'),
  );

  logger.info({
    event: 'quote.public_email.queued',
    policyId: policy.id,
    recipient: quoteEmail,
    messageId: dispatchResult.messageId,
    ipidAttached: packIncludesIpid || extraAttachments.length > 0,
    correlationId: input.correlationId,
  }, 'quote.public_email.queued');

  return {
    ok: true,
    queued: true,
    recipient: quoteEmail,
    messageId: dispatchResult.messageId,
  };
}

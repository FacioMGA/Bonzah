/**
 * quoteEmailHandler.ts — Send quote email handler.
 *
 * The heaviest single handler (~165 LOC). Owns:
 *   - Email OTP/JWT verification
 *   - Quote pack PDF generation + buffer fetching
 *   - Email dispatch with PDF attachment
 *   - Audit logging
 */
import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { asRecord } from './quoteDataGuards.js';
import { AuditLogger } from '../../../platform/audit/logger.js';
import { DocumentService } from '../../../modules/documents/app/documentService.js';
import { sendQuoteEmail } from '../../../modules/communications/domain/notifications/email.js';
import { buildQuoteEmailContext, type PolicyForQuoteEmail } from '../../../modules/policy/app/quoteEmailContext.js';
import { logger } from '../../../platform/utils/logger.js';

import {
    type RequestWithPerf,
    policyIdFrom,
    resolvePublicQuoteBaseUrl,
    fetchPdfBufferFromStorageUri,
    sendPublicError,
} from './controllerUtils.js';

type PublicSessionModule = typeof import('./publicSession.js');
type ErrorsModule = typeof import('./errors.js');
const publicSessionModule: PublicSessionModule = await import('./publicSession.js');
const errorsModule: ErrorsModule = await import('./errors.js');
const { enforcePublicToken, resolvePublicAutoPolicyFull } = publicSessionModule;
const { PublicApiError } = errorsModule;

const QUOTE_EMAIL_OTP_PURPOSE = 'QUOTE_EMAIL';
const quoteEmailJwtSecret = process.env.JWT_SECRET || 'dev-jwt-secret-change-me';
const SendQuoteEmailBodySchema = z.object({
    verifiedEmail: z.string().trim().email().optional(),
    quoteEmailProof: z.string().trim().min(1).optional(),
});

export async function sendQuoteEmailHandler(req: Request, res: Response) {
    try {
        const request = req as RequestWithPerf;
        const policyId = policyIdFrom(req);
        const resolved = await resolvePublicAutoPolicyFull(policyId, { perf: request.perf });
        const policy = resolved.policy;
        if (!policy) throw new PublicApiError({ httpStatus: 404, code: 'NOT_FOUND', message: 'Session not found' });
        if (!enforcePublicToken(request, resolved.mode, res)) return;

        const snapshot = asRecord(asRecord(policy.stateCurrent).snapshot);
        const quoteData = asRecord(snapshot.quoteData && typeof snapshot.quoteData === 'object' ? snapshot.quoteData : policy.quoteData);
        const proposer = asRecord(quoteData.proposer);
        const quoteEmail = String(proposer.email || '').trim().toLowerCase();
        if (!quoteEmail) {
            throw new PublicApiError({
                httpStatus: 422,
                code: 'MISSING_EMAIL',
                message: 'Customer email is missing from quote data.',
            });
        }

        const parsed = SendQuoteEmailBodySchema.safeParse(req.body || {});
        if (!parsed.success) {
            throw new PublicApiError({
                httpStatus: 400,
                code: 'BAD_REQUEST',
                message: 'Invalid quote email request payload',
            });
        }
        const claimedVerifiedEmail = String(parsed.data.verifiedEmail || '').trim().toLowerCase();
        const isAuthenticatedUser = Boolean(request.user && typeof asRecord(request.user).id === 'string');
        if (!isAuthenticatedUser) {
            const quoteEmailProof = String(parsed.data.quoteEmailProof || '').trim();
            if (!quoteEmailProof) {
                throw new PublicApiError({
                    httpStatus: 403,
                    code: 'EMAIL_NOT_VERIFIED',
                    message: 'Email verification is required before sending your quote.',
                });
            }
            let proofEmail = '';
            try {
                const decoded = jwt.verify(quoteEmailProof, quoteEmailJwtSecret);
                const decodedRecord = asRecord(decoded);
                const purpose = String(decodedRecord.purpose || '').trim().toUpperCase();
                const emailFromProof = String(decodedRecord.email || '').trim().toLowerCase();
                if (purpose !== QUOTE_EMAIL_OTP_PURPOSE || !emailFromProof) {
                    throw new Error('Invalid quote email proof payload');
                }
                proofEmail = emailFromProof;
            } catch {
                throw new PublicApiError({
                    httpStatus: 403,
                    code: 'EMAIL_NOT_VERIFIED',
                    message: 'Email verification failed. Please verify again.',
                });
            }
            if (claimedVerifiedEmail && claimedVerifiedEmail !== quoteEmail) {
                throw new PublicApiError({
                    httpStatus: 403,
                    code: 'EMAIL_MISMATCH',
                    message: 'Verified email does not match the quote recipient email.',
                });
            }
            if (proofEmail !== quoteEmail) {
                throw new PublicApiError({
                    httpStatus: 403,
                    code: 'EMAIL_MISMATCH',
                    message: 'Verified email does not match the quote recipient email.',
                });
            }
        }
        logger.info({ data: { policyId: policy.id, quoteEmail } }, '[QuoteEmail] Starting public quote email send flow.');

        const pack = await DocumentService.generate({
            policyId: policy.id,
            riskTransactionId: null,
            docPack: 'QUOTE_PACK',
            source: 'CUSTOMER',
            generatedByUserId: null,
        });

        const docs = Array.isArray(pack.documents) ? pack.documents : [];
        const quoteDoc = docs.find((d) => String(d.type || '').includes('QUOTE')) || docs[0];
        const docRecord = asRecord(quoteDoc);
        const storageUri = String(docRecord.storageUri || '').trim();
        if (!storageUri) {
            throw new PublicApiError({
                httpStatus: 500,
                code: 'PDF_GENERATION_FAILED',
                message: 'Quote PDF generation failed: document URL is missing.',
            });
        }

        const pdfBuffer = await fetchPdfBufferFromStorageUri(storageUri);
        if (!pdfBuffer || pdfBuffer.length === 0) {
            throw new PublicApiError({
                httpStatus: 500,
                code: 'PDF_EMPTY',
                message: 'Quote PDF generation failed: file is empty or unavailable.',
            });
        }

        const quoteFilenameRaw = String(docRecord.filename || '').trim();
        const attachmentFilename = quoteFilenameRaw
            ? (quoteFilenameRaw.toLowerCase().endsWith('.pdf') ? quoteFilenameRaw : `${quoteFilenameRaw}.pdf`)
            : `Quote-${String(policy.policyNumber || policy.id)}.pdf`;
        const baseUrl = resolvePublicQuoteBaseUrl(req);
        const productSlug = String(policy.productType || 'MOTOR').trim().toLowerCase();
        const quoteLink = `${baseUrl}/quote/${String(policy.publicSessionToken || policy.id)}?product=${encodeURIComponent(productSlug)}&step=your-quote`;

        const recipientName = `${String(proposer.firstName || '')} ${String(proposer.lastName || '')}`.trim() || 'Insured';
        const emailContext = buildQuoteEmailContext(policy satisfies PolicyForQuoteEmail);
        const sent = await sendQuoteEmail(
            quoteEmail,
            recipientName,
            quoteLink,
            pdfBuffer,
            attachmentFilename,
            {
                policyId: policy.id,
                quote: emailContext.quote,
                policy: emailContext.policy,
            }
        );
        if (!sent) {
            throw new PublicApiError({
                httpStatus: 500,
                code: 'EMAIL_SEND_FAILED',
                message: 'Quote email could not be sent. Please try again.',
            });
        }

        logger.info({
            data: {
                policyId: policy.id,
                quoteEmail,
                attachmentFilename,
                attachmentBytes: pdfBuffer.length,
                attachmentMimeType: 'application/pdf',
            },
        }, '[QuoteEmail] Public quote email sent with PDF attachment.');

        void AuditLogger.log(
            policy.id,
            'POLICY',
            'QUOTE.PUBLIC_EMAIL_SENT',
            'customer',
            'USER',
            {
                recipient: quoteEmail,
                attachmentFilename,
                attachmentBytes: pdfBuffer.length,
            },
            String(proposer.firstName || 'Customer')
        );

        return res.json({
            success: true,
            data: {
                status: 'sent',
                recipient: quoteEmail,
                attachment: {
                    filename: attachmentFilename,
                    mimeType: 'application/pdf',
                    sizeBytes: pdfBuffer.length,
                },
            },
        });
    } catch (e) {
        if (e instanceof PublicApiError) {
            logger.warn({ data: { code: e.code, message: e.message } }, '[QuoteEmail] Public quote send failed.');
            return sendPublicError(res, e, 'Quote send failed');
        }
        logger.error({ err: e }, '[QuoteEmail] Public quote send failed unexpectedly.');
        return sendPublicError(res, e, 'Quote send failed');
    }
}

import type { Prisma } from '@prisma/client';
import type { WithoutTenantScope } from '../../../platform/db/tenantExtension.js';
import { Router } from 'express';
import { z } from 'zod';
import { tenantScopedPrisma, runTenantScopedTransaction } from '../../../platform/db/connection.js';
import { openApiRegistry, ErrorResponseSchema } from '../../../platform/openapi/openapi.js';
import { WebhookDispatcher } from '../../communications/app/webhooks/webhookDispatcher.js';
import { logger } from '../../../platform/utils/logger.js';
import { evaluateIssueReadiness } from '../app/issueReadiness.js';
import { derivePremiumFinancials } from '../app/premiumFinancialsService.js';
import { transitionPolicyLifecycle } from '../app/commands/policyLifecycleCommands.js';
import { getSanctionsService, resolveIndividualScreeningSubject, SanctionsBlockError } from '../../compliance/app/index.js';
import { enqueueAccountProjectionRefreshByPolicyId } from '../../accounts360/app/accountProjectionRefresh.js';
import { jsonStringify } from '../app/shared.js';
import { buildQuoteResponseForProduct, productAdapterExists, resolvePublishedProgramQuoteContext } from '../app/productRegistryService.js';
import { parseRecord } from '../../../platform/json/parseRecord.js';

const router = Router();

const DocumentTypeEnum = z.enum(['SCHEDULE', 'CERTIFICATE', 'ENDORSEMENT', 'INVOICE']);
const EndorsementStatusEnum = z.enum(['DRAFT', 'QUOTED', 'BOUND', 'CANCELLED']);

// -------------------------------------------------------------------------------- //
// CORE POLICY ISSUANCE (BINDING)
// -------------------------------------------------------------------------------- //

const BindPolicyRequestSchema = openApiRegistry.register('BindPolicyRequest', z.object({
    quoteId: z.string().uuid().describe('The secure stateful ID provided during the Dynamic Risk Pricing phase'),
    quoteToken: z.string().describe('The cryptographic JWT returned during the Quote phase guaranteeing the price and inputs'),
    paymentMethod: z.object({
        type: z.enum(['INVOICE', 'CREDIT_CARD', 'DIRECT_DEBIT']),
        token: z.string().optional().describe('Secure vaulted token if collecting cash against this ledger transaction')
    }).optional()
}).openapi({
    example: {
        quoteId: "d4b1a201-44b0-4e0a-bf15-1d6789c52001",
        quoteToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ2IjoxLCJwdCI6IkFVVE9f...",
        paymentMethod: {
            type: "CREDIT_CARD",
            token: "tok_visa_4242"
        }
    }
}));

const PolicyResponseSchema = openApiRegistry.register('PolicyResponse', z.object({
    id: z.string().uuid(),
    policyNumber: z.string().describe('The official bound policy number'),
    programId: z.string().uuid(),
    status: z.enum(['ISSUED', 'AWAITING_PAYMENT', 'CANCELLED']),
    effectiveDate: z.string().datetime(),
    expirationDate: z.string().datetime(),
}).openapi({
    example: {
        id: "a7b2c300-44b0-4e0a-bf15-1d6789ccba02",
        policyNumber: "P-2026-84729",
        programId: "e9f8a000-84b2-4d1e-bd15-0d6789b52000",
        status: "ISSUED",
        effectiveDate: "2026-03-01T00:00:00.000Z",
        expirationDate: "2027-02-28T23:59:59.000Z"
    }
}));

openApiRegistry.registerPath({
    method: 'post',
    path: '/v1/policies',
    operationId: 'bindPolicy',
    summary: 'Bind Quote & Issue Policy',
    description: 'Executes the financial commitment. This converts a quoted rate into a legally binding insurance contract on the Facio ledger and instantly issues the PDF documentation.',
    tags: ['3. Quote & Bind'],
    request: {
        body: { content: { 'application/json': { schema: BindPolicyRequestSchema } } }
    },
    responses: {
        201: {
            description: 'Policy successfully bound and issued',
            content: { 'application/json': { schema: z.object({ success: z.boolean(), data: PolicyResponseSchema }) } }
        },
        400: { description: 'Quote invalid or expired', content: { 'application/json': { schema: ErrorResponseSchema } } },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
        404: { description: 'Quote not found', content: { 'application/json': { schema: ErrorResponseSchema } } }
    }
});

router.post('/', async (req, res) => {
    try {
        const parsed = BindPolicyRequestSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.format() });

        const requestAccount = req.apiAccount;
        if (!requestAccount) return res.status(401).json({ success: false, error: { message: 'Unauthorized' } });

        const { verifyQuoteToken } = await import('../../pricing/app/quoteToken.js');
        try {
            // Cryptographically guarantee the Quote Token payload
            verifyQuoteToken(parsed.data.quoteToken);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Invalid or expired quote token';
            return res.status(400).json({ success: false, error: { message: `Invalid or expired quote token: ${message}` } });
        }

        const policy = await tenantScopedPrisma.policy.findFirst({
            where: { id: parsed.data.quoteId, accountId: requestAccount.id },
            include: { policyHolder: true, binder: true, stateCurrent: true }
        });

        if (!policy) return res.status(404).json({ success: false, error: { message: 'Quote not found' } });
        if (policy.status !== 'QUOTED') return res.status(400).json({ success: false, error: { message: 'Quote is not active or already bound' } });
        const snapshot = parseRecord(policy.stateCurrent?.snapshot);
        const effectiveQuoteData = parseRecord(snapshot.quoteData || policy.quoteData);
        const effectiveQuoteResponse = parseRecord(snapshot.quoteResponse || policy.quoteResponse);

        // Canonical funnel: the API bind path is a 'bo' channel for readiness purposes
        // (the customer-channel payment gate is N/A on the API; payment is supplied
        // in the request body or marked as INVOICE). We refuse non-payment blockers.
        const readiness = await evaluateIssueReadiness(policy.id, 'bo');
        const blockingNonPayment = (readiness.blockers || []).filter(
            (b) => (b.severity ?? 'BLOCK') === 'BLOCK' && (b.group || 'OTHER') !== 'PAYMENT' && b.code !== 'POLICY_LOCKED_BY_TRANSACTION',
        );
        if (blockingNonPayment.length > 0) {
            const quoteDataInvalid = blockingNonPayment.find((b) => b.code === 'QUOTE_DATA_INVALID');
            if (quoteDataInvalid) {
                return res.status(400).json({
                    success: false,
                    error: { code: 'QUOTE_DATA_INVALID', message: quoteDataInvalid.message, details: quoteDataInvalid.details },
                });
            }
            return res.status(422).json({
                success: false,
                error: { code: 'NOT_READY_TO_BIND', message: 'Quote is not ready to bind.', blockers: blockingNonPayment },
            });
        }

        const screeningSubject = resolveIndividualScreeningSubject({
            policyHolderName: policy.policyHolder?.name || null,
            quoteData: effectiveQuoteData,
        });
        if (!screeningSubject) {
            return res.status(400).json({
                success: false,
                error: { code: 'SANCTION_SCREENING_SUBJECT_MISSING', message: 'Cannot run sanctions screening because the insured person name is missing.' },
            });
        }
        try {
            await getSanctionsService().assertClearOrThrow({
                actionType: 'PUBLIC_API_BIND_ISSUE',
                policyId: policy.id,
                subjectName: screeningSubject.subjectName,
                dateOfBirth: screeningSubject.dateOfBirth,
                correlationId: req.correlationId || `public-bind:${policy.id}`,
            });
        } catch (error) {
            if (error instanceof SanctionsBlockError) {
                return res.status(409).json({
                    success: false,
                    error: {
                        code: 'SANCTION_SCREENING_BLOCKED',
                        message: error.message,
                        screeningOutcome: error.outcome,
                        reasonCode: error.reasonCode,
                        providerSearchId: error.providerSearchId,
                    },
                });
            }
            return res.status(503).json({
                success: false,
                error: {
                    code: 'SANCTION_SCREENING_UNAVAILABLE',
                    message: 'Sanctions screening is unavailable. Binding is blocked until screening succeeds.',
                },
            });
        }

        const { reserveNextPolicyId, reserveNextCertificateNumber, assignPlatformIssuanceIdentifiers } = await import('../../../platform/utils/platformIds.js');
        const { resolvePolicyUmrFromBinder } = await import('../app/binders/binderAuthority.js');
        const { enqueueIssuedPolicyPack } = await import('../app/commands/issuedPackEnqueue.js');

        const quoteResponse = effectiveQuoteResponse;
        const primaryOption = parseRecord(quoteResponse.primaryOption);
        const totalPremium = Number(primaryOption.annualPremium ?? primaryOption.totalPremium ?? quoteResponse.annualPremium ?? 0) || 0;
        const resolvedCurrency = String(quoteResponse.currency || policy.binder?.defaultCurrency || 'EUR');

        // Canonical UMR: the bound binder's Unique Market Reference. Fails
        // loud if the binder has no UMR — never fabricated.
        const umr = resolvePolicyUmrFromBinder(policy.binder);
        const paymentInfo = parsed.data.paymentMethod;

        const result = await runTenantScopedTransaction(async (_tx) => {
          const tx = _tx as Prisma.TransactionClient;
            const assigned = process.env.KERNEL_PLATFORM_MODE === 'true' ? await assignPlatformIssuanceIdentifiers(tx, policy.id, 'MANUAL') : null;
            const policyBusinessId = assigned?.policyNumber ?? await reserveNextPolicyId(tx, policy.productType, 'MANUAL');
            const certificateNumber = assigned ? assigned.certificateNumber : await reserveNextCertificateNumber(tx);

            const nextLifecycleStatus = paymentInfo?.type === 'INVOICE' && !paymentInfo.token ? 'AWAITING_PAYMENT' : 'ISSUED';

            await transitionPolicyLifecycle({
                tx,
                policyId: policy.id,
                to: nextLifecycleStatus,
                actorId: requestAccount.id,
                actorType: 'USER',
                reasonCode: 'V1_BINDING_INCEPTION',
                correlationId: req.correlationId,
            });

            const updatedPolicy = await tx.policy.update({
                where: { id: policy.id },
                data: {
                    policyNumber: policyBusinessId,
                    umr,
                    certificateNumber,
                }
            });

            const currentState = await tx.policyStateCurrent.findUnique({ where: { policyId: policy.id } });
            const currentSnapshot = currentState ? parseRecord(currentState.snapshot) : {};
            const nextSnapshotStr = {
                ...currentSnapshot,
                quoteData: effectiveQuoteData,
                quoteResponse,
                status: nextLifecycleStatus,
                policyId: policyBusinessId,
                umr,
                certificateNumber,
            };
            const stateCreate: WithoutTenantScope<Prisma.PolicyStateCurrentUncheckedCreateInput> = {
                policyId: policy.id,
                snapshot: jsonStringify(nextSnapshotStr),
            };
            await tx.policyStateCurrent.upsert({
                where: { policyId: policy.id },
                update: { snapshot: jsonStringify(nextSnapshotStr) },
                create: stateCreate as Prisma.PolicyStateCurrentUncheckedCreateInput,
            });

            const searchIndexCreate: WithoutTenantScope<Prisma.PolicySearchIndexUncheckedCreateInput> = {
                policyId: policy.id,
                policyNumber: policyBusinessId,
                insuredName: policy.policyHolder?.name || 'Unknown',
                status: nextLifecycleStatus,
                segment: policy.productType,
                totalPremium,
            };
            await tx.policySearchIndex.upsert({
                where: { policyId: policy.id },
                update: { status: nextLifecycleStatus, policyNumber: policyBusinessId },
                create: searchIndexCreate as Prisma.PolicySearchIndexUncheckedCreateInput,
            });

            const endorsementData: WithoutTenantScope<Prisma.EndorsementUncheckedCreateInput> = {
                policyId: policy.id,
                endorsementNo: 1,
                transactionType: 'INCEPTION',
                status: 'ISSUED',
                effectiveAt: policy.inceptionDate || new Date(),
                effectiveTo: policy.expiryDate,
                issuedAt: new Date(),
                snapshot: JSON.stringify(nextSnapshotStr),
                delta: { action: 'INCEPTION', status: nextLifecycleStatus, premium: totalPremium, umr },
            };
            await tx.endorsement.create({
                data: endorsementData as Prisma.EndorsementUncheckedCreateInput,
            });

            const invoiceData: WithoutTenantScope<Prisma.InvoiceUncheckedCreateInput> = {
                policyId: policy.id,
                amount: totalPremium,
                currency: resolvedCurrency,
                status: nextLifecycleStatus === 'AWAITING_PAYMENT' ? 'OPEN' : 'PAID',
                dueDate: policy.inceptionDate || new Date(),
                commissionRate: 0,
            };
            const invoice = await tx.invoice.create({
                data: invoiceData as Prisma.InvoiceUncheckedCreateInput,
            });

            const riskTxnData: WithoutTenantScope<Prisma.RiskTransactionUncheckedCreateInput> = {
                policyId: policy.id,
                transactionNumber: 1,
                transactionType: 'INCEPTION',
                status: 'BOUND',
                effectiveDate: policy.inceptionDate || new Date(),
                expiryDate: policy.expiryDate,
                snapshotFinal: JSON.stringify(nextSnapshotStr),
                pricingFinal: JSON.stringify({ premium: totalPremium, currency: resolvedCurrency, quoteResponse, quoteData: effectiveQuoteData }),
                createdBy: requestAccount.id,
            };
            const riskTxn = await tx.riskTransaction.create({
                data: riskTxnData as Prisma.RiskTransactionUncheckedCreateInput,
            });

            const binderFinancials = updatedPolicy.binderId
                ? await tx.binderFinancials.findUnique({ where: { binderId: updatedPolicy.binderId } })
                : null;
            const quoteCost = parseRecord(primaryOption.costDetails);
            const grossPremium = Number(quoteCost.subtotalNetPremium ?? totalPremium) || 0;
            const premiumFinancials = derivePremiumFinancials({
                grossPremium,
                quoteResponse,
                binder: policy.binder,
                binderFinancials,
                riskTransactionType: 'NB',
                premiumTransactionType: 'ORIGINAL',
            });
            await tx.premiumTransaction.create({
                data: {
                    riskTransactionId: riskTxn.id,
                    transactionType: 'ORIGINAL',
                    grossPremium: premiumFinancials.grossPremium,
                    commissionPercent: premiumFinancials.commissionPercent,
                    commissionAmount: premiumFinancials.commissionAmount,
                    taxesTotal: premiumFinancials.taxesTotal,
                    feesTotal: premiumFinancials.feesTotal,
                    netToLondon: premiumFinancials.netToLondon,
                    currency: resolvedCurrency,
                }
            });
            await enqueueAccountProjectionRefreshByPolicyId(tx, policy.id);

            // ADR-0013 — schedule the issued-pack inside the same
            // transaction that created the INCEPTION row.
            await enqueueIssuedPolicyPack(tx, {
                policyId: policy.id,
                riskTransactionId: riskTxn.id,
                source: 'API',
                generatedByUserId: requestAccount.id || null,
                idempotencyKey: `issued-pack:${policy.id}:${riskTxn.id}`,
                correlationId: req.correlationId || undefined,
            });

            return { policy: updatedPolicy, riskTransactionId: riskTxn.id, invoiceId: invoice.id };
        });

        const responseData = {
            id: result.policy.id,
            policyNumber: result.policy.policyNumber as string,
            programId: result.policy.programId,
            status: result.policy.status as 'ISSUED' | 'AWAITING_PAYMENT' | 'CANCELLED',
            effectiveDate: (result.policy.inceptionDate || new Date()).toISOString(),
            expirationDate: (result.policy.expiryDate || new Date()).toISOString()
        };

        // Fire and forget webhook
        void WebhookDispatcher.dispatch(requestAccount.id, 'policy.bound', responseData);

        return res.status(201).json({
            success: true,
            data: responseData
        });

    } catch (err) {
        logger.error({ err }, 'Error POST /v1/policies (Bind)');
        return res.status(500).json({ success: false, error: { message: 'Failed to bind policy' } });
    }
});

// -------------------------------------------------------------------------------- //
// DOCUMENTS
// -------------------------------------------------------------------------------- //

// Zod schema for response documentation and validation
const DocumentSchema = openApiRegistry.register('DocumentResponse', z.object({
    id: z.string().uuid(),
    type: DocumentTypeEnum,
    filename: z.string(),
    status: z.string().describe('Internal generation status (e.g. GENERATED)'),
    url: z.string().url().describe('Pre-signed URL or direct path to the document'),
    createdAt: z.string().datetime(),
}).openapi({
    example: {
        id: "f8d9e000-66d2-5f2c-dh37-3f8901eeda04",
        type: "SCHEDULE",
        filename: "Schedule_P-2026-84729.pdf",
        status: "GENERATED",
        url: "https://strgfaciocoreprd.blob.core.windows.net/docs/Schedule.pdf?sp=r&st=...",
        createdAt: "2026-03-01T10:05:00.000Z"
    }
}));

openApiRegistry.registerPath({
    method: 'get',
    path: '/v1/policies/{policyId}/documents',
    operationId: 'getPolicyDocuments',
    summary: 'Retrieve Issued Documents',
    description: 'Fetches the generated, legally binding PDF documents (Schedules, Certificates) associated with this bound risk.',
    tags: ['4. Policy Servicing'],
    request: {
        params: z.object({ policyId: z.string().uuid() }),
    },
    responses: {
        200: {
            description: 'Successful retrieval of documents',
            content: { 'application/json': { schema: z.object({ success: z.boolean(), data: z.array(DocumentSchema) }) } },
        },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
        403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponseSchema } } },
        404: { description: 'Policy not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    },
});

router.get('/:policyId/documents', async (req, res) => {
    try {
        const policyId = req.params.policyId;
        const requestAccount = req.apiAccount;

        if (!requestAccount) {
            return res.status(401).json({ success: false, error: { message: 'Unauthorized' } });
        }

        // Attempt to locate policy strictly belonging to this account.
        // RLS handles auth filtering; we perform an explicit DB check for defense in depth, but we perform an explicit DB check for defense in depth.
        const policy = await tenantScopedPrisma.policy.findFirst({
            where: {
                id: policyId,
                accountId: requestAccount.id
            },
            include: {
                documents: {
                    // Return generated documents only
                    where: { status: 'GENERATED' }
                }
            }
        });

        if (!policy) {
            return res.status(404).json({ success: false, error: { message: 'Policy not found or unauthorized' } });
        }

        // Map internal documents to public DTO
        const mappedDocuments = policy.documents.map(doc => ({
            id: doc.id,
            type: doc.type,
            filename: doc.filename,
            status: doc.status,
            // In reality, this would usually invoke a blob service `generateSasUrl(doc.storageUri)`
            url: doc.storageUri.startsWith('http') ? doc.storageUri : `https://docs.facio.io/${doc.storageUri}`,
            createdAt: doc.createdAt.toISOString()
        }));

        return res.json({
            success: true,
            data: mappedDocuments,
        });
    } catch (_error) {
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve documents' }
        });
    }
});

// -------------------------------------------------------------------------------- //
// ENDORSEMENTS (MID-TERM ADJUSTMENTS)
// -------------------------------------------------------------------------------- //

const EndorsementQuoteRequestSchema = openApiRegistry.register('EndorsementQuoteRequest', z.object({
    effectiveDate: z.string().datetime().describe('When the endorsement changes take effect (ISO-8601)'),
    changes: z.record(z.string(), z.any()).openapi({
        description: 'Key-value pairs of the adjustments being requested, specific to the program schema.',
        example: { address: "123 New Street", namedOperators: ["John Doe"] }
    }),
    reason: z.string().max(1000).optional(),
}));

const EndorsementResponseSchema = openApiRegistry.register('EndorsementResponse', z.object({
    quoteId: z.string().uuid().describe('Target transaction ID to bind later'),
    status: EndorsementStatusEnum,
    premiumDifference: z.number().describe('Delta premium calculated by the rating engine'),
    effectiveDate: z.string().datetime(),
}));

const EndorsementBindRequestSchema = openApiRegistry.register('EndorsementBindRequest', z.object({
    quoteId: z.string().uuid().describe('The transaction ID passed back from the Quote step'),
}));

openApiRegistry.registerPath({
    method: 'post',
    path: '/v1/policies/{policyId}/endorsements/quote',
    operationId: 'quoteEndorsement',
    summary: 'Draft Mid-Term Adjustment (Endorsement)',
    description: 'Initiates a structural change to a live contract. Submits the new risk factors, immediately calculating the exact pro-rata premium difference (Return or Additional) owed.',
    tags: ['4. Policy Servicing'],
    request: {
        params: z.object({ policyId: z.string().uuid() }),
        body: { content: { 'application/json': { schema: EndorsementQuoteRequestSchema } } },
    },
    responses: {
        200: {
            description: 'Endorsement drafted successfully',
            content: { 'application/json': { schema: z.object({ success: z.boolean(), data: EndorsementResponseSchema }) } }
        },
        400: { description: 'Validation or rating engine error', content: { 'application/json': { schema: ErrorResponseSchema } } },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
        404: { description: 'Policy not found or unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    },
});

openApiRegistry.registerPath({
    method: 'post',
    path: '/v1/policies/{policyId}/endorsements/bind',
    operationId: 'bindEndorsement',
    summary: 'Bind Mid-Term Adjustment',
    description: 'Commits the drafted adjustment to the ledger. This permanently alters the coverage profile and generates an updated Schedule.',
    tags: ['4. Policy Servicing'],
    request: {
        params: z.object({ policyId: z.string().uuid() }),
        body: { content: { 'application/json': { schema: EndorsementBindRequestSchema } } },
    },
    responses: {
        200: {
            description: 'Endorsement bound successfully',
            content: { 'application/json': { schema: z.object({ success: z.boolean(), message: z.string() }) } }
        },
        400: { description: 'Transaction invalid or already bound', content: { 'application/json': { schema: ErrorResponseSchema } } },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
        404: { description: 'Policy not found or unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    },
});

router.post('/:policyId/endorsements/quote', async (req, res) => {
    try {
        const policyId = req.params.policyId;
        const requestAccount = req.apiAccount;

        if (!requestAccount) return res.status(401).json({ success: false, error: { message: 'Unauthorized' } });

        const parsed = EndorsementQuoteRequestSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.format() });

        const policy = await tenantScopedPrisma.policy.findFirst({
            where: { id: policyId, accountId: requestAccount.id },
            include: { stateCurrent: true, binder: { select: { defaultCurrency: true } } }
        });

        if (!policy || !policy.stateCurrent) {
            return res.status(404).json({ success: false, error: { message: 'Policy not found, unauthorized, or missing state' } });
        }

        const { validateDraftQuote } = await import('../../quotes/app/validator.js');

        function parseRecordSafe(value: unknown): Record<string, unknown> {
            if (typeof value === 'string') {
                try { value = JSON.parse(value); } catch { return {}; }
            }
            return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
        }

        const stateSnapshot = parseRecordSafe(policy.stateCurrent.snapshot);
        const prevQuoteData = parseRecordSafe(stateSnapshot.quoteData);

        // Retrieve the latest bound transaction to calculate difference
        const latestBound = await tenantScopedPrisma.riskTransaction.findFirst({
            where: { policyId: policy.id, status: 'BOUND' },
            orderBy: { transactionNumber: 'desc' }
        });

        if (!latestBound) {
            return res.status(400).json({ success: false, error: { message: 'Policy has no bound transactions' } });
        }

        const prevPricingFinal = parseRecordSafe(latestBound.pricingFinal);
        const oldAnnualPremium = Number(prevPricingFinal.premium || 0) || 0;

        // Apply Endorsement Changes
        const mergedQuoteData = { ...prevQuoteData, ...parsed.data.changes };
        const dayMs = 24 * 60 * 60 * 1000;
        const effectiveDateForMbe = new Date(parsed.data.effectiveDate);
        const policyEndForMbe = policy.expiryDate ? new Date(policy.expiryDate) : new Date(effectiveDateForMbe.getTime() + 365 * dayMs);
        const remainingDaysForMbe = Math.max(1, Math.floor((policyEndForMbe.getTime() - effectiveDateForMbe.getTime()) / dayMs));
        const remainingTermMonthsForMbe = Math.max(1, Math.round((remainingDaysForMbe / 30.4375) * 100) / 100);
        (mergedQuoteData as Record<string, unknown>).__mbePolicyTermMonths = remainingTermMonthsForMbe;

        const quoteValidation = validateDraftQuote({
            quoteData: mergedQuoteData,
            step: 'public-v1-endorsement',
            mode: 'issuance',
            productType: policy.productType || undefined,
        });

        if (!quoteValidation.valid) {
            return res.status(400).json({
                success: false,
                error: { message: 'Endorsement data failed canonical validation', details: quoteValidation.schemaIssues }
            });
        }

        // Rate the new data via product adapter
        const policyProductType = String(policy.productType || '').toUpperCase();
        if (!policyProductType) {
            return res.status(400).json({ success: false, error: { message: 'Policy has no product type assigned; cannot quote endorsement' } });
        }
        if (!productAdapterExists(policyProductType)) {
            return res.status(400).json({ success: false, error: { message: `No product adapter for type '${policyProductType}'` } });
        }

        const binderProductAuthorityId = policy.binderId
            ? (await tenantScopedPrisma.binderProductAuthority.findUnique({
                where: { binderId_productCode: { binderId: policy.binderId, productCode: policyProductType } },
                select: { id: true },
            }))?.id || null
            : null;
        const programmeContext = await resolvePublishedProgramQuoteContext({
            productType: policyProductType,
            programId: String(policy.programId || '').trim(),
            binderProductAuthorityId: String(binderProductAuthorityId || '').trim(),
            quoteData: quoteValidation.normalizedQuoteData,
        });
        const resolvedCoverageSet = programmeContext.resolvedCoverageSet;
        const { quoteResponse } = await buildQuoteResponseForProduct({
            productType: policyProductType,
            quoteData: quoteValidation.normalizedQuoteData,
            programId: policy.programId,
            binderProductAuthorityId,
            programDefinition: programmeContext.programDefinition,
            resolvedCoverageSet,
        });
        const currency = String(quoteResponse.currency || policy.binder?.defaultCurrency || 'EUR');

        if (quoteResponse.status === 'declined') {
            return res.status(400).json({ success: false, error: { message: 'Endorsement declined by underwriting', details: quoteResponse.warnings } });
        }

        const primaryOption = parseRecordSafe(quoteResponse.primaryOption);
        const newAnnualPremium = Number(primaryOption.annualPremium || 0) || 0;

        // Pro-Rata Calculation
        const effectiveDate = new Date(parsed.data.effectiveDate);
        const policyEnd = policy.expiryDate ? new Date(policy.expiryDate) : new Date(effectiveDate.getTime() + 365 * 24 * 60 * 60 * 1000);
        const policyStart = policy.inceptionDate ? new Date(policy.inceptionDate) : new Date(effectiveDate.getTime() - 10 * 24 * 60 * 60 * 1000);

        const totalDays = Math.max(1, Math.floor((policyEnd.getTime() - policyStart.getTime()) / dayMs));
        const daysRemaining = Math.max(0, Math.floor((policyEnd.getTime() - effectiveDate.getTime()) / dayMs));

        const rawDifference = newAnnualPremium - oldAnnualPremium;
        const premiumDifferenceRaw = rawDifference * (daysRemaining / totalDays);
        const premiumDifference = Math.round(premiumDifferenceRaw * 100) / 100;

        // Create the Draft Risk Transaction
        const nextTxnNumber = (latestBound.transactionNumber || 0) + 1;
        const draftSnapshot = {
            ...stateSnapshot,
            quoteData: quoteValidation.normalizedQuoteData,
            quoteResponse: quoteResponse
        };

        const draftRiskTxnData: WithoutTenantScope<Prisma.RiskTransactionUncheckedCreateInput> = {
            policyId: policy.id,
            programId: policy.programId,
            transactionNumber: nextTxnNumber,
            transactionType: 'ENDORSEMENT',
            status: 'DRAFT',
            effectiveDate: effectiveDate,
            changeReason: parsed.data.reason || 'Public API Endorsement',
            createdBy: 'system',
            snapshotDraft: JSON.stringify(draftSnapshot),
            pricingFinal: JSON.stringify({ premium: newAnnualPremium, currency, quoteResponse, quoteData: quoteValidation.normalizedQuoteData }),
        };
        const draftTx = await tenantScopedPrisma.riskTransaction.create({
            data: draftRiskTxnData as Prisma.RiskTransactionUncheckedCreateInput,
        });

        return res.status(200).json({
            success: true,
            data: {
                quoteId: draftTx.id,
                status: 'DRAFT',
                premiumDifference: premiumDifference,
                effectiveDate: draftTx.effectiveDate?.toISOString() || parsed.data.effectiveDate,
            },
        });

    } catch (err) {
        logger.error({ err }, 'Error POST /v1/policies/:id/endorsements/quote');
        return res.status(500).json({ success: false, error: { message: 'Failed to quote endorsement' } });
    }
});

router.post('/:policyId/endorsements/bind', async (req, res) => {
    try {
        const policyId = req.params.policyId;
        const requestAccount = req.apiAccount;

        if (!requestAccount) return res.status(401).json({ success: false, error: { message: 'Unauthorized' } });

        const parsed = EndorsementBindRequestSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.format() });

        const policy = await tenantScopedPrisma.policy.findFirst({
            where: { id: policyId, accountId: requestAccount.id },
            include: { stateCurrent: true }
        });

        if (!policy || !policy.stateCurrent) {
            return res.status(404).json({ success: false, error: { message: 'Policy not found or unauthorized' } });
        }

        const draftTx = await tenantScopedPrisma.riskTransaction.findFirst({
            where: { id: parsed.data.quoteId, policyId: policy.id, status: 'DRAFT', transactionType: 'ENDORSEMENT' }
        });

        if (!draftTx) {
            return res.status(400).json({ success: false, error: { message: 'Valid draft endorsement quote not found' } });
        }

        function parseRecordSafe(value: unknown): Record<string, unknown> {
            if (typeof value === 'string') {
                try { value = JSON.parse(value); } catch { return {}; }
            }
            return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
        }

        const stateSnapshot = parseRecordSafe(draftTx.snapshotDraft);
        const pricingFinal = parseRecordSafe(draftTx.pricingFinal);
        const qd = parseRecordSafe(pricingFinal.quoteData);
        const qr = parseRecordSafe(pricingFinal.quoteResponse);
        // The issued-pack worker consumes the immutable risk-transaction
        // snapshot, not the mutable policy-state projection. Keep both
        // canonical quote payloads on that evidence before its outbox event
        // is committed.
        const finalizedSnapshot = { ...stateSnapshot, quoteData: qd, quoteResponse: qr };

        const { enqueueIssuedPolicyPack: enqueueIssuedPolicyPackInTx } = await import('../app/commands/issuedPackEnqueue.js');
        // ADR-0013 — bind the endorsement and schedule the issued-pack
        // regeneration in a single transaction so the doc-pack outbox
        // row commits atomically with the BOUND status update. No
        // post-transaction enqueue / fallback path remains.
        await runTenantScopedTransaction(async (_tx) => {
            const tx = _tx as Prisma.TransactionClient;
            await tx.riskTransaction.update({
                where: { id: draftTx.id },
                data: {
                    status: 'BOUND',
                    snapshotFinal: JSON.stringify(finalizedSnapshot),
                }
            });

            await tx.policyStateCurrent.update({
                where: { policyId: policy.id },
                data: {
                    snapshot: JSON.stringify(finalizedSnapshot)
                }
            });

            await enqueueIssuedPolicyPackInTx(tx, {
                policyId: policy.id,
                riskTransactionId: draftTx.id,
                source: 'API',
                generatedByUserId: requestAccount.id || null,
                idempotencyKey: `issued-pack:${policy.id}:${draftTx.id}`,
                correlationId: req.correlationId || undefined,
            });
        });

        return res.json({
            success: true,
            message: 'Endorsement bound successfully. New documents will be generated async.'
        });
    } catch (err) {
        logger.error({ err }, 'Error POST /v1/policies/:id/endorsements/bind');
        return res.status(500).json({ success: false, error: { message: 'Failed to bind endorsement' } });
    }
});

export default router;

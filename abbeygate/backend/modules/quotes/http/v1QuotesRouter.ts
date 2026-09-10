import type { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import { openApiRegistry, ErrorResponseSchema } from '../../../platform/openapi/openapi.js';
import { logger } from '../../../platform/utils/logger.js';
import { quoteDataTransportSchema } from '../../policy/app/quoteDataSchema.js';
import { buildQuoteResponseForProduct, productAdapterExists } from '../../policy/app/productRegistryService.js';
import { normalizeProgramMbeProductConfig, resolveCoverageV1 } from '../../policy/app/mbeInterop.js';
import { computePricingIntegrityStamp } from '../../policy/app/pricing/pricingIntegrityStamp.js';
import { parseRecord } from '../../../platform/json/parseRecord.js';

function quoteCurrency(quoteResponse: unknown, fallback: string): string {
    const q = parseRecord(quoteResponse);
    return String(q.currency || fallback);
}

function quotePrimaryAnnualPremium(quoteResponse: unknown): number {
    const q = parseRecord(quoteResponse);
    const primary = parseRecord(q.primaryOption);
    return Number(primary.annualPremium ?? primary.totalPremium ?? q.annualPremium ?? 0) || 0;
}

const router = Router();

const QuoteDataSchema = quoteDataTransportSchema.openapi({
    description: 'The complete flat JSON dictionary containing all answers to the underlying insurance questionnaire product.'
});

const QuoteRequestSchema = openApiRegistry.register('QuoteRequest', z.object({
    programId: z.string().uuid().describe('The Unique Identifier for the target insurance product being quoted'),
    quoteData: QuoteDataSchema,
    effectiveDate: z.string().datetime().describe('The proposed inception date of the insurance contract'),
    endorsements: z.object({
        coverageSelection: z.object({
            selected: z.record(z.string(), z.boolean()).optional().describe('Canonical coverage contract selection map by endorsement code'),
            params: z.record(z.string(), z.record(z.string(), z.unknown())).optional().describe('Canonical parameter payloads mapped by endorsement code'),
        }).optional().describe('Canonical endorsement selection contract')
    }).optional().describe('Dynamic configuration to inject optional covers, adjust excesses, or accept warranties')
}).openapi({
    example: {
        programId: "e9f8a000-84b2-4d1e-bd15-0d6789b52000",
        quoteData: {
            firstName: "Jane",
            lastName: "Doe",
            email: "jane.doe@example.com",
            telephone: "+44 7700 900077",
            dateOfBirth: "1985-06-15T00:00:00.000Z",
            vehicleValue: 15000,
            engineSize: 1500,
            vehicleType: "Private Car",
            coverRequired: "Comprehensive",
            licenseType: "Full",
            licenseYears: 10,
            hasClaims: false,
            hasConvictions: false,
            year: 2018,
            make: "Toyota",
            model: "Corolla",
            countryOfRegistration: "Cyprus"
        },
        effectiveDate: "2026-03-01T00:00:00.000Z",
        endorsements: {
            coverageSelection: {
                selected: {
                    "CV 172": true
                },
                params: {
                    "CV 172": {
                        "limit_eur": 5000
                    }
                }
            }
        }
    }
}));

const QuoteResponseEndorsementsSchema = z.object({
    applied: z.array(z.object({
        code: z.string(),
        params: z.record(z.string(), z.unknown()).optional()
    })).describe('The evaluated, final list of Covers, Excesses, and Warranties injected into this premium by the Rules Engine.')
});

const QuoteResponseSchema = openApiRegistry.register('QuoteResponse', z.object({
    quoteId: z.string().uuid().describe('The stateful database ID of the generated quote'),
    quoteToken: z.string().describe('A secure transaction token valid for binding this exact rate'),
    programId: z.string().uuid(),
    status: z.enum(['DRAFT', 'QUOTED', 'REFERRED', 'DECLINED']),
    premiumCalculated: z.number().describe('The firm quoted premium (inclusive of taxes and commissions) to present to the user'),
    coverages: z.array(z.string()).describe('List of covered perils/modules dynamically included in this price'),
    endorsements: QuoteResponseEndorsementsSchema.optional(),
    warnings: z.array(z.string()).optional().describe('Actionable Underwriting triggers (e.g., Driver Age < 21)'),
    referralMessage: z.string().optional().describe('Message detailing what manual adjustments are needed if REFERRED'),
    expiresAt: z.string().datetime().describe('Timestamp when this rate guarantee expires')
}).openapi({
    example: {
        quoteId: "d4b1a201-44b0-4e0a-bf15-1d6789c52001",
        quoteToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
        programId: "e9f8a000-84b2-4d1e-bd15-0d6789b52000",
        status: "QUOTED",
        premiumCalculated: 1250.50,
        coverages: ["BASE_LIABILITY", "PROPERTY_DAMAGE"],
        endorsements: {
            applied: [
                { code: "CV 24", params: { "limit_eur": 500 } },
                { code: "CV 172", params: { "limit_eur": 5000 } }
            ]
        },
        expiresAt: "2026-03-31T00:00:00.000Z"
    }
}));

openApiRegistry.registerPath({
    method: 'post',
    path: '/v1/quotes',
    operationId: 'generateQuote',
    summary: 'Generate Insurance Quote',
    description: 'Submits required risk factors and optional endorsement overrides against a product to instantly execute the proprietary rating engine, yielding a firm, bindable premium quote.',
    tags: ['3. Quote & Bind'],
    request: {
        body: { content: { 'application/json': { schema: QuoteRequestSchema } } }
    },
    responses: {
        201: {
            description: 'Quote successfully generated',
            content: { 'application/json': { schema: z.object({ success: z.boolean(), data: QuoteResponseSchema }) } }
        },
        400: { description: 'Validation or Underwriting decline', content: { 'application/json': { schema: ErrorResponseSchema } } },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
        404: { description: 'Program not found', content: { 'application/json': { schema: ErrorResponseSchema } } }
    }
});

router.post('/', async (req, res) => {
    try {
        const parsed = QuoteRequestSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ success: false, error: parsed.error.format() });
        }

        const requestAccount = req.apiAccount;
        if (!requestAccount) return res.status(401).json({ success: false, error: { message: 'Unauthorized' } });

        const program = await tenantScopedPrisma.program.findFirst({
            where: { id: parsed.data.programId, status: 'ACTIVE' }
        });

        if (!program) {
            return res.status(404).json({ success: false, error: { message: 'Program not found or inactive' } });
        }

        const resolvedProductType = String(program.productType || '').trim().toUpperCase();
        if (!resolvedProductType) {
            return res.status(400).json({ success: false, error: { message: 'Program is missing productType' } });
        }

        const { signQuoteToken } = await import('../../pricing/app/quoteToken.js');
        const activeBinderLink = await tenantScopedPrisma.programBinderLink.findFirst({
            where: {
                programId: program.id,
                status: 'ACTIVE',
                binder: {
                    status: 'ACTIVE',
                    productAuthorities: {
                        some: { productCode: resolvedProductType, status: 'ACTIVE' },
                    },
                },
            },
            include: { binder: { select: { id: true } } },
            orderBy: { updatedAt: 'desc' },
        });

        // Dynamically compute the authoritative quote using provided uwAnswers. Let demographic/contact drop down as they're not rated factors.
        const { validateDraftQuote } = await import('../app/validator.js');
        const compliance = validateDraftQuote({
            quoteData: parsed.data.quoteData,
            step: 'public-v1-quote',
            mode: 'api',
            productType: resolvedProductType,
        });

        if (!compliance.valid) {
            const msgs = compliance.blockingErrors.map((e) => e.message || e.slug).join(' | ');
            return res.status(400).json({ success: false, error: { message: `Questionnaire Validation Failed: ${msgs}` } });
        }

        const mergedQuoteData = compliance.normalizedQuoteData;
        const mergedQuoteDataRecord: Record<string, unknown> = { ...mergedQuoteData };

        // Fetch Program Configuration and Resolve Requested Endorsements via Rules Engine
        const normalizedMbeCfg = normalizeProgramMbeProductConfig(
            program.metadata && typeof program.metadata === 'object' && (program.metadata as Record<string, unknown>).mbeProductConfig,
            {
                productType: String(program.productType || ''),
                programCode: `abbeygate_${String(program.productType || '').trim().toLowerCase()}`,
            }
        );

        const selectedOptions = parsed.data.endorsements?.coverageSelection?.selected;
        const paramsByCode = parsed.data.endorsements?.coverageSelection?.params;

        const resolvedCoverageSet = resolveCoverageV1({
            productType: String(program.productType || ''),
            quoteData: mergedQuoteDataRecord,
            cfg: normalizedMbeCfg,
            selectedOptions,
            paramsByCode,
        });

        const programMeta = program.metadata && typeof program.metadata === 'object' ? program.metadata as Record<string, unknown> : {};
        if (!productAdapterExists(resolvedProductType)) return res.status(400).json({ success: false, error: { message: `No product adapter for: ${resolvedProductType}` } });

        const { quoteResponse } = await buildQuoteResponseForProduct({ productType: resolvedProductType, quoteData: mergedQuoteData, programMeta, resolvedCoverageSet });

        const totalPremium = quotePrimaryAnnualPremium(quoteResponse);
        const qCurrency = quoteCurrency(quoteResponse, 'EUR');
        const pricingStamp = computePricingIntegrityStamp({
            quoteData: mergedQuoteData,
            quoteResponse,
        });

        const { token: quoteToken } = signQuoteToken({
            productType: resolvedProductType,
            quoteData: mergedQuoteDataRecord,
            overrideExcess: null,
            premium: totalPremium,
            currency: qCurrency,
        });

        const qr = parseRecord(quoteResponse);
        const isDeclined = String(qr.status).toLowerCase() === 'declined';
        const isReferred = String(qr.status).toLowerCase() === 'referral';

        const finalStatus = isDeclined ? 'DECLINED' : (isReferred ? 'REFERRED' : 'QUOTED');
        const expirationBase = new Date(String(qr.validUntil || new Date(Date.now() + 30 * 86400000).toISOString()));

        // Create the stateful Quote record in the database so that the Bind API can hydrate it flawlessly
        const proposerForRecord = parseRecord(parsed.data.quoteData.proposer);
        const proposerForRecordAddress = parseRecord(proposerForRecord.address);
        const policyHolderName = `${String(proposerForRecord.firstName || '').trim()} ${String(proposerForRecord.lastName || '').trim()}`.trim();
        const policyHolderAddress = String(proposerForRecordAddress.line1 || 'TBP');

        let policyHolder = await tenantScopedPrisma.policyHolder.findFirst({
            where: {
                name: policyHolderName,
                contact: { contains: String(proposerForRecord.email || '') }
            }
        });

        if (!policyHolder) {
            policyHolder = await tenantScopedPrisma.policyHolder.create({
                data: {
                    name: policyHolderName,
                    segment: 'Auto Insurance',
                    address: policyHolderAddress,
                    contact: JSON.stringify({
                        email: String(proposerForRecord.email || ''),
                        phone: String(proposerForRecord.phone || ''),
                        dateOfBirth: String(proposerForRecord.dateOfBirth || ''),
                    }),
                } as unknown as Prisma.PolicyHolderUncheckedCreateInput,
            });
        }

        const inceptionDate = new Date(parsed.data.effectiveDate);
        const expiryDate = new Date(inceptionDate);
        expiryDate.setFullYear(expiryDate.getFullYear() + 1);

        const { generateQuoteId } = await import('../../../platform/utils/platformIds.js');
        const policyNumber = await generateQuoteId(resolvedProductType);

        const policy = await tenantScopedPrisma.policy.create({
            data: {
                accountId: requestAccount.id,
                programId: program.id,
                binderId: activeBinderLink?.binder.id || null,
                policyNumber,
                status: finalStatus,
                productType: resolvedProductType,
                policyHolderId: policyHolder.id,
                inceptionDate,
                expiryDate,
                quoteData: JSON.stringify(mergedQuoteData),
                quoteResponse: JSON.stringify(quoteResponse),
            } as unknown as Prisma.PolicyUncheckedCreateInput,
        });

        // Current state snapshot
        await tenantScopedPrisma.policyStateCurrent.create({
            data: {
                policyId: policy.id,
                snapshot: JSON.stringify({
                    quoteData: mergedQuoteData,
                    quoteResponse,
                    pricing: pricingStamp,
                    uw: {
                        schemaVersion: 1,
                        completedAt: new Date().toISOString(),
                        validationResult: { isValid: true, errors: [] },
                    },
                })
            } as unknown as Prisma.PolicyStateCurrentUncheckedCreateInput,
        });

        const po = parseRecord(qr.primaryOption);
        const coveragesList = (Array.isArray(po.coverages) ? po.coverages : []).map((c: unknown) => {
            const cr = parseRecord(c);
            return cr.name || cr.id || String(c);
        });

        return res.status(201).json({
            success: true,
            data: {
                quoteId: policy.id, // Stateful reference for the /bind API
                quoteToken: quoteToken, // Cryptographic validation token
                programId: program.id,
                status: finalStatus,
                premiumCalculated: totalPremium,
                coverages: coveragesList,
                endorsements: { applied: resolvedCoverageSet.applied },
                warnings: Array.isArray(qr.warnings) ? qr.warnings : [],
                referralMessage: typeof qr.referralMessage === 'string' ? qr.referralMessage : undefined,
                expiresAt: expirationBase.toISOString()
            }
        });

    } catch (err) {
        logger.error({ err }, 'Error POST /v1/quotes');
        return res.status(500).json({ success: false, error: { message: 'Failed to generate quote' } });
    }
});

export default router;

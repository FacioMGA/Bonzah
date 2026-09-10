import type { Prisma } from '@prisma/client';
import { getTenantConfig } from '../../../platform/tenant/tenantConfig.js';
import { prisma, tenantScopedPrisma, runTenantScopedTransaction } from '../../../platform/db/connection.js';
import { AuditLogger } from '../../../platform/audit/logger.js';
import { enqueuePolicyListIndexUpdate } from '../infra/projections/policyListIndex.js';
import { validateDraftQuote } from '../../quotes/app/validator.js';
import {
    resolveAnnualPolicyExpiryDate,
    resolveInceptionDateFromRenewalDate,
} from '../../../platform/utils/mappingHelpers.js';
import { logger } from '../../../platform/utils/logger.js';
import type { IssueOrigin } from '../../../platform/utils/policyNumberScheme.js';
import { determinePostBindLifecycleStatus } from '../domain/issuance.js';


import {
    parseRecord,
    quoteCurrency,
    quotePrimaryAnnualPremium,
    getMethod,
} from '../../../platform/utils/mappingHelpers.js';
import { jsonStringify } from '../../policy/app/shared.js';
import { buildUnderwritingAnalysis } from '../../underwriting/domain/underwritingAnalysis.js';
import { ProductRegistry } from '../domain/ProductRegistry.js';
import { buildQuoteResponseForProduct, resolvePublishedProgramQuoteContext } from './productRegistryService.js';

function parseDateOnlyLocal(raw: string): Date | null {
    const match = String(raw || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
        const parsed = new Date(raw);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
    return new Date(year, month - 1, day);
}

function resolvePolicyInceptionDate(productType: string, quoteData: unknown): Date {
    const normalizedProduct = String(productType || '').trim().toUpperCase();
    const quoteRecord = parseRecord(quoteData);
    if (normalizedProduct === 'HOME') {
        const policy = quoteRecord.policy && typeof quoteRecord.policy === 'object'
            ? quoteRecord.policy as { startDate?: unknown }
            : {};
        const startDateRaw = String(policy.startDate || '').trim();
        if (!startDateRaw) throw new Error('Home policy start date is required');
        const parsed = parseDateOnlyLocal(startDateRaw);
        if (!parsed) throw new Error('Home policy start date is invalid');
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const selected = new Date(parsed);
        selected.setHours(0, 0, 0, 0);
        if (selected < today) throw new Error('Home policy start date must be today or later');
        return parsed;
    }
    return resolveInceptionDateFromRenewalDate(quoteRecord.renewalDate);
}

export interface CreateFromQuoteActor {
    id: string | null;
    name: string | null;
    email: string | null;
    role: string | null;
}

export interface CreateFromQuoteInput {
    quoteData: unknown;
    paymentInfo: unknown;
    quoteToken?: string;
    actor: CreateFromQuoteActor;
}

export type UseCaseResult<T> =
    | { status: 'SUCCESS'; data: T }
    | { status: 'INVALID_DATA' | 'TOKEN_REQUIRED' | 'TOKEN_MISMATCH' | 'PRICE_MISMATCH' | 'TOKEN_INVALID' | 'NO_QUOTE' | 'SERVER_ERROR'; error: unknown; reasons?: unknown };

export async function executeCreateFromQuote(input: CreateFromQuoteInput): Promise<UseCaseResult<Record<string, unknown>>> {
    const { actor, quoteToken } = input;
    const rawQuoteData = parseRecord(input.quoteData);
    const paymentInfo = parseRecord(input.paymentInfo);

    const rawQuoteMeta = parseRecord(parseRecord(rawQuoteData).__meta);
    const quoteProgramId = String(rawQuoteMeta.programId || '').trim();
    const program = quoteProgramId
        ? await tenantScopedPrisma.program.findUnique({
            where: { id: quoteProgramId },
            select: { id: true, productType: true },
        })
        : null;
    const productType = String(program?.productType || '').trim().toUpperCase();
    if (!program || !productType) {
        return {
            status: 'INVALID_DATA',
            error: { code: 'PRODUCT_TYPE_REQUIRED', message: 'Quote data is missing product context (__meta.programId -> productType).' },
        };
    }
    const quoteValidation = validateDraftQuote({
        quoteData: rawQuoteData,
        step: 'bo-create-from-quote',
        mode: 'issuance',
        productType,
    });
    if (!quoteValidation.valid) {
        return {
            status: 'INVALID_DATA',
            error: { code: 'QUOTE_DATA_INVALID', details: quoteValidation.schemaIssues },
        };
    }

    const normalizedQuoteData = quoteValidation.normalizedQuoteData;
    const quoteData = normalizedQuoteData;
    const tokenQuoteDataRecord: Record<string, unknown> = { ...normalizedQuoteData };
    const adapter = ProductRegistry.getInstance().getAdapter(productType);
    if (!adapter) throw new Error(`No product adapter for: ${productType}`);
    const binderLink = await tenantScopedPrisma.programBinderLink.findFirst({
        where: {
            programId: program.id,
            status: 'ACTIVE',
            binder: {
                status: 'ACTIVE',
                productAuthorities: { some: { productCode: productType, status: 'ACTIVE' } },
            },
        },
        include: {
            binder: {
                select: {
                    productAuthorities: {
                        where: { productCode: productType, status: 'ACTIVE' },
                        select: { id: true },
                        take: 1,
                    },
                },
            },
        },
        orderBy: { updatedAt: 'desc' },
    });
    const binderProductAuthorityId = binderLink?.binder.productAuthorities[0]?.id || null;
    if (!binderProductAuthorityId) {
        return {
            status: 'INVALID_DATA',
            error: { code: 'PROGRAM_AUTHORITY_REQUIRED', message: 'Quote programme has no active binder authority.' },
        };
    }
    const programmeContext = await resolvePublishedProgramQuoteContext({
        productType,
        programId: program.id,
        binderProductAuthorityId,
        quoteData,
    });
    const { quoteResponse, underwritingAnalysis } = await buildQuoteResponseForProduct({
        productType,
        quoteData,
        programId: program.id,
        binderProductAuthorityId,
        programDefinition: programmeContext.programDefinition,
        resolvedCoverageSet: programmeContext.resolvedCoverageSet,
    });
    const analysis = parseRecord(underwritingAnalysis);
    const quoteResponseRecord = parseRecord(quoteResponse);
    const rawUwDecision = parseRecord(quoteResponseRecord.uwDecision);
    const uwDecision = Object.keys(rawUwDecision).length > 0 ? rawUwDecision : analysis;

    const isProd = (process.env.NODE_ENV || 'development') === 'production';
    if (isProd) {
        const tok = String(quoteToken || '').trim();
        if (!tok) {
            return { status: 'TOKEN_REQUIRED', error: { code: 'QUOTE_TOKEN_REQUIRED', message: 'quoteToken is required' } };
        }
        try {
            const { verifyQuoteToken, computeQuoteInputHash, resolveEffectiveExcess } = await import('../../pricing/app/quoteToken.js');
            const payload = verifyQuoteToken(tok);
            const expectedHash = computeQuoteInputHash({
                productType,
                quoteData: tokenQuoteDataRecord,
                overrideExcess: resolveEffectiveExcess(tokenQuoteDataRecord, null),
                currency: quoteCurrency(quoteResponse, 'EUR'),
            });
            const computedPremium = quotePrimaryAnnualPremium(quoteResponse);
            if (payload.pt !== productType || payload.ih !== expectedHash) {
                return { status: 'TOKEN_MISMATCH', error: { code: 'QUOTE_TOKEN_MISMATCH', message: 'Quote token does not match quote inputs' } };
            }
            if (Number(payload.p || 0) !== computedPremium || String(payload.c || '') !== quoteCurrency(quoteResponse, 'EUR')) {
                return { status: 'PRICE_MISMATCH', error: { code: 'PRICE_MISMATCH', message: 'Quoted price no longer matches current rating' } };
            }
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : 'Invalid quote token';
            return { status: 'TOKEN_INVALID', error: { code: 'QUOTE_TOKEN_INVALID', message } };
        }
    }

    try {
        const { generatePolicyId, generateQuoteId } = await import('../../../platform/utils/platformIds.js');

        const productFields = adapter.buildProductFields(quoteData);
        const vehicleInfo = parseRecord(productFields.vehicleInfo);
        const driverInfo = parseRecord(productFields.driverInfo);

        const quoteDataRecord = parseRecord(quoteData);
        const proposer = parseRecord(quoteDataRecord.proposer);
        const proposerAddress = parseRecord(proposer.address);
        const policyHolderName = `${proposer.firstName ?? ''} ${proposer.lastName ?? ''}`.trim();
        const quoteCountry = String(proposerAddress.country || proposer.domicileCountry || quoteData.countryOfRegistration || '');
        const policyHolderAddress = [
            proposerAddress.line1,
            proposerAddress.city,
            proposerAddress.province,
            proposerAddress.postcode,
            quoteCountry,
        ].filter(Boolean).join(', ');

        let policyHolder = await tenantScopedPrisma.policyHolder.findFirst({
            where: { name: policyHolderName, address: policyHolderAddress }
        });

        if (!policyHolder) {
            policyHolder = await tenantScopedPrisma.policyHolder.create({
                data: {
                    name: policyHolderName,
                    segment: 'Auto Insurance',
                    address: policyHolderAddress,
                    contact: JSON.stringify({
                        email: proposer.email,
                        phone: proposer.phone,
                        nationality: proposer.nationality,
                        nif: proposer.nif,
                        occupation: proposer.occupation,
                        dateOfBirth: proposer.dateOfBirth,
                    }),
                } as unknown as Prisma.PolicyHolderUncheckedCreateInput,
            });
        }

        let accountId: string | null = null;
        let insuredEntityId: string | null = null;
        if (String(actor?.role || '').toUpperCase() === 'CUSTOMER') {
            const u = actor.id ? await prisma.user.findUnique({ where: { id: actor.id }, select: { id: true, email: true, primaryAccountId: true, name: true } }) : null;
            accountId = u?.primaryAccountId ? String(u.primaryAccountId) : null;
            if (!accountId) {
                accountId = await runTenantScopedTransaction(async (_tx) => {
                  const tx = _tx as unknown as Prisma.TransactionClient;
                    if (!u?.id) throw new Error('Authenticated customer user not found');
                    const accountDelegate = Reflect.get(tx, 'account');
                    const accountUserDelegate = Reflect.get(tx, 'accountUser');
                    const accountCreate = getMethod(accountDelegate, 'create');
                    const accountUserCreate = getMethod(accountUserDelegate, 'create');
                    if (!accountCreate || !accountUserCreate) throw new Error('Account delegates are unavailable');
                    const account = parseRecord(await accountCreate({
                        data: { kind: 'CUSTOMER', name: u.name || policyHolderName || u.email }
                    }));
                    const accountIdCreated = String(account.id || '');
                    await accountUserCreate({
                        data: { accountId: accountIdCreated, userId: u.id, role: 'OWNER' }
                    });
                    await tx.user.update({ where: { id: u.id }, data: { primaryAccountId: accountIdCreated } });
                    return accountIdCreated;
                });
            }

            const entityDelegate = Reflect.get(prisma, 'entity');
            const entityCreate = getMethod(entityDelegate, 'create');
            if (entityCreate && accountId) {
                const insuredEntity = parseRecord(await entityCreate({
                    data: {
                        accountId,
                        type: 'PERSON',
                        name: policyHolderName,
                        data: {
                            email: proposer.email,
                            phone: proposer.phone,
                            nationality: proposer.nationality,
                            nif: proposer.nif,
                            occupation: proposer.occupation,
                            dateOfBirth: proposer.dateOfBirth,
                            address: {
                                addressLine: proposerAddress.line1,
                                city: proposerAddress.city,
                                province: proposerAddress.province,
                                postCode: proposerAddress.postcode,
                                country: quoteCountry,
                            },
                        },
                    }
                }));
                insuredEntityId = String(insuredEntity.id || '');

                await Promise.resolve(entityCreate({
                    data: {
                        accountId,
                        type: 'VEHICLE',
                        name: [quoteData.make, quoteData.model, quoteData.registrationNumber].filter(Boolean).join(' ').trim() || 'Vehicle',
                        data: vehicleInfo,
                    }
                })).catch(() => undefined);
            }
        }

        const explicitPeriod = ProductRegistry.getInstance().getAdapter(productType)?.resolvePolicyPeriod?.(quoteData);
        const inceptionDate = explicitPeriod?.inceptionDate ?? resolvePolicyInceptionDate(productType, quoteData);
        const expiryDate = explicitPeriod?.expiryDate ?? resolveAnnualPolicyExpiryDate(inceptionDate);

        if (uwDecision.outcome === 'decline') {
            return { status: 'NO_QUOTE', error: 'NO_QUOTE', reasons: uwDecision.reasons };
        }

        const now = new Date();
        const nextStatus = paymentInfo?.status === 'paid'
            ? determinePostBindLifecycleStatus(inceptionDate, now)
            : uwDecision.outcome === 'referral' ? 'REFERRAL' : 'QUOTED';

        // Origin follows who is issuing (ADR-0061): a customer self-onboarding —
        // including an immediate paid issuance — is an ONLINE sale; an operator
        // entering the policy is MANUAL. Non-Santam products ignore origin.
        const issueOrigin: IssueOrigin = String(actor?.role || '').toUpperCase() === 'CUSTOMER' ? 'ONLINE' : 'MANUAL';
        const policyNumber = (nextStatus === 'ISSUED' || nextStatus === 'ACTIVE') ? await generatePolicyId(productType, issueOrigin) : await generateQuoteId(productType);

        const policyData: Prisma.PolicyUncheckedCreateInput = {
            operatingTenantId: getTenantConfig().id,
            policyNumber,
            productType,
            status: nextStatus,
            inceptionDate,
            expiryDate,
            policyHolderId: policyHolder.id,
            accountId,
            insuredEntityId,
            vehicleInfo: jsonStringify(vehicleInfo),
            driverInfo: jsonStringify(driverInfo),
            quoteData: jsonStringify(quoteData),
            quoteResponse: jsonStringify(quoteResponse),
        };
        const policy = await tenantScopedPrisma.policy.create({
            data: policyData,
            include: { policyHolder: true }
        });

        const stateData: Prisma.PolicyStateCurrentUncheckedCreateInput = {
            operatingTenantId: getTenantConfig().id,
            policyId: policy.id,
            snapshot: jsonStringify({
                quoteData,
                quoteResponse,
                uwDecision,
                underwritingAnalysis: buildUnderwritingAnalysis({ uwDecision, quoteResponse }),
                programDefinition: {
                    id: programmeContext.programDefinition.id,
                    programId: programmeContext.programDefinition.programId,
                    version: programmeContext.programDefinition.version,
                    pricingMode: programmeContext.programDefinition.pricingMode,
                    binderProductAuthorityId: programmeContext.programDefinition.binderProductAuthorityId,
                    underwriting: programmeContext.programDefinition.underwriting,
                    coverage: programmeContext.programDefinition.coverage,
                    questionnaire: programmeContext.programDefinition.questionnaire,
                    workflow: programmeContext.programDefinition.workflow,
                    channels: programmeContext.programDefinition.channels,
                    documents: programmeContext.programDefinition.documents,
                },
                vehicleInfo,
                driverInfo,
                paymentInfo,
            })
        };
        await tenantScopedPrisma.policyStateCurrent.create({
            data: stateData,
        });

        const searchData: Prisma.PolicySearchIndexUncheckedCreateInput = {
            operatingTenantId: getTenantConfig().id,
            policyId: policy.id,
            policyNumber: policy.policyNumber,
            insuredName: policyHolderName,
            status: policy.status,
            address: policyHolderAddress,
            segment: 'Auto Insurance',
            totalPremium: quotePrimaryAnnualPremium(quoteResponse),
        };
        await tenantScopedPrisma.policySearchIndex.create({ data: searchData });
        await enqueuePolicyListIndexUpdate(prisma, policy.id);

        const actorName = actor.name || actor.email || 'Self-Onboarding';
        void AuditLogger.log(
            policy.id,
            'POLICY',
            'POLICY.CREATED_FROM_QUOTE',
            actor.id || 'system',
            'USER',
            { policyNumber: policy.policyNumber, quoteReference: String(parseRecord(quoteResponse).reference || ''), premium: quotePrimaryAnnualPremium(quoteResponse) },
            actorName || undefined
        );

        return {
            status: 'SUCCESS',
            data: { policyId: policy.id, policyNumber: policy.policyNumber, policyHolderId: policyHolder.id, status: policy.status }
        };
    } catch (error: unknown) {
        logger.error({ err: error }, 'Create policy from quote error:');
        const message = error instanceof Error ? error.message : 'Failed to create policy from quote';
        return { status: 'SERVER_ERROR', error: message };
    }
}

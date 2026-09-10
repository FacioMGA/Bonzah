import type { Prisma } from '@prisma/client';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import { AuditLogger } from '../../../platform/audit/logger.js';
import { resolvePolicyUmrFromBinder } from './binders/binderAuthority.js';
import {
    isReservedQuoteId,
    reserveNextCertificateNumber,
    reserveNextPolicyId,
    shouldReassignPolicyNumberAtIssuance,
} from '../../../platform/utils/platformIds.js';
import { transitionPolicyLifecycle } from './commands/policyLifecycleCommands.js';
import { enqueueIssuedPolicyPack, enqueueIssuedPolicyPackStandalone } from './commands/issuedPackEnqueue.js';
import { enqueuePolicyListIndexUpdate } from '../infra/projections/policyListIndex.js';
import { enqueueAccounts360ProjectionUpdate } from '../../accounts360/infra/projections/accounts360Projection.js';
import { enqueueAccountIntelligenceProjectionUpdate } from '../../accounts360/infra/projections/accountIntelligenceProjection.js';
import { evaluateIssueReadiness } from './issueReadiness.js';
import { logger } from '../../../platform/utils/logger.js';
import { canTransitionToBind, assertNoPendingReferrals, determinePostBindLifecycleStatus } from '../domain/issuance.js';
import { ProductRegistry } from '../domain/ProductRegistry.js';
import { derivePremiumFinancials } from '../domain/premiumFinancials.js';
import { getSanctionsService, resolveIndividualScreeningSubject, SanctionsBlockError } from '../../compliance/app/index.js';

import {
    parseRecord,
    parseSnapshot,
    quoteCurrency,
    quotePrimaryAnnualPremium,
} from '../../../platform/utils/mappingHelpers.js';
import { jsonParse, jsonStringify } from '../../policy/app/shared.js';

export interface BindPolicyActor {
    id: string | null;
    name: string | null;
    email: string | null;
    role: string | null;
}

export interface BindPolicyInput {
    policyId: string;
    actor: BindPolicyActor;
    correlationId?: string;
    debugBind?: boolean;
}

export type UseCaseResult<T> =
    | { status: 'SUCCESS'; data: T }
    | { status: 'NOT_FOUND' | 'INVALID_STATUS' | 'BLOCKED' | 'SERVER_ERROR' | 'UNAUTHORIZED' | 'MISSING_TRANSACTION' | 'QUOTE_DATA_INVALID' | 'CONFLICT'; error: unknown };

const asRecord = (value: unknown): Record<string, unknown> =>
    value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};

function parseNumberish(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const text = String(value || '').replace(/[^\d.]/g, '');
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : 0;
}

function monthDiff(startDate: Date, endDate: Date): number {
    const years = endDate.getUTCFullYear() - startDate.getUTCFullYear();
    const months = endDate.getUTCMonth() - startDate.getUTCMonth();
    const days = endDate.getUTCDate() - startDate.getUTCDate();
    const total = years * 12 + months + (days >= 0 ? 0 : -1);
    return total < 0 ? 0 : total;
}

export async function executeBindPolicy(input: BindPolicyInput): Promise<UseCaseResult<Record<string, unknown>>> {
    const { policyId, actor, correlationId, debugBind } = input;
    const id = policyId;

    const candidate = await tenantScopedPrisma.policy.findUnique({
        where: { id },
        include: { policyHolder: true, binder: true }
    });

    if (!candidate) return { status: 'NOT_FOUND', error: { code: 'NOT_FOUND', message: 'Policy not found' } };

    const currentStatus = String(candidate.status || '').toUpperCase();

    const transitionCheck = canTransitionToBind(currentStatus);
    if (!transitionCheck.allowed) {
        return {
            status: 'INVALID_STATUS',
            error: {
                code: 'INVALID_STATUS',
                message: transitionCheck.reason,
            }
        };
    }

    if (currentStatus === 'ISSUING') {
        const pendingTxn = await tenantScopedPrisma.riskTransaction.findFirst({
            where: { policyId: id, transactionType: 'INCEPTION', status: { in: ['PENDING_DOCS', 'BOUND'] } },
            orderBy: { transactionNumber: 'desc' },
            select: { id: true },
        });
        if (!pendingTxn?.id) {
            return { status: 'MISSING_TRANSACTION', error: { code: 'MISSING_TRANSACTION', message: 'Policy is ISSUING but no INCEPTION transaction was found to resume.' } };
        }
        // ADR-0013 — resume-issuance path. Re-enqueue via the canonical
        // spine using a deterministic idempotencyKey: if the original
        // outbox row was already drained the relay's
        // `event_processing_log` skips redelivery, otherwise the relay
        // delivers it on the next tick. No fallback / parallel path.
        const docEvent = await enqueueIssuedPolicyPackStandalone({
            policyId: id,
            riskTransactionId: pendingTxn.id,
            source: 'BO',
            generatedByUserId: actor.id || null,
            idempotencyKey: `issued-pack:${id}:${pendingTxn.id}`,
            correlationId: correlationId || undefined,
        });
        return {
            status: 'SUCCESS',
            data: {
                status: 'ISSUING',
                riskTransactionId: pendingTxn.id,
                documentJobId: docEvent.eventId,
                message: 'Issuance is already in progress. Document generation was re-queued.',
            }
        };
    }

    const pendingEndorsements = await tenantScopedPrisma.endorsementInstance.count({
        where: { policyId: id, status: { in: ['PENDING', 'REFERRED'] } }
    });

    try {
        assertNoPendingReferrals(pendingEndorsements);
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Pending referrals block bind';
        return { status: 'BLOCKED', error: { code: 'PENDING_REFERRALS', message } };
    }

    const currentState = await tenantScopedPrisma.policyStateCurrent.findUnique({ where: { policyId: id } });
    const snapshotData = currentState ? parseSnapshot(jsonParse(currentState.snapshot as string | null)) : {};

    const quoteDataCandidate = parseRecord(snapshotData.quoteData || jsonParse(candidate.quoteData as string | null) || {});

    // Canonical funnel: every bind path runs through evaluateIssueReadiness.
    // It dispatches to the registered product adapter, recomputes the
    // pricing-integrity stamp, and enforces the canonical-ownership rules.
    // No parallel validation or premium fallback exists here.
    const readiness = await evaluateIssueReadiness(id, 'bo');
    if (!readiness.canIssue) {
        const quoteDataInvalid = (readiness.blockers || []).find((b) => b.code === 'QUOTE_DATA_INVALID');
        if (quoteDataInvalid) {
            return {
                status: 'QUOTE_DATA_INVALID',
                error: { code: 'QUOTE_DATA_INVALID', message: quoteDataInvalid.message, details: quoteDataInvalid.details },
            };
        }
        const blockMessage = (readiness.blockers || [])
            .filter((b) => (b.severity ?? 'BLOCK') === 'BLOCK')
            .map((b) => b.message)
            .join('; ') || 'Policy is not ready to bind.';
        return { status: 'BLOCKED', error: { code: 'NOT_READY_TO_BIND', message: blockMessage, blockers: readiness.blockers } };
    }
    const quoteData = quoteDataCandidate;
    const quoteResponse = parseRecord(snapshotData.quoteResponse || jsonParse(candidate.quoteResponse as string | null) || {});

    const screeningSubject = resolveIndividualScreeningSubject({
        policyHolderName: candidate.policyHolder?.name || null,
        quoteData,
    });
    if (!screeningSubject) {
        return {
            status: 'BLOCKED',
            error: {
                code: 'SANCTION_SCREENING_SUBJECT_MISSING',
                message: 'Cannot run sanctions screening because the insured person name is missing.',
            }
        };
    }
    try {
        await getSanctionsService().assertClearOrThrow({
            actionType: 'POLICY_BIND',
            policyId: id,
            subjectName: screeningSubject.subjectName,
            dateOfBirth: screeningSubject.dateOfBirth,
            correlationId: correlationId || `policy-bind:${id}`,
        });
    } catch (error) {
        if (error instanceof SanctionsBlockError) {
            return {
                status: 'BLOCKED',
                error: {
                    code: 'SANCTION_SCREENING_BLOCKED',
                    message: error.message,
                    screeningOutcome: error.outcome,
                    reasonCode: error.reasonCode,
                    providerSearchId: error.providerSearchId,
                }
            };
        }
        return {
            status: 'BLOCKED',
            error: {
                code: 'SANCTION_SCREENING_UNAVAILABLE',
                message: 'Sanctions screening is unavailable. Binding is blocked until screening succeeds.',
            }
        };
    }

    const productType = String(candidate.productType || '').toUpperCase();
    if (!productType) {
        return { status: 'BLOCKED', error: { code: 'MISSING_PRODUCT_TYPE', message: 'Policy is missing a productType and cannot be bound.' } };
    }

    // Premium MUST come from the canonical quoteResponse stamped at rate time.
    // Recomputing here would re-introduce the silent-divergence regression class
    // that `evaluateIssueReadiness` already prevents via PRICING_DRIFT.
    const finalPremium = quotePrimaryAnnualPremium(quoteResponse);
    if (!Number.isFinite(finalPremium) || finalPremium <= 0) {
        return {
            status: 'BLOCKED',
            error: {
                code: 'PRICING_INVALID',
                message: 'Final premium is missing on the rated snapshot. Re-rate before binding.',
            },
        };
    }
    const totalUnits = 1;

    // The policy's UMR is the bound binder's Unique Market Reference — the
    // delegated-authority agreement reference shown on every Lloyd's document.
    // It is resolved from the binder inside the transaction (see
    // `resolvePolicyUmrFromBinder`), never derived from the policy/quote number
    // and never fabricated.
    const now = new Date();
    const previewLifecycleStatus = determinePostBindLifecycleStatus(candidate.inceptionDate, now);

    try {
        const result = await tenantScopedPrisma.$transaction(async (_tx) => {
          const tx = _tx as unknown as Prisma.TransactionClient;
            const existingPolicyNumber = String(candidate.policyNumber || '').trim();
            const existingQuoteId = isReservedQuoteId(existingPolicyNumber) ? existingPolicyNumber : undefined;
            const policyBusinessId = shouldReassignPolicyNumberAtIssuance(productType, existingPolicyNumber)
                ? await reserveNextPolicyId(tx, productType, 'MANUAL')
                : existingPolicyNumber;
            const certificateNumber = candidate.certificateNumber || (await reserveNextCertificateNumber(tx));

            let binderIdToUse = candidate.binderId || undefined;
            if (!binderIdToUse) {
                const defaultBinder = await tx.binder.findFirst({ where: { status: 'ACTIVE' }, orderBy: { updatedAt: 'desc' } });
                binderIdToUse = defaultBinder?.id || undefined;
            }

            let programIdToUse = candidate.programId || undefined;
            if (!programIdToUse) {
                const activeProgram = parseRecord(await tx.program.findFirst({ where: { status: 'ACTIVE' }, orderBy: { updatedAt: 'desc' } }));
                programIdToUse = typeof activeProgram.id === 'string' ? activeProgram.id : undefined;
            }
            if (!programIdToUse) throw new Error('No active program found to bind this policy. Assign a Program in Underwriting first.');

            const pbLink = await tx.programBinderLink.findFirst({ where: { programId: programIdToUse, binderId: binderIdToUse, status: 'ACTIVE' }, select: { id: true } });
            if (!pbLink) throw new Error('Selected Program and Binder are not linked/allowed. Link them in Programs → Policy & Authority.');

            const binderForRules = binderIdToUse
                ? await tx.binder.findUnique({
                    where: { id: binderIdToUse },
                    select: {
                        id: true,
                        status: true,
                        umr: true,
                        startDate: true,
                        endDate: true,
                        config: true,
                    }
                })
                : null;
            if (!binderForRules) throw new Error('No active binder found to bind this policy.');
            if (String(binderForRules.status || '').toUpperCase() !== 'ACTIVE') {
                throw new Error('Binder is not ACTIVE and cannot be used for bind.');
            }
            if (!binderForRules.startDate || !binderForRules.endDate) {
                throw new Error('Binder effective period is incomplete.');
            }

            // Canonical UMR: the bound binder's Unique Market Reference. Fails
            // loud if the binder has no UMR — never fabricates one.
            const umr = resolvePolicyUmrFromBinder(binderForRules);
            if (debugBind) logger.info(`[Bind] Resolved binder UMR: ${umr}`);

            const finalizedSnapshot = {
                ...snapshotData,
                quoteData: quoteDataCandidate,
                premium: finalPremium,
                status: previewLifecycleStatus,
                pricingDebug: { basis: productType, annualPremium: finalPremium, source: quoteResponse?.primaryOption ? 'quoteResponse.primaryOption' : 'calculator/unknown' },
                quoteId: existingQuoteId || null,
                policyId: policyBusinessId,
                umr,
                certificateNumber,
            };

            const policyInception = candidate.inceptionDate;
            const policyExpiry = candidate.expiryDate;
            if (policyInception < binderForRules.startDate || policyInception > binderForRules.endDate) {
                throw new Error('Policy inception must be within binder effective period.');
            }

            const binderConfig = asRecord(binderForRules.config);
            const authority = asRecord(binderConfig.authority);
            const documentation = asRecord(binderConfig.documentation);
            const financials = asRecord(binderConfig.financials);

            const maxAdvanceInceptionDays = parseNumberish(authority.maxAdvanceInceptionDays) || 90;
            const maxTermMonths = parseNumberish(authority.maxPolicyPeriodMonths) || 15;
            const msPerDay = 24 * 60 * 60 * 1000;
            const daysAhead = Math.floor((policyInception.getTime() - now.getTime()) / msPerDay);
            if (daysAhead > maxAdvanceInceptionDays) {
                throw new Error(`Policy inception cannot be more than ${maxAdvanceInceptionDays} days in advance.`);
            }
            if (monthDiff(policyInception, policyExpiry) > maxTermMonths) {
                throw new Error(`Policy term exceeds binder maximum of ${maxTermMonths} months.`);
            }

            const adapter = ProductRegistry.getInstance().getAdapter(productType);
            if (!adapter) throw new Error(`No product adapter for: ${productType}`);

            const bindRules = adapter.validateBindRules(quoteData, binderConfig);
            if (!bindRules.valid) {
                throw new Error(bindRules.errors.map(e => e.message).join('; '));
            }

            const combinedCertificatesPermitted = Boolean(documentation.combinedCertificatesPermitted);
            const combinedCertificateRequested =
                typeof quoteData === 'object'
                && quoteData !== null
                && 'combinedCertificate' in quoteData
                    ? Boolean((quoteData as { combinedCertificate?: unknown }).combinedCertificate)
                    : false;
            if (!combinedCertificatesPermitted && combinedCertificateRequested) {
                throw new Error('Combined certificates are not permitted for this binder.');
            }

            const gpiLimit = parseNumberish(financials.grossPremiumIncomeLimit);
            const gpiWarnPct = parseNumberish(financials.warningThresholdPercentage) || 85;
            if (gpiLimit > 0 && binderIdToUse) {
                const aggregate = await tx.premiumTransaction.aggregate({
                    where: { riskTransaction: { binderId: binderIdToUse } },
                    _sum: { grossPremium: true },
                });
                const currentGross = Number(aggregate._sum.grossPremium || 0);
                const projected = currentGross + finalPremium;
                const pct = (projected / gpiLimit) * 100;
                if (pct >= 100) {
                    throw new Error(`Gross premium income limit exceeded (${Math.round(pct)}% of ${gpiLimit}).`);
                }
                if (pct >= gpiWarnPct) {
                    logger.warn({ binderId: binderIdToUse, projectedGpiPct: pct }, 'Binder gross premium income approaching limit.');
                }
            }

            const nextLifecycleStatus = 'ISSUING';
            await transitionPolicyLifecycle({
                tx,
                policyId: id,
                to: nextLifecycleStatus as Parameters<typeof transitionPolicyLifecycle>[0]['to'],
                actorId: actor.id || 'system',
                actorType: 'USER',
                reasonCode: 'PAYMENT_CONFIRMED_ISSUING',
                correlationId: correlationId || '',
            });

            const policy = await tx.policy.update({
                where: { id },
                data: {
                    policyNumber: policyBusinessId,
                    umr,
                    programId: programIdToUse,
                    binderId: binderIdToUse,
                    certificateNumber,
                    issuedAt: candidate.issuedAt || new Date(),
                }
            });

            await tx.policyStateCurrent.update({
                where: { policyId: id },
                data: { snapshot: jsonStringify(finalizedSnapshot) }
            });

            await tx.policySearchIndex.upsert({
                where: { policyId: id },
                update: { status: nextLifecycleStatus, policyNumber: policyBusinessId, address: candidate.policyHolder?.address || undefined, segment: 'Auto Insurance' },
                create: { policyId: id, policyNumber: policyBusinessId, insuredName: candidate.policyHolder?.name || 'Unknown', status: nextLifecycleStatus, address: candidate.policyHolder?.address || '', segment: 'Auto Insurance' } as unknown as Prisma.PolicySearchIndexUncheckedCreateInput,
            });
            await enqueuePolicyListIndexUpdate(tx, id);
            await enqueueAccounts360ProjectionUpdate(tx, candidate.policyHolder.id);
            await enqueueAccountIntelligenceProjectionUpdate(tx, candidate.policyHolder.id);

            const lastEndorsement = await tx.endorsement.findFirst({ where: { policyId: id }, orderBy: { endorsementNo: 'desc' } });
            const nextEndorsementNo = (lastEndorsement?.endorsementNo || 0) + 1;

            await tx.endorsement.create({
                data: {
                    policyId: id,
                    endorsementNo: nextEndorsementNo,
                    transactionType: 'INCEPTION',
                    status: 'ISSUED',
                    effectiveAt: policy.inceptionDate,
                    effectiveTo: policy.expiryDate,
                    issuedAt: new Date(),
                    snapshot: jsonStringify(finalizedSnapshot),
                    delta: { action: 'INCEPTION', status: nextLifecycleStatus, premium: finalPremium, umr: umr }
                } as unknown as Prisma.EndorsementUncheckedCreateInput,
            });

            const invoice = await tx.invoice.create({
                data: {
                    policyId: id,
                    amount: finalPremium,
                    currency: quoteCurrency(quoteResponse, String(candidate.binder?.defaultCurrency || 'EUR')),
                    status: 'OPEN',
                    dueDate: new Date(),
                    commissionRate: 0,
                    pdfUrl: undefined,
                } as unknown as Prisma.InvoiceUncheckedCreateInput,
            });

            let riskTxn: { id: string };
            for (let attempt = 0; ; attempt++) {
                const lastRiskTxn = await tx.riskTransaction.findFirst({ where: { policyId: id }, orderBy: { transactionNumber: 'desc' } });
                const nextTxnNumber = (lastRiskTxn?.transactionNumber || 0) + 1;
                try {
                    riskTxn = await tx.riskTransaction.create({
                        data: {
                            policyId: id,
                            programId: programIdToUse,
                            binderId: binderIdToUse,
                            transactionNumber: nextTxnNumber,
                            transactionType: 'INCEPTION',
                            status: 'PENDING_DOCS',
                            effectiveDate: policy.inceptionDate,
                            expiryDate: policy.expiryDate,
                            createdBy: actor.id || 'system',
                            snapshotFinal: jsonStringify(finalizedSnapshot),
                            pricingFinal: jsonStringify({ premium: finalPremium, currency: quoteCurrency(quoteResponse, String(candidate.binder?.defaultCurrency || 'EUR')), quoteResponse }),
                        } as unknown as Prisma.RiskTransactionUncheckedCreateInput,
                    });
                    break;
                } catch (error) {
                    const code = String((error as { code?: string })?.code || '');
                    if (code === 'P2002' && attempt < 4) continue;
                    throw error;
                }
            }

            const binderFinancials = binderIdToUse
                ? await tx.binderFinancials.findUnique({ where: { binderId: binderIdToUse } })
                : null;
            const primaryOption = parseRecord(quoteResponse.primaryOption);
            const costDetails = parseRecord(primaryOption.costDetails);
            const gross = Number(costDetails.subtotalNetPremium ?? finalPremium) || 0;
            const premiumFinancials = derivePremiumFinancials({
                grossPremium: gross,
                quoteResponse,
                binder: candidate.binder,
                binderFinancials,
                riskTransactionType: 'NB',
                premiumTransactionType: 'ORIGINAL',
            });
            await tx.premiumTransaction.create({
                data: {
                    riskTransactionId: riskTxn.id,
                    transactionType: 'ORIGINAL',
                    currency: quoteCurrency(quoteResponse, String(candidate.binder?.defaultCurrency || 'EUR')),
                    grossPremium: premiumFinancials.grossPremium,
                    commissionPercent: premiumFinancials.commissionPercent,
                    commissionAmount: premiumFinancials.commissionAmount,
                    taxesTotal: premiumFinancials.taxesTotal,
                    feesTotal: premiumFinancials.feesTotal,
                    netToLondon: premiumFinancials.netToLondon,
                }
            });

            // ADR-0013 — schedule the issued-pack generation INSIDE the
            // same transaction that created the INCEPTION row. The
            // outbox row is committed atomically; the relay drains it
            // to the documents queue. There is NO post-transaction
            // enqueue path.
            const docEvent = await enqueueIssuedPolicyPack(tx, {
                policyId: id,
                riskTransactionId: riskTxn.id,
                source: 'BO',
                generatedByUserId: actor.id || null,
                idempotencyKey: `issued-pack:${id}:${riskTxn.id}`,
                correlationId: correlationId || undefined,
            });

            return { policy, policyHolder: candidate.policyHolder, premium: finalPremium, units: totalUnits, invoiceId: invoice.id, riskTransactionId: riskTxn.id, documentJobId: docEvent.eventId };
        });

        // ADR-0013 — the legacy `DocumentGenerator.generateDocumentSet`
        // path was deleted as part of the canonical issuance spine
        // collapse. Doc-pack generation is owned end-to-end by the
        // `DOC.GENERATE_ISSUED_POLICY_PACK` worker via the outbox row
        // written above; running a parallel inline generator on bind
        // produced a second source of truth for the same artifact set
        // and was responsible for silent drift between BO views and
        // worker-generated docs.

        const actorName = actor.name || actor.email || 'Unknown User';
        void AuditLogger.log(id, 'POLICY', 'POLICY.ISSUING', actor.id || 'system', 'USER', {
            policyNumber: result.policy.policyNumber,
            effectiveDate: result.policy.inceptionDate,
            finalPremium: result.premium,
            umr: result.policy.umr,
            certificateNumber: result.policy.certificateNumber || undefined,
            documentJobId: result.documentJobId,
        }, actorName || undefined);

        return {
            status: 'SUCCESS',
            data: {
                ...result.policy,
                status: 'ISSUING',
                invoiceId: result.invoiceId,
                documentJobId: result.documentJobId,
                message: 'Policy is being issued. Documents are being generated and will be ready shortly.',
            }
        };
    } catch (error: unknown) {
        if ((process.env.NODE_ENV || '').toLowerCase() !== 'test') {
            logger.error({ err: error }, '[Bind] Transaction/System Failure:');
        }
        const message = error instanceof Error ? error.message : 'Bind failed';
        const stack = error instanceof Error ? error.stack : undefined;
        const isStartDateValidation = message.includes('Renewal date must be between today and') || message.includes('Renewal date is invalid');
        if (isStartDateValidation) {
            return { status: 'INVALID_STATUS', error: { code: 'INVALID_STATUS', message } };
        }
        return { status: 'SERVER_ERROR', error: { code: 'SERVER_ERROR', message: `Critical System Error: ${stack || message}` } };
    }
}

import type { Prisma } from '@prisma/client';
import { tenantScopedPrisma, runTenantScopedTransaction } from '../../../platform/db/connection.js';
import { quotePrimaryAnnualPremium, resolvePolicyIssuanceDates } from '../../../platform/utils/mappingHelpers.js';
import {
  enqueuePolicyListIndexUpdate,
  rebuildPolicyListIndexRow,
} from '../../policy/infra/projections/policyListIndex.js';
import { enqueueAccounts360ProjectionUpdate } from '../../accounts360/infra/projections/accounts360Projection.js';
import { enqueueAccountIntelligenceProjectionUpdate } from '../../accounts360/infra/projections/accountIntelligenceProjection.js';
import { transitionPolicyLifecycle } from '../../policy/app/commands/policyLifecycleCommands.js';
import { enqueueIssuedPolicyPack } from '../../policy/app/commands/issuedPackEnqueue.js';
import {
  isReservedQuoteId,
  reserveNextCertificateNumber,
  reserveNextPolicyId,
  assignPlatformIssuanceIdentifiers,
  shouldReassignPolicyNumberAtIssuance,
} from '../../../platform/utils/platformIds.js';
import { resolvePolicyUmrFromBinder } from '../../policy/app/binders/binderAuthority.js';
import { logger } from '../../../platform/utils/logger.js';
import { derivePremiumFinancials } from '../../policy/domain/premiumFinancials.js';
import { getSanctionsService, resolveIndividualScreeningSubject, SanctionsBlockError } from '../../compliance/app/index.js';
import { parseCoverageSelectionSnapshot } from '../../policy/domain/coverageSelectionContract.js';
import { resolveProgrammeExternalIssuanceWorkflow } from '../../policy/app/productRegistryService.js';
import { appendDomainEvent, buildDomainEvent } from '../../../platform/events/domainEvents.js';

type ParseRecord = (value: unknown) => Record<string, unknown>;
type JsonStringify = (value: unknown) => Prisma.InputJsonValue;

type PaidStatus = {
  paymentId?: string;
  amount?: string;
  currency?: string;
};

type PaymentLike = { id: string };
type PolicyLike = { id: string; policyNumber?: string | null };

type ResolveInceptionDate = (renewalDateRaw: unknown) => Date;

function normalizedProductType(value: unknown): string {
  return String(value || '').trim().toUpperCase();
}

function isManualProposalProduct(productType: string): boolean {
  return productType === 'BUSINESS' || productType === 'OPEN_MARKET';
}

function segmentForProduct(productType: string): string {
  if (productType === 'BUSINESS') return 'Business Insurance';
  if (productType === 'OPEN_MARKET') return 'Open Market';
  if (productType === 'HOME') return 'Home Insurance';
  if (productType === 'TRAVEL') return 'Travel Insurance';
  if (productType === 'HEALTH') return 'Immigration Medical Insurance';
  return 'Auto Insurance';
}

function selectedBundleForPolicy(args: {
  productType: string;
  quotePrimary: Record<string, unknown>;
  prevSnapshot: Record<string, unknown>;
}): string {
  if (isManualProposalProduct(args.productType)) {
    return `manual-${args.productType.toLowerCase().replace(/_/g, '-')}`;
  }
  const selected = parseCoverageSelectionSnapshot(args.prevSnapshot?.coverageSelection).selected;
  const cp = Boolean(selected['CV 172']);
  const vip = Boolean(selected['COV-ROADSIDE-VIP']);
  const ex = Number(args.quotePrimary?.voluntaryExcess ?? args.quotePrimary?.totalExcess ?? 250) || 250;
  return `EX${ex}_CP${cp ? '1' : '0'}_VIP${vip ? '1' : '0'}`;
}

export async function runCardcorpPaidIssuance(args: {
  policy: PolicyLike;
  updatedPayment: PaymentLike;
  status: PaidStatus;
  checkoutId: string;
  correlationId?: string;
  baseUrl: string;
  parseRecord: ParseRecord;
  jsonStringify: JsonStringify;
  resolveInceptionDateFromRenewalDate: ResolveInceptionDate;
}): Promise<{ selectedBundleId: string; awaitingExternalIssuance?: boolean }> {
  const screeningCandidate = await tenantScopedPrisma.policy.findUnique({
    where: { id: args.policy.id },
    select: {
      id: true,
      quoteData: true,
      policyHolder: { select: { name: true } },
    },
  });
  if (!screeningCandidate) throw new Error('Policy not found');
  const screeningSubject = resolveIndividualScreeningSubject({
    policyHolderName: screeningCandidate.policyHolder?.name || null,
    quoteData: args.parseRecord(screeningCandidate.quoteData),
  });
  if (!screeningSubject) {
    throw new Error('SANCTION_SCREENING_SUBJECT_MISSING');
  }
  try {
    await getSanctionsService().assertClearOrThrow({
      actionType: 'PAYMENT_ISSUE',
      policyId: args.policy.id,
      subjectName: screeningSubject.subjectName,
      dateOfBirth: screeningSubject.dateOfBirth,
      correlationId: args.correlationId || `payment-issue:${args.policy.id}`,
    });
  } catch (error) {
    if (error instanceof SanctionsBlockError) {
      throw new Error(`SANCTION_SCREENING_BLOCKED:${error.outcome}:${error.reasonCode}`);
    }
    throw new Error('SANCTION_SCREENING_UNAVAILABLE');
  }

  const issuance = await runTenantScopedTransaction(async (_tx) => {
    const tx = _tx as unknown as Prisma.TransactionClient;
    // ── Idempotency: prevent duplicate billing/binding on relay retries ─────
    const existingInception = await tx.riskTransaction.findFirst({
      where: { policyId: args.policy.id, transactionType: 'INCEPTION' },
    });
    if (existingInception) {
      logger.warn({ policyId: args.policy.id }, 'Idempotency: Policy already issued, skipping duplicate binding');
      let selectedBundleId = '';
      try {
        const snap = typeof existingInception.snapshotFinal === 'string'
          ? JSON.parse(existingInception.snapshotFinal)
          : existingInception.snapshotFinal;
        if (snap && typeof snap === 'object' && 'recommendations' in snap) {
          const recs = (snap as Record<string, unknown>).recommendations;
          if (recs && typeof recs === 'object' && 'selectedBundleId' in recs) {
            selectedBundleId = String((recs as Record<string, unknown>).selectedBundleId || '');
          }
        }
      } catch {}
      // Re-enqueue the issued-pack for the existing INCEPTION using a
      // deterministic idempotencyKey so the outbox / relay dedupes
      // perfectly. This is NOT a fallback path — it is the same spine
      // (`enqueueIssuedPolicyPack`) every issuance call uses, just
      // pointed at the already-bound risk transaction. If the doc job
      // succeeded last time, the relay's `event_processing_log` skips
      // re-dispatch; if it never ran, the relay will deliver it now.
      await enqueueIssuedPolicyPack(tx, {
        policyId: args.policy.id,
        riskTransactionId: existingInception.id,
        source: 'SYSTEM',
        idempotencyKey: `issued-pack:${args.policy.id}:${existingInception.id}`,
        correlationId: args.correlationId || undefined,
      });
      await tx.payment.update({
        where: { id: args.updatedPayment.id },
        data: { riskTransactionId: existingInception.id },
      });
      return { riskTransactionId: existingInception.id, selectedBundleId };
    }
    // ────────────────────────────────────────────────────────────────────────

    const candidate = await tx.policy.findUnique({
      where: { id: args.policy.id },
      include: { policyHolder: true, binder: true },
    });
    if (!candidate) throw new Error('Policy not found');

    const quoteData = args.parseRecord(candidate.quoteData);
    const quoteResponse = args.parseRecord(candidate.quoteResponse);
    const productType = normalizedProductType(candidate.productType);
    if (!productType) {
      throw new Error('Cardcorp finalization: policy is missing canonical productType — cannot assign a branded policy number.');
    }
    const externalIssuanceWorkflow = await resolveProgrammeExternalIssuanceWorkflow({
      programId: String(candidate.programId || ''),
      binderId: String(candidate.binderId || ''),
      productType,
    });
    if (String(candidate.status || '').trim().toUpperCase() === 'AWAITING_EXTERNAL_ISSUANCE') {
      return { riskTransactionId: null, selectedBundleId: `manual-${productType.toLowerCase().replace(/_/g, '-')}`, awaitingExternalIssuance: true };
    }
    const isManualProposal = isManualProposalProduct(productType);
    const productSegment = segmentForProduct(productType);

    // Product-aware: honours the customer's requested cover start date
    // (trip.startDate / policy.startDate / period.inceptionDate) and falls
    // back to the injected renewal-date resolution for motor/legacy shapes.
    const { inceptionDate, expiryDate } = resolvePolicyIssuanceDates(
      productType,
      quoteData,
      args.resolveInceptionDateFromRenewalDate,
    );

    const now = new Date();
    const nextPolicyStatus = inceptionDate && now < inceptionDate ? 'ISSUED' : 'ACTIVE';

    const quotePrimary = args.parseRecord(quoteResponse?.primaryOption);
    const finalPremium = quotePrimaryAnnualPremium(quoteResponse);
    if (!Number.isFinite(finalPremium) || finalPremium <= 0) {
      throw new Error('Cardcorp finalization: missing canonical premium on quoteResponse (PRICING_DRIFT — should have been caught by evaluateIssueReadiness).');
    }

    const existingQuoteId = isReservedQuoteId(candidate.policyNumber)
      ? String(candidate.policyNumber)
      : undefined;
    const assigned = process.env.KERNEL_PLATFORM_MODE === 'true' ? await assignPlatformIssuanceIdentifiers(tx, args.policy.id, 'ONLINE') : null;
    const policyBusinessId = assigned?.policyNumber ?? (shouldReassignPolicyNumberAtIssuance(productType, candidate.policyNumber)
      ? await reserveNextPolicyId(tx, productType, 'ONLINE')
      : String(candidate.policyNumber));

    const certificateNumber = assigned ? assigned.certificateNumber : candidate.certificateNumber ?? (await reserveNextCertificateNumber(tx));

    const binderIdToUse = String(candidate.binderId || '').trim();
    if (!binderIdToUse) {
      throw new Error('Cardcorp finalization: policy has no explicitly selected binder.');
    }

    // Canonical UMR: the bound binder's Unique Market Reference. Fails loud
    // if the binder has no UMR — never derived from the policy number or
    // fabricated (no-defensive-fallbacks skill, ADR-0019).
    const boundBinder = candidate.binder;
    const umr = resolvePolicyUmrFromBinder(boundBinder);

    const existingState = await tx.policyStateCurrent.findUnique({ where: { policyId: args.policy.id } });
    const prevSnapshot =
      existingState?.snapshot && typeof existingState.snapshot === 'object'
        ? args.parseRecord(existingState.snapshot)
        : {};
    const selectedBundleId = selectedBundleForPolicy({ productType, quotePrimary, prevSnapshot });
    const acceptedAt = new Date().toISOString();
    const acceptedManualProposal = isManualProposal
      ? {
          acceptedAt,
          source: 'customer_payment',
          proposal: args.parseRecord(quoteData.proposal),
          manualPremium: finalPremium,
          quoteResponse,
        }
      : undefined;

    if (externalIssuanceWorkflow) {
      const awaitingStatus = 'AWAITING_EXTERNAL_ISSUANCE';
      const awaitingSnapshot = {
        ...prevSnapshot,
        quoteData,
        quoteResponse,
        ...(acceptedManualProposal ? { acceptedManualProposal } : {}),
        recommendations: {
          ...args.parseRecord(prevSnapshot?.recommendations),
          selectedBundleId,
        },
        paymentInfo: {
          provider: 'CARDCORP',
          status: 'paid',
          checkoutId: args.checkoutId,
          paymentId: args.status.paymentId,
          amount: args.status.amount,
          currency: args.status.currency,
          verifiedAt: acceptedAt,
        },
        premium: finalPremium,
        status: awaitingStatus,
        externalIssuance: {
          status: 'awaiting_manager_upload',
          acceptedAt,
          documentTypes: externalIssuanceWorkflow.documentTypes,
        },
      };
      await transitionPolicyLifecycle({
        tx,
        policyId: args.policy.id,
        to: awaitingStatus,
        actorId: 'customer',
        actorType: 'CUSTOMER',
        reasonCode: 'PAYMENT_CONFIRMED_EXTERNAL_ISSUANCE_REQUIRED',
        correlationId: args.correlationId,
      });
      const snapshotJson = args.jsonStringify(awaitingSnapshot);
      await tx.policyStateCurrent.upsert({
        where: { policyId: args.policy.id },
        update: { snapshot: snapshotJson },
        create: {
          policyId: args.policy.id,
          operatingTenantId: candidate.operatingTenantId,
          snapshot: snapshotJson,
        },
      });
      await tx.policySearchIndex.upsert({
        where: { policyId: args.policy.id },
        update: {
          status: awaitingStatus,
          policyNumber: String(candidate.policyNumber),
          insuredName: candidate.policyHolder?.name || 'Unknown',
          segment: productSegment,
        },
        create: {
          policyId: args.policy.id,
          status: awaitingStatus,
          policyNumber: String(candidate.policyNumber),
          insuredName: candidate.policyHolder?.name || 'Unknown',
          segment: productSegment,
          address: candidate.policyHolder?.address || '',
          operatingTenantId: candidate.operatingTenantId,
        },
      });
      const currencyStr = String(quoteResponse?.currency ?? candidate.binder?.defaultCurrency ?? 'EUR');
      await tx.invoice.create({
        data: {
          policyId: args.policy.id,
          amount: finalPremium,
          currency: currencyStr,
          status: 'PAID',
          dueDate: new Date(),
          paidDate: new Date(),
          commissionRate: 0,
          operatingTenantId: candidate.operatingTenantId,
        },
      });
      await appendDomainEvent(tx, buildDomainEvent({
        eventType: 'EMAIL.UW_REFERRAL',
        aggregateType: 'POLICY',
        aggregateId: args.policy.id,
        aggregateVersion: Date.now(),
        actorType: 'CUSTOMER',
        actorId: 'customer',
        correlationId: args.correlationId,
        idempotencyKey: `external-issuance-required:${args.policy.id}`,
        data: {
          policyId: args.policy.id,
          policyNumber: candidate.policyNumber || undefined,
          reasons: ['Customer payment received. Complete external issuance and upload the insurer-issued documents.'],
        },
      }));
      await enqueuePolicyListIndexUpdate(tx, args.policy.id);
      await enqueueAccounts360ProjectionUpdate(tx, candidate.policyHolderId);
      await enqueueAccountIntelligenceProjectionUpdate(tx, candidate.policyHolderId);
      return { riskTransactionId: null, selectedBundleId, awaitingExternalIssuance: true };
    }

    const finalizedSnapshot = {
      ...prevSnapshot,
      quoteData,
      quoteResponse,
      ...(acceptedManualProposal ? { acceptedManualProposal } : {}),
      recommendations: {
        ...args.parseRecord(prevSnapshot?.recommendations),
        selectedBundleId,
      },
      paymentInfo: {
        provider: 'CARDCORP',
        status: 'paid',
        checkoutId: args.checkoutId,
        paymentId: args.status.paymentId,
        amount: args.status.amount,
        currency: args.status.currency,
        verifiedAt: new Date().toISOString(),
      },
      premium: finalPremium,
      status: nextPolicyStatus,
      quoteId: existingQuoteId || null,
      policyId: policyBusinessId,
      umr,
      certificateNumber,
    };

    await transitionPolicyLifecycle({
      tx,
      policyId: args.policy.id,
      to: nextPolicyStatus as Parameters<typeof transitionPolicyLifecycle>[0]['to'],
      actorId: 'customer',
      actorType: 'CUSTOMER',
      reasonCode: 'PAYMENT_CONFIRMED',
      correlationId: args.correlationId,
    });
    await tx.policy.update({
      where: { id: args.policy.id },
      data: {
        inceptionDate,
        expiryDate,
        policyNumber: policyBusinessId,
        binderId: binderIdToUse,
        umr,
        certificateNumber,
        issuedAt: candidate.issuedAt ?? new Date(),
      },
    });

    const snapshotJson = args.jsonStringify(finalizedSnapshot);
    await tx.policyStateCurrent.upsert({
      where: { policyId: args.policy.id },
      update: { snapshot: snapshotJson as never },
      create: { policyId: args.policy.id, snapshot: snapshotJson as never } as unknown as Prisma.PolicyStateCurrentUncheckedCreateInput,
    });

    await tx.policySearchIndex
      .upsert({
        where: { policyId: args.policy.id },
        update: {
          status: nextPolicyStatus,
          policyNumber: policyBusinessId,
          insuredName: candidate.policyHolder?.name || 'Unknown',
          segment: productSegment,
        },
        create: {
          policyId: args.policy.id,
          status: nextPolicyStatus,
          policyNumber: policyBusinessId,
          insuredName: candidate.policyHolder?.name || 'Unknown',
          segment: productSegment,
          address: candidate.policyHolder?.address || '',
        } as unknown as Prisma.PolicySearchIndexUncheckedCreateInput,
      })
      .catch(() => undefined);

    const currencyStr = String(quoteResponse?.currency ?? candidate.binder?.defaultCurrency ?? 'EUR');
    let riskTxn: { id: string };
    for (let attempt = 0; ; attempt++) {
      const lastRiskTxn = await tx.riskTransaction.findFirst({
        where: { policyId: args.policy.id },
        orderBy: { transactionNumber: 'desc' },
        select: { transactionNumber: true },
      });
      const nextTxnNumber = (lastRiskTxn?.transactionNumber || 0) + 1;
      try {
        riskTxn = await tx.riskTransaction.create({
          data: {
            policyId: args.policy.id,
            binderId: binderIdToUse,
            transactionNumber: nextTxnNumber,
            transactionType: 'INCEPTION',
            status: 'BOUND',
            effectiveDate: inceptionDate,
            expiryDate,
            createdBy: 'customer',
            snapshotFinal: args.jsonStringify(finalizedSnapshot) as never,
            pricingFinal: args.jsonStringify({
              premium: finalPremium,
              currency: currencyStr,
              quoteResponse,
            }) as never,
          } as unknown as Prisma.RiskTransactionUncheckedCreateInput,
        });
        break;
      } catch (error) {
        const code = String((error as { code?: string })?.code || '');
        if (code === 'P2002' && attempt < 4) continue;
        throw error;
      }
    }

    await tx.invoice.create({
      data: {
        policyId: args.policy.id,
        amount: finalPremium,
        currency: currencyStr,
        status: 'PAID',
        dueDate: new Date(),
        paidDate: new Date(),
        commissionRate: 0,
      } as unknown as Prisma.InvoiceUncheckedCreateInput,
    });
    await enqueuePolicyListIndexUpdate(tx, args.policy.id);
    await enqueueAccounts360ProjectionUpdate(tx, candidate.policyHolderId);
    await enqueueAccountIntelligenceProjectionUpdate(tx, candidate.policyHolderId);

    const binderFinancials = binderIdToUse
      ? await tx.binderFinancials.findUnique({ where: { binderId: binderIdToUse } })
      : null;
    const quoteCost = args.parseRecord(args.parseRecord(quoteResponse?.primaryOption).costDetails);
    const grossPremium = Number(quoteCost.subtotalNetPremium ?? finalPremium) || 0;
    const premiumFinancials = derivePremiumFinancials({
      grossPremium,
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
        currency: currencyStr,
        grossPremium: premiumFinancials.grossPremium,
        commissionPercent: premiumFinancials.commissionPercent,
        commissionAmount: premiumFinancials.commissionAmount,
        taxesTotal: premiumFinancials.taxesTotal,
        feesTotal: premiumFinancials.feesTotal,
        netToLondon: premiumFinancials.netToLondon,
      },
    });
    await tx.payment.update({
      where: { id: args.updatedPayment.id },
      data: { riskTransactionId: riskTxn.id },
    });

    // ── Canonical issuance spine (ADR-0013) ─────────────────────────────────
    // Schedule the issued-pack document generation INSIDE the same
    // transaction that created the INCEPTION row. The outbox row is
    // committed atomically with the issuance; the relay drains it to
    // the documents queue; the worker handler generates docs and
    // sends the welcome email. There is NO post-transaction enqueue,
    // NO local-mode inline generation, NO setTimeout-based welcome
    // retry, and NO repair sweep — the transactional invariant
    // guarantees the doc job exists iff the policy is issued.
    await enqueueIssuedPolicyPack(tx, {
      policyId: args.policy.id,
      riskTransactionId: riskTxn.id,
      source: 'SYSTEM',
      idempotencyKey: `issued-pack:${args.policy.id}:${riskTxn.id}`,
      correlationId: args.correlationId || undefined,
    });

    return { riskTransactionId: riskTxn.id, selectedBundleId };
  });

  await rebuildPolicyListIndexRow(args.policy.id).catch((e) => {
    logger.warn({ err: e, policyId: args.policy.id }, 'policy_index.write_through_failed');
  });

  return {
    selectedBundleId: issuance.selectedBundleId,
    ...(issuance.awaitingExternalIssuance ? { awaitingExternalIssuance: true } : {}),
  };
}

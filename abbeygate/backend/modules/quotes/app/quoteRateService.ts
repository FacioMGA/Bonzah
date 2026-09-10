import type { Prisma } from '@prisma/client';

import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import { parseRecord } from '../../../platform/json/parseRecord.js';
import { findLatestActiveBinderLinkForProduct } from '../../policy/app/binders/binderAuthority.js';
import {
  buildQuoteResponseForProduct,
  productAdapterExists,
  resolvePolicyPeriodForProduct,
  validateProductQuoteForRating,
} from '../../policy/app/productRegistryService.js';
import { resolveEffectiveCoverageContract } from '../../policy/app/coverageSelectionContract.js';
import { normalizeProgramMbeProductConfig } from '../../policy/app/mbeInterop.js';
import { computePricingIntegrityStamp } from '../../policy/app/pricing/pricingIntegrityStamp.js';
import { appendDomainEvent, buildDomainEvent } from '../../../platform/events/domainEvents.js';
import type { WithoutTenantScope } from '../../../platform/db/tenantExtension.js';
import { extractUwReferralReasons } from './enqueueUwReferralEmail.js';
import { sendTravelQuoteEmailAfterRate } from './sendTravelQuoteEmailAfterRate.js';

/**
 * ABY-261 — canonical "rate this policy and persist the result" spine.
 *
 * Before this file the rate pipeline lived inline inside the public quote
 * router (`POST /:token/rate`). The CardCorp checkout service had no way
 * to invoke it, so it tried to reconstruct the customer's premium by hand
 * (`primaryOption.annualPremium + Σ legacy addonGrossPrices[selected]`). That
 * computation diverged from the wizard's `paymentSummary` and the BO's
 * policy header any time `quoteData.addons` had been touched without a
 * `/rate` round-trip — which is exactly what happened on Step 5 of the
 * travel wizard, where addons get selected but the wizard only used to
 * re-rate on 3→4 and 4→5. The customer saw €136.51 in the wizard, then
 * got charged €206.51 by CardCorp.
 *
 * Fix: extract the rate pipeline into one app-layer function that the
 * router AND the checkout boundary both call. Premium is whatever
 * `primaryOption.annualPremium` is on the freshly built `quoteResponse`,
 * and `quoteResponse` is persisted before any caller reads it. There is
 * no second formula. There is no addon-price reconstruction. There is
 * one number, and it lives on a single freshly-rated `quoteResponse`.
 *
 * Layer note: this file lives in `quotes/app/`, not `quotes/http/`, so the
 * `check-backend-layer-imports.mjs` guard is happy when `payments/app/`
 * imports it. Mirrors the shape of `quoteResumeLinkService.ts`.
 */

export type RatePolicyOk = {
  ok: true;
  quoteResponse: Record<string, unknown>;
  underwritingAnalysis: Record<string, unknown> | null;
  /** Final policy status after rating: 'QUOTED' | 'REFERRAL' | 'DECLINED'. */
  status: 'QUOTED' | 'REFERRAL' | 'DECLINED';
  /** The `quoteData` actually rated (read from state+policy, untouched). */
  quoteData: Record<string, unknown>;
};

export type RatePolicyErr = {
  ok: false;
  status: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

export type RatePolicyResult = RatePolicyOk | RatePolicyErr;

function productTypeSlug(productType: string): string {
  return String(productType || '').trim().toLowerCase();
}

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

/**
 * Normalize the adapter's UW decision reasons to plain strings for the
 * EMAIL.UW_REFERRAL payload (handler schema: `reasons: string[]`). Motor
 * emits `string[]`; Home/Travel/Health adapters emit `{ code, message }[]`
 * (e.g. travel `AGE_REFERRAL`). Both shapes are canonical per product —
 * this maps, it does not invent.
 */
export function referralReasonsFromQuoteResponse(quoteResponse: unknown): string[] {
  const uwDecision = parseRecord(parseRecord(quoteResponse).uwDecision);
  const raw = Array.isArray(uwDecision.reasons) ? uwDecision.reasons : [];
  return raw
    .map((reason) => {
      if (typeof reason === 'string') return reason.trim();
      const rec = parseRecord(reason);
      const code = String(rec.code || '').trim();
      const message = String(rec.message || '').trim();
      return [code, message].filter(Boolean).join(': ');
    })
    .filter(Boolean);
}

export interface RatePolicyInput {
  policyId: string;
  productType: string;
  correlationId?: string;
  /** Public quote flow only: request regulated correspondence after a quote is persisted. */
  quoteEmailIntent?: 'SEND_AFTER_QUOTED';
}

/**
 * Rate the policy's current `quoteData`, persist the fresh `quoteResponse`
 * to both `policy.quoteResponse` and `policyStateCurrent.snapshot`, and
 * return the result. ALWAYS executes the full rate pipeline — there is no
 * "cached" short-circuit, because the whole point of this function is to
 * be the boundary that guarantees no stale premium leaks downstream.
 */
export async function ratePolicyAndPersist(input: RatePolicyInput): Promise<RatePolicyResult> {
  const productType = String(input.productType || '').trim().toUpperCase();
  if (!productAdapterExists(productType)) {
    return { ok: false, status: 500, code: 'NO_ADAPTER', message: `No product adapter for ${productType || '(empty)'}` };
  }

  const policy = await tenantScopedPrisma.policy.findUnique({
    where: { id: input.policyId },
    include: { policyHolder: true },
  });
  if (!policy) {
    return { ok: false, status: 404, code: 'POLICY_NOT_FOUND', message: 'Policy not found' };
  }

  const state = await tenantScopedPrisma.policyStateCurrent.findUnique({ where: { policyId: policy.id } });
  const snapshot = parseRecord(state?.snapshot);
  const quoteData = parseRecord(snapshot.quoteData || policy.quoteData);

  const validation = validateProductQuoteForRating({ productType, quoteData });
  if (!validation.ok) {
    return {
      ok: false,
      status: 400,
      code: validation.error.code || 'INVALID_QUOTE',
      message: validation.error.message || 'Quote data is not valid for rating',
      details: validation.error.details as Record<string, unknown> | undefined,
    };
  }

  // Sanctions screening does NOT run at quote time (ADR-0067). Screening the
  // customer here — often on a "Quote in progress" placeholder, before real
  // contact details are saved — both burned Creditsafe credits on non-people
  // and turned a provider outage into a total sales stoppage (Aug 2026: the
  // fail-closed quote gate returned 503 for days and blocked all quoting).
  // The mandatory AML/sanctions control now lives exclusively at the point a
  // real identity exists and cover/money is about to change hands — bind,
  // payment and issue — which remain fail-closed. See ADR-0043 (spine) and
  // ADR-0067 (this relocation), agreed with the business Aug 2026.

  const policyPeriod = resolvePolicyPeriodForProduct(productType, quoteData);
  const effectiveBinderLink = policyPeriod
    ? await findLatestActiveBinderLinkForProduct({ productCode: productType, inceptionDate: policyPeriod.inceptionDate })
    : null;

  // A re-resolved authority link owns the entire program/binder pair. Use its
  // program for the rating inputs as well as the persistence transaction; a
  // policy must never be priced under stale-program configuration and then
  // attributed to the current authority (ABY-508).
  const ratingProgramId = effectiveBinderLink ? effectiveBinderLink.programId : policy.programId;
  const program = ratingProgramId
    ? await tenantScopedPrisma.program.findUnique({ where: { id: ratingProgramId } })
    : null;
  const programMeta = parseRecord(program?.metadata);
  const mbeConfig = normalizeProgramMbeProductConfig(programMeta.mbeProductConfig, {
    productType,
    programCode: String(programMeta.programCode || `abbeygate_${productTypeSlug(productType)}`),
  });
  const coverageContract = resolveEffectiveCoverageContract({
    productType,
    quoteData,
    cfg: mbeConfig,
    storedSelection: snapshot.coverageSelection,
    programId: ratingProgramId || null,
  });

  const { quoteResponse, underwritingAnalysis } = await buildQuoteResponseForProduct({
    productType,
    quoteData,
    programMeta,
    resolvedCoverageSet: coverageContract.resolvedCoverageSet,
  });

  const nextStatus = String((quoteResponse as Record<string, unknown>).status || 'QUOTED').toUpperCase();
  const finalStatus: 'QUOTED' | 'REFERRAL' | 'DECLINED' =
    nextStatus === 'DECLINED' ? 'DECLINED' : nextStatus === 'REFERRAL' ? 'REFERRAL' : 'QUOTED';
  const previousStatus = String(policy.status || '').trim().toUpperCase();

  const pricingStamp = computePricingIntegrityStamp({
    quoteData,
    quoteResponse: quoteResponse as Record<string, unknown>,
  });
  const existingPricing = parseRecord(snapshot.pricing);
  const nextPricing = { ...existingPricing, ...pricingStamp };

  await tenantScopedPrisma.$transaction(async (_tx) => {
    const tx = _tx as Prisma.TransactionClient;
    await tx.policy.update({
      where: { id: policy.id },
      data: {
        quoteData: quoteData as never,
        quoteResponse: quoteResponse as never,
        ...(policyPeriod ? { inceptionDate: policyPeriod.inceptionDate, expiryDate: policyPeriod.expiryDate } : {}),
        // A binder is only valid in the context of its linked Program. Keep
        // the pair atomic when an effective authority window is re-resolved;
        // persisting a new binder while retaining an old program can create
        // a cross-product policy assignment (ABY-508).
        ...(effectiveBinderLink ? {
          binderId: effectiveBinderLink.binderId,
          programId: effectiveBinderLink.programId,
        } : {}),
        status: finalStatus,
      },
    });
    const rateSnapshot = toInputJson({ quoteData, quoteResponse, underwritingAnalysis, pricing: nextPricing });
    const updatedRateSnapshot = toInputJson({ ...snapshot, quoteData, quoteResponse, underwritingAnalysis, pricing: nextPricing });
    const rateStateCreate: WithoutTenantScope<Prisma.PolicyStateCurrentUncheckedCreateInput> = {
      policyId: policy.id,
      snapshot: rateSnapshot,
    };
    await tx.policyStateCurrent.upsert({
      where: { policyId: policy.id },
      update: { snapshot: updatedRateSnapshot },
      create: rateStateCreate as Prisma.PolicyStateCurrentUncheckedCreateInput,
    });

    if (finalStatus === 'REFERRAL') {
      // Notify the jurisdiction's underwriting team (transactional outbox →
      // EMAIL.UW_REFERRAL worker → UW_REFERRAL_EMAILS_BY_COUNTRY). Emitted
      // as a canonical DomainEventEnvelope so BEHAVIOR.NORMALIZE can match
      // the manifest entry for EMAIL.UW_REFERRAL (a flat payload is skipped
      // as INVALID_ENVELOPE and never reaches behavior intelligence). The
      // worker parses both this envelope and the motor producer's legacy
      // flat shape. Dispatch stays idempotent per (policy, reasons) via the
      // handler's idempotencySeed, so unchanged re-rates do not re-notify.
      const referralPayload: {
        policyId: string;
        reasons: string[];
        policyNumber?: string;
        quoteReference?: string;
      } = {
        policyId: policy.id,
        // Union of both reason sources: uwDecision reasons on the quote
        // response AND underwritingAnalysis triggers (nationality/domicile
        // referrals surface there), deduped.
        reasons: Array.from(new Set([
          ...referralReasonsFromQuoteResponse(quoteResponse),
          ...extractUwReferralReasons(underwritingAnalysis),
        ])),
      };
      if (policy.policyNumber) referralPayload.policyNumber = policy.policyNumber;
      const reference = String(parseRecord(quoteResponse).reference || '').trim();
      if (reference) referralPayload.quoteReference = reference;
      await appendDomainEvent(tx, buildDomainEvent({
        aggregateType: 'POLICY',
        aggregateId: policy.id,
        aggregateVersion: Date.now(),
        eventType: 'EMAIL.UW_REFERRAL',
        actorType: 'SYSTEM',
        actorId: 'quote-rate-service',
        data: referralPayload as Prisma.InputJsonValue,
      }));
    }

    // Only the public rate endpoint asks for automatic Home quote
    // correspondence. BO operators and checkout re-rates use the same rating
    // spine but must not send customer email as a side effect of recalculation.
    // The worker performs document generation and delivery; neither may block
    // this transaction or the public HTTP response.
    if (finalStatus === 'QUOTED' && productType === 'HOME' && input.quoteEmailIntent === 'SEND_AFTER_QUOTED') {
      await appendDomainEvent(tx, buildDomainEvent({
        aggregateType: 'POLICY',
        aggregateId: policy.id,
        aggregateVersion: Date.now(),
        eventType: 'EMAIL.PUBLIC_QUOTE',
        actorType: 'CUSTOMER',
        actorId: 'public-quote-rate',
        correlationId: input.correlationId,
        data: {
          policyId: policy.id,
          productCode: productType,
          source: 'rate',
        },
      }));
    }
  });

  await sendTravelQuoteEmailAfterRate({
    policyId: policy.id,
    productType,
    previousStatus,
    finalStatus,
    correlationId: input.correlationId,
  });

  return {
    ok: true,
    quoteResponse: quoteResponse as Record<string, unknown>,
    underwritingAnalysis: (underwritingAnalysis as Record<string, unknown> | null) ?? null,
    status: finalStatus,
    quoteData,
  };
}

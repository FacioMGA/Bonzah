import { Prisma } from '@prisma/client';

import { prisma, tenantScopedPrisma, runTenantScopedTransaction } from '../../../platform/db/connection.js';
import { getTenantConfig } from '../../../platform/tenant/tenantConfig.js';
import { resolvePublicAppBaseUrlFromContext } from '../../../platform/http/publicAppLinks.js';
import {
  cardcorpCreateCheckout,
  formatAmountEUR,
  safeMerchantTxId,
  type CardcorpCreateCheckoutResult,
} from '../infra/cardcorpGateway.js';
import { enqueuePolicyListIndexUpdate } from '../../policy/infra/projections/policyListIndex.js';
import { transitionPolicyLifecycle } from '../../policy/app/commands/policyLifecycleCommands.js';
import { ProductRegistry } from '../../policy/domain/ProductRegistry.js';
import { ratePolicyAndPersist } from '../../quotes/app/quoteRateService.js';
import { getSanctionsService, resolveIndividualScreeningSubject, SanctionsBlockError } from '../../compliance/app/index.js';
import { logger } from '../../../platform/utils/logger.js';

type CardcorpConfig = {
  entityId: string;
  bearerToken: string;
  baseUrl: string;
  // Omitted (undefined) in live mode — OPPWA rejects a testMode param on the
  // live host (ADR-0049).
  testMode?: 'EXTERNAL' | 'INTERNAL';
};

type PolicyLike = {
  id: string;
  policyNumber?: string | null;
  paymentStatus?: string | null;
  status?: string | null;
  quoteData?: unknown;
  quoteResponse?: unknown;
  publicSessionToken?: string | null;
  productType?: string | null;
};

type RequestMeta = {
  protocol: string;
  host: string;
  origin?: string;
  ip: string;
  xForwardedFor?: string;
  correlationId?: string;
};

type SuccessResult = {
  ok: true;
  data: {
    paymentId: string;
    checkoutId: string;
    integrity: string | null;
    widgetScriptUrl: string;
    shopperResultUrl: string;
    amount: string;
    currency: string;
    brands: 'VISA MASTER';
    idempotent?: boolean;
  };
};

type ErrorResult = {
  ok: false;
  status: number;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
};

class CheckoutNoLongerEligibleError extends Error {
  constructor() {
    super('Quote is no longer eligible for payment');
  }
}

const toInputJson = (value: unknown): Prisma.InputJsonValue => {
  if (value === null || value === undefined) throw new Error('Invalid JSON payload: top-level value cannot be null/undefined');
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.map((entry) => {
      if (entry === null) return null;
      if (entry === undefined || typeof entry === 'function' || typeof entry === 'symbol' || typeof entry === 'bigint') {
        throw new Error('Invalid JSON payload: non-serializable array value');
      }
      return toInputJson(entry);
    });
  }
  if (typeof value === 'object') {
    const out: Record<string, Prisma.InputJsonValue | null> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry === undefined || typeof entry === 'function' || typeof entry === 'symbol' || typeof entry === 'bigint') {
        throw new Error(`Invalid JSON payload at key '${key}': non-serializable value`);
      }
      out[key] = entry === null ? null : toInputJson(entry);
    }
    return out;
  }
  throw new Error('Invalid JSON payload: non-serializable value');
};

function resolvePublicProductSlug(productType: unknown): string {
  const normalized = String(productType || '').trim().toUpperCase();
  const adapter = normalized ? ProductRegistry.getInstance().getAdapter(normalized) : null;
  const slug = String(adapter?.getRuntimeDefinition()?.intake.publicSessionSlug || '').trim().toLowerCase();
  return slug || normalized.toLowerCase() || 'motor';
}

export async function createCardcorpAutoCheckout(args: {
  policy: PolicyLike;
  publicPolicyRequestId: string;
  cfg: CardcorpConfig;
  idempotencyKey?: string;
  request: RequestMeta;
  parseRecord: (value: unknown) => Record<string, unknown>;
  newPublicSessionToken: () => string;
}): Promise<SuccessResult | ErrorResult> {
  const { policy, publicPolicyRequestId, cfg, idempotencyKey } = args;
  const psUp = String(policy.paymentStatus ?? '').toUpperCase();
  const stUp = String(policy.status ?? '').toUpperCase();
  if (psUp === 'PAID' || stUp === 'ISSUED' || stUp === 'ACTIVE') {
    return {
      ok: false,
      status: 409,
      error: {
        code: 'ALREADY_PAID',
        message: 'Payment already completed for this policy.',
        details: { paymentStatus: psUp, status: stUp },
      },
    };
  }

  // ABY-261 — premium integrity boundary.
  //
  // Until now the checkout total was reconstructed here as
  // `primaryOption.annualPremium + Σ legacy addonGrossPrices[selected]`. That
  // sum diverged from the wizard's `paymentSummary` (which reads
  // `primary.annualPremium` on the stored `quoteResponse`) any time
  // `quoteData.addons` changed without a `/rate` round-trip — the exact
  // path that produced Effie's £70 surprise on ABOLV1000101. There were
  // effectively three premiums in the system and CardCorp was the only
  // one that included the addons.
  //
  // Fix: there is exactly ONE premium. We re-rate the policy through the
  // canonical app-layer spine here, persist the fresh `quoteResponse`,
  // and read `primaryOption.annualPremium` off it. Wizard, BO, documents
  // and CardCorp now read the same number from the same row. If the
  // rate comes back REFERRAL/DECLINED we refuse the checkout — the
  // customer must not pay for a quote a human still needs to sign off.
  const rate = await ratePolicyAndPersist({ policyId: policy.id, productType: String(policy.productType || '') });
  if (!rate.ok) {
    return { ok: false, status: rate.status, error: { code: rate.code, message: rate.message, details: rate.details } };
  }
  if (rate.status !== 'QUOTED') {
    return {
      ok: false,
      status: 422,
      error: {
        code: rate.status === 'DECLINED' ? 'QUOTE_DECLINED' : 'QUOTE_REFERRED',
        message: rate.status === 'DECLINED'
          ? 'This quote has been declined and cannot be paid.'
          : 'This quote is pending underwriter review and cannot be paid yet.',
        details: { rateStatus: rate.status },
      },
    };
  }

  const quoteData = rate.quoteData;
  const quoteResponse = rate.quoteResponse;
  const primaryOpt = args.parseRecord(quoteResponse?.primaryOption);
  const total = Number(Number(primaryOpt?.annualPremium ?? 0).toFixed(2));

  if (!Number.isFinite(total) || total <= 0) {
    return { ok: false, status: 422, error: { code: 'NO_QUOTE', message: 'Quote not available for payment yet' } };
  }

  // Sanctions screening gate BEFORE we open the payment page (ADR-0067).
  // Quoting no longer screens — a price preview must never fail-close — but
  // "keep payment/binding/issuance blocked until screening succeeds" is the
  // business rule (Abbeygate, Aug 2026). Checkout is where money is about to
  // change hands and, by now, the customer's real name has been saved, so we
  // screen the real subject here and refuse to open checkout on a block or a
  // provider outage (fail-closed). Issuance (PAYMENT_ISSUE) still screens as a
  // post-payment backstop.
  const screeningSubject = resolveIndividualScreeningSubject({
    policyHolderName: (
      await tenantScopedPrisma.policyHolder
        .findFirst({ where: { policies: { some: { id: policy.id } } }, select: { name: true } })
        .catch(() => null)
    )?.name ?? null,
    quoteData,
  });
  if (!screeningSubject) {
    // Only a placeholder / no real name — we cannot screen, so we must not take
    // payment. This should not happen once contact details are saved, but if it
    // does we block rather than charge an unscreened customer.
    return {
      ok: false,
      status: 409,
      error: {
        code: 'SANCTION_SCREENING_SUBJECT_MISSING',
        message: 'We need your name before you can continue to payment.',
      },
    };
  }
  try {
    await getSanctionsService().assertClearOrThrow({
      actionType: 'PAYMENT_CHECKOUT',
      policyId: policy.id,
      subjectName: screeningSubject.subjectName,
      dateOfBirth: screeningSubject.dateOfBirth,
      correlationId: args.request.correlationId || `payment-checkout:${policy.id}`,
    });
  } catch (error) {
    if (error instanceof SanctionsBlockError) {
      const failClosed = error.outcome === 'provider_unavailable' || error.outcome === 'error';
      return {
        ok: false,
        status: failClosed ? 503 : 409,
        error: {
          code: failClosed ? 'SANCTION_SCREENING_UNAVAILABLE' : 'SANCTION_SCREENING_BLOCKED',
          // Tipping-off safe: never tell the customer they matched a list.
          message: failClosed
            ? 'Payment is temporarily unavailable. Please try again shortly.'
            : 'We are unable to take payment online for this application. Our team will review it and contact you shortly.',
          details: { screeningOutcome: error.outcome, reasonCode: error.reasonCode },
        },
      };
    }
    return {
      ok: false,
      status: 503,
      error: {
        code: 'SANCTION_SCREENING_UNAVAILABLE',
        message: 'Payment is temporarily unavailable. Please try again shortly.',
      },
    };
  }

  const digitsOnly = (s: unknown) => String(s ?? '').replace(/[^\d]/g, '');
  const normalizePhoneE164Loose = (raw: unknown): string | undefined => {
    const s = String(raw ?? '').trim();
    if (!s) return undefined;
    if (s.startsWith('+')) {
      const d = '+' + digitsOnly(s);
      return d.length >= 8 ? d.slice(0, 32) : undefined;
    }
    const d = digitsOnly(s);
    return d.length >= 8 ? d.slice(0, 32) : undefined;
  };

  const proposer = (quoteData && typeof quoteData === 'object'
    ? ((quoteData as Record<string, unknown>).proposer as Record<string, unknown> | undefined)
    : undefined) ?? {};
  const proposerAddress = (proposer.address as Record<string, unknown> | undefined) ?? {};
  const givenName = String(proposer.firstName ?? '').trim() || undefined;
  const surname = String(proposer.lastName ?? '').trim() || undefined;
  const email = String(proposer.email ?? '').trim() || undefined;
  const phone = normalizePhoneE164Loose(proposer.phone as string | undefined);

  const billingStreet1 = String(proposerAddress.line1 ?? '').trim() || undefined;
  const billingCity = String(proposerAddress.city ?? '').trim() || undefined;
  const billingPostcode = String(proposerAddress.postcode ?? '').trim() || undefined;
  const billingCountry = getTenantConfig().countryCode;

  const amount = formatAmountEUR(total);
  const currency = 'EUR';
  const merchantTransactionId = safeMerchantTxId(String(policy.policyNumber || publicPolicyRequestId));

  // Tenant-aware: prefer ALS publicBaseUrl, then the inbound request's
  // origin/host, then env. Previously env-first → all tenants got the same
  // domain in payment redirect URLs.
  const baseUrl = resolvePublicAppBaseUrlFromContext({
    origin: args.request.origin,
    protocol: process.env.NODE_ENV === 'production' ? 'https' : args.request.protocol,
    host: args.request.host,
  });
  const token = String(policy.publicSessionToken ?? '').trim() || args.newPublicSessionToken();
  if (!policy.publicSessionToken) {
    await tenantScopedPrisma.policy.update({ where: { id: policy.id }, data: { publicSessionToken: token } }).catch(() => undefined);
  }
  const shopperResultUrl = new URL(`${baseUrl}/quote/${encodeURIComponent(token)}`);
  shopperResultUrl.searchParams.set('product', resolvePublicProductSlug(policy.productType));
  shopperResultUrl.searchParams.set('step', 'payment');
  shopperResultUrl.searchParams.set('ref', publicPolicyRequestId);
  const shopperResultHref = shopperResultUrl.toString();

  if (idempotencyKey) {
    const existing = await tenantScopedPrisma.payment.findFirst({
      where: { policyId: policy.id, provider: 'CARDCORP', idempotencyKey, status: { not: 'CANCELLED' } },
      orderBy: { createdAt: 'desc' },
    });
    if (existing?.checkoutId) {
      return {
        ok: true,
        data: {
          paymentId: existing.id,
          checkoutId: existing.checkoutId,
          integrity: existing.integrity || null,
          widgetScriptUrl: `${cfg.baseUrl}/v1/paymentWidgets.js?checkoutId=${encodeURIComponent(existing.checkoutId)}`,
          shopperResultUrl: shopperResultHref,
          amount,
          currency,
          brands: 'VISA MASTER',
          idempotent: true,
        },
      };
    }
  }

  logger.info(`[CardCorp] Creating checkout with Base URL: ${cfg.baseUrl}`);
  const baseCheckoutPayload = {
    entityId: cfg.entityId,
    bearerToken: cfg.bearerToken,
    baseUrl: cfg.baseUrl,
    amount,
    currency,
    paymentType: 'DB' as const,
    integrity: true,
    testMode: cfg.testMode,
    merchantTransactionId,
    threeDSecure: { challengeIndicator: '04' as const },
    customParameters: {
      PolicyId: policy.id,
      PolicyNumber: String(policy.policyNumber || ''),
      PaymentType: 'SinglePayment',
      CustomerEmail: email || '',
    },
  };
  const customer = {
    email,
    givenName,
    surname,
    phone,
    merchantCustomerId: String(policy.policyNumber || publicPolicyRequestId),
    ip: (args.request.xForwardedFor || '').split(',')[0]?.trim() || args.request.ip,
  };
  const billing = { street1: billingStreet1, city: billingCity, country: billingCountry, postcode: billingPostcode };

  let checkout: CardcorpCreateCheckoutResult;
  try {
    checkout = await cardcorpCreateCheckout({
      ...baseCheckoutPayload,
      customer,
      billing,
    });
  } catch (e) {
    const msg = (e as Error)?.message || String(e);
    logger.warn({ data: msg }, '[CardCorp] Checkout create failed with customer/billing payload; retrying minimal payload.');
    checkout = await cardcorpCreateCheckout(baseCheckoutPayload);
  }

  let payment: { id: string; checkoutId: string | null; integrity: string | null };
  try {
    payment = await runTenantScopedTransaction(async (_tx) => {
    const tx = _tx as unknown as Prisma.TransactionClient;
      // A provider checkout is opened outside the database transaction. Before
      // persisting or returning it, atomically claim the freshly-rated quote.
      // If a concurrent re-rate has returned the policy to referral, this
      // update affects no rows and the provider session remains unlinked and
      // cannot later be verified or issued.
      const claimed = await tx.policy.updateMany({
        where: { id: policy.id, status: 'QUOTED', isLocked: false },
        data: { isLocked: true, paymentStatus: 'PENDING' },
      });
      if (claimed.count !== 1) throw new CheckoutNoLongerEligibleError();

      const paymentCreateData: Prisma.PaymentUncheckedCreateInput = {
          operatingTenantId: getTenantConfig().id,
          policyId: policy.id,
          provider: 'CARDCORP',
          purpose: 'CUSTOMER_CHECKOUT',
          initiatedBy: 'CUSTOMER',
          entityId: cfg.entityId,
          checkoutId: checkout.id,
          integrity: checkout.integrity ?? undefined,
          merchantTransactionId,
          idempotencyKey,
          amount: total,
          currency,
          paymentType: 'DB',
          status: 'PENDING',
          raw: toInputJson(checkout.raw),
        };
      const created = await tx.payment.create({
        data: paymentCreateData,
        select: { id: true, checkoutId: true, integrity: true },
      });
      await transitionPolicyLifecycle({
        tx,
        policyId: policy.id,
        to: 'AWAITING_PAYMENT',
        actorId: 'customer',
        actorType: 'CUSTOMER',
        reasonCode: 'PAYMENT_CHECKOUT_STARTED',
        correlationId: args.request.correlationId,
      });
      return created;
    });
  } catch (error) {
    if (error instanceof CheckoutNoLongerEligibleError) {
      return {
        ok: false,
        status: 409,
        error: {
          code: 'QUOTE_NOT_ELIGIBLE_FOR_PAYMENT',
          message: 'This quote changed while payment was being prepared. Please review the updated quote before continuing.',
        },
      };
    }
    throw error;
  }
  await enqueuePolicyListIndexUpdate(prisma, policy.id);

  return {
    ok: true,
    data: {
      paymentId: payment.id,
      checkoutId: payment.checkoutId || checkout.id,
      integrity: payment.integrity ?? checkout.integrity ?? null,
      widgetScriptUrl: `${cfg.baseUrl}/v1/paymentWidgets.js?checkoutId=${encodeURIComponent(checkout.id)}`,
      shopperResultUrl: shopperResultHref,
      amount,
      currency,
      brands: 'VISA MASTER',
    },
  };
}

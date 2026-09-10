import type { Prisma } from '@prisma/client';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import {
  cardcorpGetPaymentStatus,
  cardcorpGetPaymentStatusByResourcePath,
  type CardcorpPaymentStatusResult,
} from '../infra/cardcorpGateway.js';
import { logger } from '../../../platform/utils/logger.js';

/**
 * ABY-54 — canonical "issuance actually ran" check.
 *
 * The CardCorp `/status` short-circuit historically trusted that a
 * `Payment.status = 'PAID'` row implied "the canonical issuance spine
 * has written its outbox event for `DOC.GENERATE_ISSUED_POLICY_PACK`,
 * the welcome email will follow, no retry needed". That invariant is
 * NOT enforced by the database — `applyCardcorpVerifiedStatus`
 * commits PAID in one transaction and then calls
 * `runCardcorpPaidIssuance` (which writes the INCEPTION row + outbox
 * event in a SEPARATE transaction). If anything between those two
 * commits fails (sanctions timeout, premium drift, P2002 retries
 * exhausted, container OOM-killed mid-flight, etc.) the customer is
 * left with a durable `PAID-but-no-INCEPTION` zombie state — and
 * because every subsequent `/status` poll short-circuited on
 * `payment.status === 'PAID'`, the issuance NEVER got another chance.
 *
 * The actual ground-truth signal that the spine ran is the existence
 * of an `INCEPTION` `RiskTransaction` for the policy: that row is
 * written in the SAME transaction as the outbox event, so its
 * presence is the only honest "spine ran" predicate. When it is
 * missing we fall through to the gateway path (or synthesize a
 * status from the stored payment) so `applyCardcorpVerifiedStatus`
 * can re-run idempotently — `runCardcorpPaidIssuance` already
 * detects pre-existing INCEPTION rows and just re-enqueues the
 * issued-pack outbox event for them, so this never duplicates work.
 */
async function policyHasInceptionRiskTransaction(policyId: string): Promise<boolean> {
  const inception = await tenantScopedPrisma.riskTransaction.findFirst({
    where: { policyId, transactionType: 'INCEPTION' },
    select: { id: true },
  });
  return Boolean(inception);
}

/**
 * Reconstruct the gateway-equivalent `CardcorpPaymentStatusResult`
 * from a previously-stored PAID payment row. Used when we want to
 * re-run the issuance side of `applyCardcorpVerifiedStatus` without
 * re-hitting the gateway (e.g. session has expired, or we just
 * already trust the previous gateway verification).
 *
 * The fields populated mirror what `cardcorpGetPaymentStatus(...)`
 * would have returned at the time the stored row was written —
 * `payment.raw` was persisted directly from that gateway response,
 * so `id`, `amount`, `currency`, and `result.code|description` are
 * all there.
 */
function synthesizeStatusFromStoredPayment(args: {
  payment: { paymentId: string | null; raw: unknown };
  storedResult: { code: string; description?: string };
}): CardcorpPaymentStatusResult {
  const r = (args.payment.raw && typeof args.payment.raw === 'object' && !Array.isArray(args.payment.raw)
    ? (args.payment.raw as Record<string, unknown>)
    : {});
  const amount = typeof r.amount === 'string' ? r.amount : undefined;
  const currency = typeof r.currency === 'string' ? r.currency : undefined;
  const idFromRaw = typeof r.id === 'string' ? r.id : undefined;
  return {
    ok: args.storedResult.code.startsWith('000.'),
    code: args.storedResult.code,
    description: args.storedResult.description,
    paymentId: args.payment.paymentId || idFromRaw,
    amount,
    currency,
    raw: (args.payment.raw ?? {}) as Prisma.InputJsonValue,
  };
}

type CardcorpConfig = {
  entityId: string;
  bearerToken: string;
  baseUrl: string;
};

type ShortCircuitResponse = {
  ok: boolean;
  code: string;
  description?: string;
  paymentStatus: string;
  policyStatus: 'PAID' | 'UNPAID';
  idempotent?: boolean;
  note?: string;
};

export async function verifyCardcorpPaymentStatus(args: {
  policyId: string;
  checkoutId: string;
  resourcePath: string;
  cfg: CardcorpConfig;
  protocol: string;
  host: string;
  origin?: string;
  parsePaymentRawResult: (raw: unknown) => { code: string; description?: string };
}): Promise<
  | { kind: 'error'; status: number; code: string; message: string }
  | { kind: 'response'; data: ShortCircuitResponse }
  | {
      kind: 'continue';
      payment: { id: string; paymentId: string | null; status: string; raw: unknown; checkoutId: string | null };
      status: CardcorpPaymentStatusResult;
    }
> {
  const inferredCheckoutId =
    !args.checkoutId && args.resourcePath
      ? (() => {
          const m = args.resourcePath.match(/^\/v1\/checkouts\/([^/]+)\/payment/i);
          return m?.[1] || '';
        })()
      : '';
  const checkoutIdForLookup = args.checkoutId || inferredCheckoutId;

  const payment = await tenantScopedPrisma.payment.findFirst({
    where: {
      policyId: args.policyId,
      provider: 'CARDCORP',
      ...(checkoutIdForLookup ? { checkoutId: checkoutIdForLookup } : {}),
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, paymentId: true, status: true, raw: true, checkoutId: true },
  });
  if (!payment) {
    return { kind: 'error', status: 404, code: 'NOT_FOUND', message: 'Payment not found' };
  }

  const storedResult = args.parsePaymentRawResult(payment.raw);
  if ((payment.status === 'PAID' || payment.status === 'FAILED') && storedResult.code) {
    const ok = storedResult.code.startsWith('000.');
    // ABY-54 — when /status is hit again on an already-PAID payment we
    // MUST verify that the canonical issuance spine actually completed
    // before short-circuiting; otherwise a PAID-but-no-INCEPTION zombie
    // (sanctions timeout, premium drift, OOM, etc. between the PAID
    // commit and the issuance commit) is locked in forever and the
    // customer never receives docs / welcome email. The presence of
    // an INCEPTION RiskTransaction is the only honest "spine ran"
    // predicate (it is written in the same transaction as the outbox
    // row that drives DOC.GENERATE_ISSUED_POLICY_PACK).
    if (ok && payment.status === 'PAID') {
      const spineRan = await policyHasInceptionRiskTransaction(args.policyId);
      if (!spineRan) {
        logger.warn(
          { policyId: args.policyId, paymentId: payment.id },
          'cardcorp.status.paid_without_inception.repair_via_apply',
        );
        return {
          kind: 'continue',
          payment,
          status: synthesizeStatusFromStoredPayment({ payment, storedResult }),
        };
      }
    }
    return {
      kind: 'response',
      data: {
        ok,
        code: storedResult.code,
        description: storedResult.description,
        paymentStatus: payment.status,
        policyStatus: ok ? 'PAID' : 'UNPAID',
      },
    };
  }

  logger.info(
    `[CardCorp] Checking status for ${
      args.resourcePath ? `resourcePath=${args.resourcePath}` : `checkoutId=${args.checkoutId}`
    } on ${args.cfg.baseUrl} with Entity ${args.cfg.entityId}`,
  );

  const checkoutIdForGateway = args.checkoutId || payment.checkoutId || '';
  if (!args.resourcePath && !checkoutIdForGateway) {
    return { kind: 'error', status: 400, code: 'BAD_REQUEST', message: 'checkoutId or resourcePath is required' };
  }

  let status: CardcorpPaymentStatusResult;
  try {
    status = args.resourcePath
      ? await cardcorpGetPaymentStatusByResourcePath({
          baseUrl: args.cfg.baseUrl,
          entityId: args.cfg.entityId,
          bearerToken: args.cfg.bearerToken,
          resourcePath: args.resourcePath,
        })
      : await cardcorpGetPaymentStatus({
          baseUrl: args.cfg.baseUrl,
          entityId: args.cfg.entityId,
          bearerToken: args.cfg.bearerToken,
          checkoutId: checkoutIdForGateway,
        });
  } catch (e) {
    const msg = (e as Error)?.message || String(e);
    const isNoSession = msg.includes('No payment session found') || msg.includes('200.300.404');
    if (isNoSession) {
      const paid = await tenantScopedPrisma.payment.findFirst({
        where: { policyId: args.policyId, provider: 'CARDCORP', status: 'PAID' },
        orderBy: { createdAt: 'desc' },
      });
      const paidResult = paid ? args.parsePaymentRawResult(paid.raw) : null;
      const ok = paidResult ? paidResult.code.startsWith('000.') : false;
      if (paid && ok) {
        // ABY-54 — same invariant as the in-process PAID short-circuit
        // above: only treat the stored PAID payment as terminal when
        // the canonical issuance spine actually wrote an INCEPTION
        // row. Otherwise fall through to the apply-side and let the
        // idempotent runCardcorpPaidIssuance recover the zombie.
        const spineRan = await policyHasInceptionRiskTransaction(args.policyId);
        if (!spineRan) {
          logger.warn(
            { policyId: args.policyId, paymentId: paid.id },
            'cardcorp.status.expired_session_paid_without_inception.repair_via_apply',
          );
          return {
            kind: 'continue',
            payment: {
              id: paid.id,
              paymentId: paid.paymentId,
              status: paid.status,
              raw: paid.raw,
              checkoutId: paid.checkoutId,
            },
            status: synthesizeStatusFromStoredPayment({
              payment: { paymentId: paid.paymentId, raw: paid.raw },
              storedResult: { code: paidResult?.code ?? '', description: paidResult?.description },
            }),
          };
        }
        return {
          kind: 'response',
          data: {
            ok: true,
            code: paidResult?.code ?? '',
            description: paidResult?.description,
            paymentStatus: paid.status,
            policyStatus: 'PAID',
            idempotent: true,
            note: 'Verified from stored payment outcome after gateway session expired.',
          },
        };
      }
    }
    throw e;
  }

  return { kind: 'continue', payment, status };
}

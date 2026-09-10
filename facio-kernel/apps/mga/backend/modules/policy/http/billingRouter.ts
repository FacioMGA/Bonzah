import type { Router } from 'express';
import { createCardcorpCheckoutUseCase } from '../app/billing/createCardcorpCheckout.js';
import { verifyCardcorpStatusUseCase } from '../app/billing/verifyCardcorpStatus.js';
import { refundCardcorpPaymentUseCase } from '../app/billing/refundCardcorpPayment.js';
import { sendPaymentRequestUseCase } from '../app/billing/sendPaymentRequest.js';
import { abandonCardcorpCheckoutUseCase } from '../app/billing/abandonCardcorpCheckout.js';
import { getBillingSummaryUseCase } from '../app/billing/getBillingSummary.js';
import {
  buildAbandonCheckoutDeps,
  buildBillingSummaryDeps,
  buildCreateCheckoutDeps,
  buildRefundDeps,
  buildSendPaymentRequestDeps,
  buildVerifyStatusDeps,
  resolveBillingAppUrl,
} from './billingRouter.adapters.js';

import { logger } from '../../../platform/utils/logger.js';
import { resolvePublicAppBaseUrlFromRequest } from '../../../platform/http/publicAppLinks.js';
import {
  actorFromRequest,
  policyAuditLog,
  sendRouterError,
  sendUseCaseResponse,
} from './billingRouter.helpers.js';
import {
  PaymentRequestBodySchema,
  BillingSummaryQuerySchema,
  CheckoutBodySchema,
  AbandonBodySchema,
  StatusQuerySchema,
  RefundBodySchema,
} from './billingRouter.schemas.js';

export function registerPolicyBillingRoutes(router: Router) {
  router.post('/:id/payments/send-request', policyAuditLog, async (req, res) => {
    try {
      const { id: policyId } = req.params;
      const actor = actorFromRequest(req);
      const parsedBody = PaymentRequestBodySchema.safeParse(req.body);
      const body = parsedBody.success ? parsedBody.data : null;
      const amount = Number(body?.amount || 0);
      const balanceSnapshot = Number(body?.balanceSnapshot ?? NaN);
      const appUrl = resolveBillingAppUrl(req);
      const riskTransactionId = String(body?.riskTransactionId || '').trim() || null;
      const result = await sendPaymentRequestUseCase(
        {
          policyId,
          actor,
          amount,
          email: body?.email,
          ttlHours: body?.ttlHours,
          riskTransactionId,
          balanceSnapshot,
          appUrl,
        },
        buildSendPaymentRequestDeps()
      );
      return sendUseCaseResponse(res, result);
    } catch (error) {
      return sendRouterError(res, {
        logger,
        error,
        logMessage: 'Send payment request error:',
        fallbackMessage: 'Failed to send payment request',
      });
    }
  });

  /**
   * GET /api/policies/:id/billing-summary?riskTransactionId=...
   * Returns balance header + ledger transactions for the policy (optionally scoped to a RiskTransaction).
   *
   * Balance = targetAmount - paid + refunded
   * - Charges increase paid
   * - Refunds increase refunded
   */
  router.get('/:id/billing-summary', policyAuditLog, async (req, res) => {
    try {
      const { id: policyId } = req.params;
      const parsedQuery = BillingSummaryQuerySchema.safeParse(req.query);
      const riskTransactionId = String((parsedQuery.success ? parsedQuery.data.riskTransactionId : '') || '').trim() || null;
      const result = await getBillingSummaryUseCase(
        { policyId, riskTransactionId },
        buildBillingSummaryDeps()
      );
      return sendUseCaseResponse(res, result);
    } catch (error) {
      return sendRouterError(res, {
        logger,
        error,
        logMessage: 'Billing summary error:',
        fallbackMessage: 'Failed to load billing summary',
      });
    }
  });

  /**
   * POST /api/policies/:id/payments/cardcorp/checkout
   * Creates a CardCorp checkout for BO-driven collections.
   * Returns COPYandPAY widget details; the operator can take payment in the BO modal.
   */
  router.post('/:id/payments/cardcorp/checkout', policyAuditLog, async (req, res) => {
    try {
      const { id: policyId } = req.params;
      const actor = actorFromRequest(req);
      const parsedBody = CheckoutBodySchema.safeParse(req.body);
      const body = parsedBody.success ? parsedBody.data : null;
      const amountNum = Number(body?.amount || 0);
      const currency = String(body?.currency || 'EUR').toUpperCase();
      const riskTransactionId = body?.riskTransactionId ? String(body.riskTransactionId) : null;
      // Tenant-aware: ALS publicBaseUrl → request origin → env. The previous
      // env-first ordering meant BO checkout success/cancel URLs always
      // landed on the env-configured site regardless of operating tenant.
      const baseUrl = resolvePublicAppBaseUrlFromRequest(req);
      const result = await createCardcorpCheckoutUseCase(
        {
          policyId,
          actor,
          amount: amountNum,
          currency,
          riskTransactionId,
          baseUrl: String(baseUrl || ''),
        },
        buildCreateCheckoutDeps()
      );
      return sendUseCaseResponse(res, result);
    } catch (error) {
      return sendRouterError(res, {
        logger,
        error,
        logMessage: 'BO CardCorp checkout error:',
        fallbackMessage: 'Failed to create checkout',
      });
    }
  });

  /**
   * POST /api/policies/:id/payments/cardcorp/abandon
   * Marks a BO checkout attempt as cancelled when the operator closes the modal
   * before completing payment. This prevents forever-PENDING rows in the ledger.
   */
  router.post('/:id/payments/cardcorp/abandon', policyAuditLog, async (req, res) => {
    try {
      const { id: policyId } = req.params;
      const actor = actorFromRequest(req);
      const parsedBody = AbandonBodySchema.safeParse(req.body);
      const body = parsedBody.success ? parsedBody.data : null;
      const paymentId = String(body?.paymentId || '').trim();
      const checkoutId = String(body?.checkoutId || '').trim();
      const result = await abandonCardcorpCheckoutUseCase(
        {
          policyId,
          actor,
          paymentId,
          checkoutId,
        },
        buildAbandonCheckoutDeps()
      );
      return sendUseCaseResponse(res, result);
    } catch (error) {
      return sendRouterError(res, {
        logger,
        error,
        logMessage: 'BO CardCorp abandon error:',
        fallbackMessage: 'Failed to abandon checkout',
      });
    }
  });

  /**
   * GET /api/policies/:id/payments/cardcorp/status?checkoutId=...&resourcePath=...
   * Verifies CardCorp payment result (BO) and updates Payment record.
   */
  router.get('/:id/payments/cardcorp/status', policyAuditLog, async (req, res) => {
    try {
      const { id: policyId } = req.params;
      const parsedQuery = StatusQuerySchema.safeParse(req.query);
      const checkoutId = String((parsedQuery.success ? parsedQuery.data.checkoutId : '') || '').trim();
      const resourcePath = String((parsedQuery.success ? parsedQuery.data.resourcePath : '') || '').trim();
      const result = await verifyCardcorpStatusUseCase(
        {
          policyId,
          checkoutId,
          resourcePath,
        },
        buildVerifyStatusDeps()
      );
      return sendUseCaseResponse(res, result);
    } catch (error) {
      return sendRouterError(res, {
        logger,
        error,
        logMessage: 'BO CardCorp status error:',
        fallbackMessage: 'Failed to verify payment',
      });
    }
  });

  /**
   * POST /api/policies/:id/payments/cardcorp/refund
   * Performs a CardCorp refund (RF) against a prior payment.
   */
  router.post('/:id/payments/cardcorp/refund', policyAuditLog, async (req, res) => {
    try {
      const { id: policyId } = req.params;
      const actor = actorFromRequest(req);
      const parsedBody = RefundBodySchema.safeParse(req.body);
      const body = parsedBody.success ? parsedBody.data : null;
      const referencePaymentDbId = String(body?.referencePaymentId || '').trim();
      const amountNum = Number(body?.amount || 0);
      const currency = String(body?.currency || 'EUR').toUpperCase();
      const riskTransactionId = body?.riskTransactionId ? String(body.riskTransactionId) : null;
      const result = await refundCardcorpPaymentUseCase(
        {
          policyId,
          actor,
          referencePaymentId: referencePaymentDbId,
          amount: amountNum,
          currency,
          riskTransactionId,
        },
        buildRefundDeps()
      );
      return sendUseCaseResponse(res, result);
    } catch (error) {
      return sendRouterError(res, {
        logger,
        error,
        logMessage: 'BO CardCorp refund error:',
        fallbackMessage: 'Failed to refund',
      });
    }
  });
}


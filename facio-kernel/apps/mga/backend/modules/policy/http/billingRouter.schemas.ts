import { z } from 'zod';

/**
 * Request body/query schemas for the BO billing router.
 *
 * Kept in a dependency-free module (no DB/adapter imports) so the parsing
 * contract can be unit-tested in isolation.
 *
 * `riskTransactionId` is `.nullable()` because the BO billing UI sends an
 * explicit JSON `null` when no risk transaction is selected. `.optional()`
 * alone rejects null, which previously failed the whole body parse so `amount`
 * defaulted to 0 and the server returned a misleading
 * "amount must be a positive number" for an otherwise valid amount.
 */
export const PaymentRequestBodySchema = z.object({
  amount: z.coerce.number(),
  email: z.string().optional(),
  ttlHours: z.coerce.number().optional(),
  riskTransactionId: z.string().nullable().optional(),
  balanceSnapshot: z.coerce.number().optional(),
});

export const BillingSummaryQuerySchema = z.object({
  riskTransactionId: z.string().optional(),
});

export const CheckoutBodySchema = z.object({
  amount: z.coerce.number(),
  currency: z.string().optional(),
  riskTransactionId: z.string().nullable().optional(),
});

export const AbandonBodySchema = z.object({
  paymentId: z.string().optional(),
  checkoutId: z.string().optional(),
});

export const StatusQuerySchema = z.object({
  checkoutId: z.string().optional(),
  resourcePath: z.string().optional(),
});

export const RefundBodySchema = z.object({
  referencePaymentId: z.string(),
  amount: z.coerce.number(),
  currency: z.string().optional(),
  riskTransactionId: z.string().nullable().optional(),
});

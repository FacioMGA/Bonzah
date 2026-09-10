import { describe, it, expect } from 'vitest';
import {
  PaymentRequestBodySchema,
  CheckoutBodySchema,
  RefundBodySchema,
} from '../billingRouter.schemas.js';

/**
 * Regression: the BO billing UI sends `riskTransactionId: null` when no risk
 * transaction is selected. A `.optional()`-only schema rejected null, failing
 * the whole body parse so `amount` defaulted to 0 and the server returned a
 * misleading "amount must be a positive number" even for a valid amount.
 */
describe('billing router body schemas — null riskTransactionId', () => {
  it('CheckoutBodySchema accepts an explicit null riskTransactionId and keeps the amount', () => {
    const parsed = CheckoutBodySchema.safeParse({
      amount: 1,
      currency: 'EUR',
      riskTransactionId: null,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.amount).toBe(1);
      expect(parsed.data.riskTransactionId).toBeNull();
    }
  });

  it('CheckoutBodySchema still accepts a string and an omitted riskTransactionId', () => {
    expect(CheckoutBodySchema.safeParse({ amount: 5, riskTransactionId: 'rt_1' }).success).toBe(true);
    expect(CheckoutBodySchema.safeParse({ amount: 5 }).success).toBe(true);
  });

  it('PaymentRequestBodySchema accepts null riskTransactionId', () => {
    const parsed = PaymentRequestBodySchema.safeParse({ amount: 12, riskTransactionId: null });
    expect(parsed.success).toBe(true);
  });

  it('RefundBodySchema accepts null riskTransactionId', () => {
    const parsed = RefundBodySchema.safeParse({
      referencePaymentId: 'pay_1',
      amount: 3,
      riskTransactionId: null,
    });
    expect(parsed.success).toBe(true);
  });
});

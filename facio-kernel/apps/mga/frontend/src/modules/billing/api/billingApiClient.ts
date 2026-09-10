/**
 * Billing API Client — Domain-Scoped (CHAMPS)
 *
 * Canonical import for all billing/payment API calls.
 * Owns: billing summaries, payment requests, Cardcorp checkout/verify/abandon/refund.
 *
 * This file calls transport.request() directly — it does NOT depend on
 * the monolithic ApiClient class.
 */
import { http } from '@/src/shared/api/http';
import type { ApiResponse } from '@/src/shared/api/types';

type UnknownRecord = Record<string, unknown>;

// ─── Types ───

export interface BillingSummary {
    totalPremium: number;
    totalPaid: number;
    balance: number;
    currency: string;
    payments: UnknownRecord[];
    [key: string]: unknown;
}

export interface PaymentRequestResult {
    sent: boolean;
    paymentLink?: string;
    paymentId?: string;
    [key: string]: unknown;
}

export interface CardcorpCheckoutResult {
    checkoutId: string;
    paymentId?: string;
    widgetUrl?: string;
    [key: string]: unknown;
}

// ─── Client ───

export const billingApiClient = {
    async getBillingSummary(
        policyId: string,
        opts?: { riskTransactionId?: string | null },
    ): Promise<ApiResponse<BillingSummary>> {
        const rt = opts?.riskTransactionId ? String(opts.riskTransactionId) : '';
        const qs = rt ? `?riskTransactionId=${encodeURIComponent(rt)}` : '';
        return http.request<BillingSummary>(`policies/${policyId}/billing-summary${qs}`);
    },

    async sendPolicyPaymentRequest(
        policyId: string,
        payload: {
            amount: number;
            email?: string;
            ttlHours?: number;
            riskTransactionId?: string | null;
            balanceSnapshot?: number;
        },
    ): Promise<ApiResponse<PaymentRequestResult>> {
        return http.request<PaymentRequestResult>(`policies/${policyId}/payments/send-request`, {
            method: 'POST',
            body: JSON.stringify(payload),
        });
    },

    async createBoCardcorpCheckout(
        policyId: string,
        payload: { amount: number; currency?: string; riskTransactionId?: string | null },
    ): Promise<ApiResponse<CardcorpCheckoutResult>> {
        return http.request<CardcorpCheckoutResult>(`policies/${policyId}/payments/cardcorp/checkout`, {
            method: 'POST',
            body: JSON.stringify(payload),
        });
    },

    async verifyBoCardcorpPayment(
        policyId: string,
        payload: { checkoutId?: string; resourcePath?: string },
    ) {
        const sp = new URLSearchParams();
        if (payload.checkoutId) sp.set('checkoutId', payload.checkoutId);
        if (payload.resourcePath) sp.set('resourcePath', payload.resourcePath);
        return http.request(`policies/${policyId}/payments/cardcorp/status?${sp.toString()}`);
    },

    async abandonBoCardcorpCheckout(
        policyId: string,
        payload: { paymentId?: string; checkoutId?: string },
    ) {
        return http.request(`policies/${policyId}/payments/cardcorp/abandon`, {
            method: 'POST',
            body: JSON.stringify(payload || {}),
        });
    },

    async refundBoCardcorp(
        policyId: string,
        payload: {
            referencePaymentId: string;
            amount: number;
            currency?: string;
            riskTransactionId?: string | null;
        },
    ) {
        return http.request(`policies/${policyId}/payments/cardcorp/refund`, {
            method: 'POST',
            body: JSON.stringify(payload),
        });
    },
};

export type BillingApiClient = typeof billingApiClient;

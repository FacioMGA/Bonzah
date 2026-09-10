import type { Request } from 'express';
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { prisma, tenantScopedPrisma, runTenantScopedTransaction } from '../../../platform/db/connection.js';
import { resolvePublicAppBaseUrlFromRequest } from '../../../platform/http/publicAppLinks.js';
import {
  cardcorpCreateCheckout,
  cardcorpGetPaymentStatus,
  cardcorpGetPaymentStatusByResourcePath,
  cardcorpRefundPayment,
} from '../../payments/app/cardcorpGateway.js';
import { sendPaymentRequestEmail } from '../app/communicationsInterop.js';
import { getCardcorpConfig, newPublicSessionToken } from '../app/shared.js';
import { enqueuePolicyListIndexUpdate } from '../app/policyListIndex.js';
import {
  parseRecord,
  parseSnapshotValue,
  toInputJson,
  errorMessage,
  logAuditEvent,
} from './billingRouter.helpers.js';
import {
  POLICY_CHANGE_TRANSACTION_TYPES,
  VERSION_HISTORY_TRANSACTION_TYPES,
} from '../app/riskTransactionTypes.js';

export function resolveBillingAppUrl(req: Request): string {
  return resolvePublicAppBaseUrlFromRequest(req);
}

export function buildSendPaymentRequestDeps() {
  return {
    repo: {
      async findPolicyContact(targetPolicyId: string) {
        const policy = await tenantScopedPrisma.policy.findUnique({
          where: { id: targetPolicyId },
          select: {
            id: true,
            policyNumber: true,
            publicSessionToken: true,
            quoteData: true,
            policyHolder: true,
          },
        });
        if (!policy) return null;
        const contact = (() => {
          try {
            return policy.policyHolder?.contact ? parseRecord(JSON.parse(String(policy.policyHolder.contact))) : {};
          } catch {
            return {};
          }
        })();
        return {
          policyId: policy.id,
          policyNumber: String(policy.policyNumber || ''),
          publicSessionToken: String(policy.publicSessionToken || ''),
          quoteData: parseRecord(policy.quoteData),
          policyHolderName: String(policy.policyHolder?.name || ''),
          policyHolderContact: contact,
        };
      },
      async ensurePublicSessionToken(targetPolicyId: string, nextToken: string) {
        await tenantScopedPrisma.policy.update({
          where: { id: targetPolicyId },
          data: { publicSessionToken: nextToken },
        }).catch(() => undefined);
      },
      async upsertPaymentRequestState(args: {
        policyId: string;
        token: string;
        amount: number;
        balanceSnapshot: number | null;
        requestedBy: string | null;
        expiresAtIso: string;
        email: string;
        riskTransactionId: string | null;
        paymentUrl: string;
      }) {
        await runTenantScopedTransaction(async (_tx) => {
          const tx = _tx as unknown as Prisma.TransactionClient;
          const existingState = await tx.policyStateCurrent.findUnique({ where: { policyId: args.policyId } });
          const existingSnapshot = parseSnapshotValue(existingState?.snapshot);
          const paymentRequest = {
            token: args.token,
            amount: args.amount,
            balanceSnapshot: args.balanceSnapshot,
            requestedAt: new Date().toISOString(),
            requestedBy: args.requestedBy,
            expiresAt: args.expiresAtIso,
            email: args.email,
          };
          await tx.policyStateCurrent.upsert({
            where: { policyId: args.policyId },
            update: {
              snapshot: {
                ...existingSnapshot,
                paymentRequest,
              },
            },
            create: {
              policyId: args.policyId,
              snapshot: { paymentRequest },
            } as unknown as Prisma.PolicyStateCurrentUncheckedCreateInput,
          });
          await tx.payment.create({
            data: {
              policyId: args.policyId,
              riskTransactionId: args.riskTransactionId,
              provider: 'CARDCORP',
              purpose: 'CUSTOMER_CHECKOUT_REQUEST',
              initiatedBy: 'BO',
              amount: args.amount,
              currency: 'EUR',
              paymentType: 'DB',
              status: 'PAYMENT_REQUEST_SENT',
              requestPayload: {
                policyId: args.policyId,
                amount: args.amount,
                currency: 'EUR',
                balanceSnapshot: args.balanceSnapshot,
                paymentUrl: args.paymentUrl,
                expiresAt: args.expiresAtIso,
                to: args.email,
              },
              responsePayload: {
                note: `Payment request sent to ${args.email}`,
              },
            } as unknown as Prisma.PaymentUncheckedCreateInput,
          });
        });
      },
      async enqueuePolicyListUpdate(targetPolicyId: string) {
        await enqueuePolicyListIndexUpdate(prisma, targetPolicyId);
      },
    },
    notifications: { sendPaymentRequestEmail },
    factory: {
      createToken() {
        return randomUUID();
      },
      createPublicSessionToken() {
        return newPublicSessionToken();
      },
      now() {
        return new Date();
      },
      defaultTtlHours() {
        return Number(process.env.PAYMENT_LINK_TTL_HOURS || 24);
      },
    },
    audit: { logAuditEvent },
  };
}

export function buildBillingSummaryDeps() {
  return {
    repo: {
      findPolicy(targetPolicyId: string) {
        return tenantScopedPrisma.policy.findUnique({
          where: { id: targetPolicyId },
          select: { id: true, status: true, policyNumber: true },
        });
      },
      listBoundRiskTransactions(targetPolicyId: string) {
        return tenantScopedPrisma.riskTransaction.findMany({
          where: {
            policyId: targetPolicyId,
            status: 'BOUND',
            transactionType: { in: [...VERSION_HISTORY_TRANSACTION_TYPES] },
          },
          orderBy: { transactionNumber: 'asc' },
          include: { premiumTransactions: true },
        });
      },
      listPayments(args: { policyId: string; policyAccountMode: boolean; selectedRiskTxnId: string | null; selectedTxTypeUp: string }) {
        const where: Prisma.PaymentWhereInput = { policyId: args.policyId };
        if (!args.policyAccountMode && args.selectedRiskTxnId) {
          if (POLICY_CHANGE_TRANSACTION_TYPES.includes(args.selectedTxTypeUp as (typeof POLICY_CHANGE_TRANSACTION_TYPES)[number])) {
            where.riskTransactionId = args.selectedRiskTxnId;
          } else {
            where.OR = [{ riskTransactionId: args.selectedRiskTxnId }, { riskTransactionId: null }];
          }
        }
        return tenantScopedPrisma.payment.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          include: { events: { orderBy: { receivedAt: 'desc' } } },
          take: 200,
        });
      },
      async markStaleBoPendingPaymentsCancelled(paymentIds: string[]) {
        if (paymentIds.length === 0) return;
        await tenantScopedPrisma.payment.updateMany({
          where: { id: { in: paymentIds } },
          data: { status: 'CANCELLED' },
        });
      },
      listReconciliationLines(targetPolicyId: string) {
        return tenantScopedPrisma.reconciliation.findMany({
          where: { policyId: targetPolicyId },
          orderBy: { paymentDate: 'desc' },
          take: 100,
        });
      },
      async enqueuePolicyListUpdate(targetPolicyId: string) {
        await enqueuePolicyListIndexUpdate(prisma, targetPolicyId);
      },
    },
  };
}

export function buildCreateCheckoutDeps() {
  return {
    config: { getCardcorpConfig },
    repo: {
      async findPolicy(id: string) {
        return tenantScopedPrisma.policy.findUnique({
          where: { id },
          select: { id: true, policyNumber: true },
        });
      },
      async createPaymentAttempt(args: {
        policyId: string;
        riskTransactionId: string | null;
        entityId: string;
        checkoutId: string;
        integrity?: string;
        merchantTransactionId: string;
        amount: number;
        currency: string;
        raw: unknown;
      }) {
        return tenantScopedPrisma.payment.create({
          data: {
            policyId: args.policyId,
            riskTransactionId: args.riskTransactionId,
            provider: 'CARDCORP',
            purpose: 'BO_CHARGE',
            initiatedBy: 'BO',
            entityId: args.entityId,
            checkoutId: args.checkoutId,
            integrity: args.integrity,
            merchantTransactionId: args.merchantTransactionId,
            amount: args.amount,
            currency: args.currency,
            paymentType: 'DB',
            status: 'PENDING',
            requestPayload: {
              policyId: args.policyId,
              riskTransactionId: args.riskTransactionId,
              amount: args.amount,
              currency: args.currency,
              kind: 'BO_CHARGE',
            },
            raw: toInputJson(args.raw),
          } as unknown as Prisma.PaymentUncheckedCreateInput,
          select: { id: true },
        });
      },
      async enqueuePolicyListUpdate(targetPolicyId: string) {
        await enqueuePolicyListIndexUpdate(prisma, targetPolicyId);
      },
    },
    gateway: {
      createCheckout(args: {
        entityId: string;
        bearerToken: string;
        baseUrl: string;
        amount: string;
        currency: string;
        paymentType: 'DB';
        merchantTransactionId: string;
        testMode?: 'EXTERNAL' | 'INTERNAL';
        shopperResultUrl: string;
        customParameters: Record<string, string>;
      }) {
        return cardcorpCreateCheckout(args);
      },
    },
    audit: { logAuditEvent },
  };
}

export function buildAbandonCheckoutDeps() {
  return {
    repo: {
      findPaymentAttempt(args: { policyId: string; paymentId: string; checkoutId: string }) {
        return tenantScopedPrisma.payment.findFirst({
          where: {
            policyId: args.policyId,
            provider: 'CARDCORP',
            initiatedBy: 'BO',
            ...(args.paymentId ? { id: args.paymentId } : {}),
            ...(args.checkoutId ? { checkoutId: args.checkoutId } : {}),
          },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            status: true,
            paymentId: true,
            checkoutId: true,
            responsePayload: true,
            raw: true,
          },
        });
      },
      cancelPaymentAttempt(args: { paymentId: string; responsePayload: unknown; raw: unknown }) {
        return tenantScopedPrisma.payment.update({
          where: { id: args.paymentId },
          data: {
            status: 'CANCELLED',
            responsePayload: toInputJson(args.responsePayload),
            raw: toInputJson(args.raw),
          },
          select: { id: true, status: true },
        });
      },
      async createCancelEvent(targetPaymentId: string) {
        await prisma.paymentEvent.create({
          data: {
            paymentId: targetPaymentId,
            eventType: 'CANCELLED',
            verified: true,
            payload: { abandoned: true },
          },
        }).catch(() => undefined);
      },
      async enqueuePolicyListUpdate(targetPolicyId: string) {
        await enqueuePolicyListIndexUpdate(prisma, targetPolicyId);
      },
    },
    audit: { logAuditEvent },
    nowIso() {
      return new Date().toISOString();
    },
  };
}

export function buildVerifyStatusDeps() {
  return {
    config: { getCardcorpConfig },
    gateway: {
      getPaymentStatus(args: { baseUrl: string; entityId: string; bearerToken: string; checkoutId: string }) {
        return cardcorpGetPaymentStatus(args);
      },
      getPaymentStatusByResourcePath(args: { baseUrl: string; entityId: string; bearerToken: string; resourcePath: string }) {
        return cardcorpGetPaymentStatusByResourcePath(args);
      },
    },
    repo: {
      findPaymentAttempt(args: { policyId: string; checkoutId: string }) {
        return tenantScopedPrisma.payment.findFirst({
          where: {
            policyId: args.policyId,
            checkoutId: args.checkoutId || undefined,
            provider: 'CARDCORP',
          },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            status: true,
            paymentId: true,
            raw: true,
          },
        });
      },
      async updatePaymentDiagnostics(args: { paymentId: string; errorMessage: string; previousRaw: unknown }) {
        await tenantScopedPrisma.payment.update({
          where: { id: args.paymentId },
          data: {
            responsePayload: { error: args.errorMessage, code: 'UPSTREAM_ERROR' },
            raw: { ...parseRecord(args.previousRaw), error: args.errorMessage, code: 'UPSTREAM_ERROR' },
          },
        }).catch(() => undefined);
      },
      markPaymentFailed(paymentId: string) {
        return tenantScopedPrisma.payment.update({
          where: { id: paymentId },
          data: { status: 'FAILED' },
          select: { status: true },
        }).catch(() => null);
      },
      findLatestPaidPayment(targetPolicyId: string) {
        return tenantScopedPrisma.payment.findFirst({
          where: { policyId: targetPolicyId, provider: 'CARDCORP', status: 'PAID' },
          orderBy: { createdAt: 'desc' },
          select: { status: true, raw: true },
        });
      },
      updatePaymentFromGateway(args: { paymentId: string; nextStatus: 'PAID' | 'FAILED'; providerPaymentId: string | null; raw: unknown }) {
        return tenantScopedPrisma.payment.update({
          where: { id: args.paymentId },
          data: {
            status: args.nextStatus,
            paymentId: args.providerPaymentId,
            responsePayload: toInputJson(args.raw),
            raw: toInputJson(args.raw),
          },
          select: { status: true },
        });
      },
      async createPaymentEvent(args: { paymentId: string; eventType: 'CAPTURE' | 'FAIL'; providerEventId: string | null; verified: boolean; payload: unknown }) {
        await prisma.paymentEvent.create({
          data: {
            paymentId: args.paymentId,
            eventType: args.eventType,
            providerEventId: args.providerEventId,
            verified: args.verified,
            payload: toInputJson(args.payload),
          },
        }).catch(() => undefined);
      },
      async persistPendingGatewayRaw(args: { paymentId: string; raw: unknown }) {
        await tenantScopedPrisma.payment.update({
          where: { id: args.paymentId },
          data: { raw: toInputJson(args.raw), responsePayload: toInputJson(args.raw) },
        }).catch(() => undefined);
      },
      async enqueuePolicyListUpdate(targetPolicyId: string) {
        await enqueuePolicyListIndexUpdate(prisma, targetPolicyId);
      },
    },
    errorMessage,
  };
}

export function buildRefundDeps() {
  return {
    config: { getCardcorpConfig },
    repo: {
      async findReferencePayment(args: { policyId: string; referencePaymentId: string }) {
        const payment = await tenantScopedPrisma.payment.findFirst({
          where: { id: args.referencePaymentId, policyId: args.policyId },
          select: { id: true, amount: true, paymentId: true, merchantTransactionId: true },
        });
        if (!payment) return null;
        return {
          ...payment,
          amount: payment.amount === null ? null : Number(payment.amount),
        };
      },
      async sumPreviousRefunds(args: { policyId: string; referencePaymentId: string }) {
        const rows = await tenantScopedPrisma.payment.findMany({
          where: {
            policyId: args.policyId,
            purpose: 'REFUND',
            requestPayload: {
              path: ['referencePaymentId'],
              equals: args.referencePaymentId,
            },
          },
          select: { amount: true },
        });
        return rows.reduce((acc, row) => acc + Number(row.amount || 0), 0);
      },
      async getPolicySnapshotForRefund(args: { policyId: string }) {
        const policy = await tenantScopedPrisma.policy.findUnique({
          where: { id: args.policyId },
          select: { productType: true, stateCurrent: { select: { snapshot: true } } },
        });
        if (!policy) return null;
        return {
          productType: String(policy.productType || ''),
          snapshot: parseSnapshotValue(policy.stateCurrent?.snapshot),
        };
      },
      async createRefundPayment(args: {
        policyId: string;
        riskTransactionId: string | null;
        entityId: string;
        amount: number;
        currency: string;
        paymentId: string | null;
        merchantTransactionId: string;
        referencePaymentId: string;
        referenceProviderPaymentId: string;
        raw: unknown;
      }) {
        return tenantScopedPrisma.payment.create({
          data: {
            policyId: args.policyId,
            riskTransactionId: args.riskTransactionId,
            provider: 'CARDCORP',
            purpose: 'REFUND',
            initiatedBy: 'BO',
            entityId: args.entityId,
            amount: args.amount,
            currency: args.currency,
            paymentType: 'RF',
            status: 'CAPTURED',
            paymentId: args.paymentId,
            merchantTransactionId: args.merchantTransactionId,
            requestPayload: {
              referencePaymentId: args.referencePaymentId,
              referenceProviderPaymentId: args.referenceProviderPaymentId,
              amount: args.amount,
              currency: args.currency,
            },
            responsePayload: toInputJson(args.raw),
            raw: toInputJson(args.raw),
          } as unknown as Prisma.PaymentUncheckedCreateInput,
          select: { id: true },
        });
      },
      async createPaymentEvent(args: { paymentId: string; eventType: 'REFUND'; providerEventId: string | null; verified: boolean; payload: unknown }) {
        await prisma.paymentEvent.create({
          data: {
            paymentId: args.paymentId,
            eventType: args.eventType,
            providerEventId: args.providerEventId,
            verified: args.verified,
            payload: toInputJson(args.payload),
          },
        }).catch(() => undefined);
      },
      async enqueuePolicyListUpdate(targetPolicyId: string) {
        await enqueuePolicyListIndexUpdate(prisma, targetPolicyId);
      },
    },
    gateway: {
      refundPayment(args: {
        baseUrl: string;
        entityId: string;
        bearerToken: string;
        referencePaymentId: string;
        amount: string;
        currency: string;
        merchantTransactionId: string;
        testMode?: 'EXTERNAL' | 'INTERNAL';
      }) {
        return cardcorpRefundPayment(args);
      },
    },
    rules: {
      async getRoadsideRegistryFallbackPrice() {
        try {
          const { MagicBRegistry } = await import('../../mbe/domain/registry.js');
          // COV-ROADSIDE is a motor-specific coverage.
          const template = parseRecord(MagicBRegistry.motorOnly().get('COV-ROADSIDE'));
          return Number(parseRecord(template.default_params).price_eur || 0);
        } catch {
          return 0;
        }
      },
    },
    audit: { logAuditEvent },
  };
}

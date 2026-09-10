import type { Prisma } from '@prisma/client';
import { prisma, tenantScopedPrisma } from '../../../platform/db/connection.js';
import { transitionPaymentStatus } from '../../policy/app/commands/riskPaymentDocCommands.js';
import { enqueuePolicyListIndexUpdate } from '../../policy/infra/projections/policyListIndex.js';
import { updateBanditFromEvent } from '../../recommendations/app/bandit.js';
import { TenantResolutionError } from '../../../platform/tenant/tenantResolution.js';
import { logger } from '../../../platform/utils/logger.js';
import { runCardcorpPaidIssuance } from './cardcorpPolicyIssuanceService.js';

type PaymentLike = { id: string; paymentId: string | null };
type PolicyLike = { id: string; policyNumber?: string | null; productType?: string | null };
type StatusLike = {
  ok: boolean;
  code?: string;
  description?: string;
  paymentId?: string;
  amount?: string;
  currency?: string;
  raw: unknown;
};

export async function applyCardcorpVerifiedStatus(args: {
  policy: PolicyLike;
  payment: PaymentLike;
  status: StatusLike;
  checkoutId: string;
  correlationId?: string;
  baseUrl: string;
  parseRecord: (value: unknown) => Record<string, unknown>;
  jsonStringify: (value: unknown) => unknown;
  resolveInceptionDateFromRenewalDate: (renewalDateRaw: unknown) => Date;
  resolveTenantId: () => string;
}): Promise<{ updatedPayment: { id: string; status: string }; selectedBundleId: string | null }> {
  // ADR-0013 — welcome email is sent by the canonical
  // DOC.GENERATE_ISSUED_POLICY_PACK worker handler after docs are
  // generated. There is intentionally no inline / scheduled welcome
  // path here: the issuance transaction writes the outbox row that
  // ultimately triggers the email, so a single spine handles both
  // first delivery and any retry.
  const nextPaymentStatus = args.status.ok ? 'PAID' : 'FAILED';

  const updatedPayment = await tenantScopedPrisma.$transaction(async (_tx) => {
    const tx = _tx as unknown as Prisma.TransactionClient;
    await transitionPaymentStatus({
      tx,
      paymentId: args.payment.id,
      to: nextPaymentStatus as Parameters<typeof transitionPaymentStatus>[0]['to'],
      actorId: 'cardcorp',
      actorType: 'SYSTEM',
      reasonCode: 'PAYMENT_STATUS_SYNC',
      correlationId: args.correlationId,
    }).catch(() => undefined);
    return await tx.payment.update({
      where: { id: args.payment.id },
      data: {
        paymentId: args.status.paymentId || args.payment.paymentId,
        raw: args.status.raw as never,
        status: nextPaymentStatus,
      },
      select: { id: true, status: true },
    });
  });
  await enqueuePolicyListIndexUpdate(prisma, args.policy.id);

  await tenantScopedPrisma.policy.update({
    where: { id: args.policy.id },
    data: {
      paymentStatus: args.status.ok ? 'PAID' : 'FAILED',
      isLocked: args.status.ok ? true : false,
    },
  });

  let selectedBundleId: string | null = null;
  if (args.status.ok) {
    const issuance = await runCardcorpPaidIssuance({
      policy: args.policy,
      updatedPayment: { id: updatedPayment.id },
      status: {
        paymentId: args.status.paymentId,
        amount: args.status.amount,
        currency: args.status.currency,
      },
      checkoutId: args.checkoutId,
      correlationId: args.correlationId,
      baseUrl: args.baseUrl,
      parseRecord: args.parseRecord,
      jsonStringify: args.jsonStringify,
      resolveInceptionDateFromRenewalDate: args.resolveInceptionDateFromRenewalDate,
    });
    selectedBundleId = issuance.selectedBundleId;

    try {
      const already = await prisma.paymentEvent.findFirst({
        where: { paymentId: updatedPayment.id, eventType: 'RECO_PURCHASE_LOGGED' },
        select: { id: true },
      });
      if (!already) {
        const tenantId = args.resolveTenantId();
        if (
          'recoEvent' in prisma &&
          typeof (prisma as { recoEvent?: { create: (a: object) => Promise<unknown> } }).recoEvent?.create === 'function'
        ) {
          await (prisma as { recoEvent: { create: (a: object) => Promise<unknown> } }).recoEvent.create({
            data: {
              tenantId,
              productType: String(args.policy?.productType || ''),
              policyId: args.policy.id,
              quoteRef: String(args.policy.policyNumber ?? ''),
              type: 'purchase',
              artifactVersion: undefined,
              modelKey: undefined,
              selectedBundleId: selectedBundleId ?? undefined,
              occurredAt: new Date(),
            },
          });
        }

        const rewardType = String(process.env.RECS_BANDIT_REWARD ?? 'purchase').toLowerCase() === 'select' ? 'select' : 'purchase';
        if (rewardType === 'purchase' && selectedBundleId) {
          await updateBanditFromEvent({
            tenantId,
            productType: String(args.policy?.productType || ''),
            rewardType: 'purchase',
            selectedBundleId: String(selectedBundleId),
          });
        }

        await prisma.paymentEvent.create({
          data: {
            paymentId: updatedPayment.id,
            eventType: 'RECO_PURCHASE_LOGGED',
            verified: true,
            payload: { selectedBundleId: selectedBundleId ?? null },
          },
        });
      }
    } catch (recoErr) {
      if (recoErr instanceof TenantResolutionError) {
        logger.warn(
          { paymentId: updatedPayment.id, policyId: args.policy.id, reason: recoErr.message },
          'reco_event.tenant_resolution_skipped',
        );
      }
    }
  }

  return { updatedPayment, selectedBundleId };
}

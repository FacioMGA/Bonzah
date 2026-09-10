import { Job } from 'bullmq';
import { z } from 'zod';
import { prisma, tenantScopedPrisma } from '../../platform/db/connection.js';
import { logger } from '../../platform/utils/logger.js';
import { dispatchCustomerEmailTrigger } from '../../modules/communications/app/customerEmailTriggerService.js';
import { resolvePublicAppBaseUrlFromTenant } from '../../platform/http/publicAppLinks.js';
import { runWithOperatingTenantById } from '../../platform/tenant/tenantJobContext.js';
import { registerHandler, JobHandler } from '../index.js';

const DataSchema = z.object({
  operatingTenantId: z.string().uuid('RENEWAL.EMAIL_SCAN missing operatingTenantId'),
  scheduledAt: z.string().datetime().optional(),
});

const EnvelopeSchema = z.object({
  eventId: z.string().min(1),
  data: DataSchema,
});

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function daysBetween(now: Date, date: Date): number {
  const ms = date.getTime() - now.getTime();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

// Renewal cadence config. Window thresholds used to be hardcoded narrow
// 4-day buckets, which meant a single missed scan
// (worker pause, deployment window, restart) could silently drop the
// invite or chaser for a renewing customer. The buckets are now
// open-ended on the lower side: once we cross the threshold we send
// once and `RenewalEmailState.{invite,chaser}SentAt` keeps the worker
// idempotent.
const RENEWAL_INVITE_DAYS_BEFORE_EXPIRY = 28;
const RENEWAL_CHASER_DAYS_BEFORE_EXPIRY = 7;
const RENEWAL_INVITE_TO_CHASER_MIN_GAP_DAYS = 7;
const RENEWAL_HOME_UPLIFT_SKELETON = {
  enabled: false,
  valuePct: 3,
};
const RENEWAL_LOOKAHEAD_DAYS =
  Math.max(RENEWAL_INVITE_DAYS_BEFORE_EXPIRY, RENEWAL_CHASER_DAYS_BEFORE_EXPIRY) + 5;
const RENEWAL_SCAN_PAGE_SIZE = 1000;

async function deliveredInvitationAt(input: {
  policyId: string;
  policyNumber: string;
  renewalDate: string;
  email: string;
  now: Date;
}): Promise<Date | null> {
  // Communication tables inherit their tenant boundary through the policy thread.
  // Only use a policy id selected by tenantScopedPrisma in this scan.
  const invitation = await tenantScopedPrisma.communicationMessage.findFirst({
    where: {
      thread: { entityType: 'POLICY', entityId: input.policyId },
      direction: 'OUTBOUND',
      channel: 'EMAIL',
      communicationType: 'EXTERNAL',
      toRecipients: { equals: [input.email] },
      AND: [
        { externalRefs: { path: ['trigger'], equals: 'RENEWAL_INVITE' } },
        { externalRefs: { path: ['template', 'variables', 'policy', 'number'], equals: input.policyNumber } },
        { externalRefs: { path: ['template', 'variables', 'policy', 'renewalDate'], equals: input.renewalDate } },
      ],
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      status: true,
      provider: true,
      createdAt: true,
      deliveredAt: true,
      externalRefs: true,
      deliveryAttempts: {
        where: { channel: 'EMAIL' },
        orderBy: [{ attemptedAt: 'desc' }, { id: 'desc' }],
        take: 1,
        select: { status: true, provider: true, attemptedAt: true, resolvedAt: true },
      },
    },
  });
  // Do not filter the lookup to successful messages: a newer failed invitation
  // or delivery attempt must block a chaser even if an older one was delivered.
  if (!invitation || invitation.status !== 'DELIVERED' || !invitation.deliveredAt) return null;
  const synthetic = asRecord(invitation.externalRefs).synthetic;
  if (synthetic !== undefined && synthetic !== false) return null;
  const attempt = invitation.deliveryAttempts[0];
  if (!attempt || attempt.status !== 'DELIVERED' || !attempt.resolvedAt
    || attempt.provider !== invitation.provider) return null;
  // A delayed provider event for an older attempt cannot prove delivery of a
  // newer retry, even if the webhook has updated the latest attempt's status.
  // Provider event timestamps have second precision; database timestamps retain
  // milliseconds. Accept that truncation, then use the later attempt timestamp
  // below so it cannot shorten the seven-day wait.
  const earliestDeliveryTime = Math.floor(attempt.attemptedAt.getTime() / 1000) * 1000;
  if (attempt.attemptedAt < invitation.createdAt
    || invitation.deliveredAt.getTime() < earliestDeliveryTime
    || attempt.resolvedAt.getTime() < earliestDeliveryTime) return null;

  const deliveredAt = new Date(Math.max(
    invitation.deliveredAt.getTime(), attempt.resolvedAt.getTime(), attempt.attemptedAt.getTime(),
  ));
  if (!Number.isFinite(deliveredAt.getTime()) || deliveredAt > input.now) return null;
  return deliveredAt;
}

function envFlag(value: string | undefined): boolean {
  return ['true', '1', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

export type RenewalEmailScanSummary = {
  scanned: number;
  invitesEligible: number;
  chasersEligible: number;
  chasersDeferred: number;
  invitesSent: number;
  chasersSent: number;
  skippedNoEmail: number;
  dispatchEnabled: boolean;
};

// The `asRecord(policy.quoteData)` laundering below is a separate concern
// (Prisma JSON column typing) tracked by ADR-0029.
export async function scanRenewalEmailsForCurrentTenant(options: {
  now?: Date;
  dispatchEnabled?: boolean;
} = {}): Promise<RenewalEmailScanSummary> {
  const now = options.now ?? new Date();
  const dispatchEnabled = options.dispatchEnabled
    ?? envFlag(process.env.RENEWAL_EMAIL_DISPATCH_ENABLED);
  let scanned = 0;
  let invitesSent = 0;
  let chasersSent = 0;
  let invitesEligible = 0;
  let chasersEligible = 0;
  let chasersDeferred = 0;
  let skippedNoEmail = 0;

  let afterPolicyId: string | undefined;
  while (true) {
    const policies = await tenantScopedPrisma.policy.findMany({
      where: {
        status: { in: ['ISSUED', 'ACTIVE'] },
        expiryDate: {
          gte: now,
          lte: new Date(now.getTime() + RENEWAL_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000),
        },
        ...(afterPolicyId ? { id: { gt: afterPolicyId } } : {}),
      },
      select: {
        id: true,
        policyNumber: true,
        productType: true,
        expiryDate: true,
        quoteData: true,
        renewalEmailState: true,
      },
      orderBy: { id: 'asc' },
      take: RENEWAL_SCAN_PAGE_SIZE,
    });
    scanned += policies.length;

    for (const policy of policies) {
      const qd = asRecord(policy.quoteData);
      const proposer = asRecord(qd.proposer);
      const email = String(proposer.email || '').trim().toLowerCase();
      const firstName = String(proposer.firstName || '').trim() || 'there';
      // The BDX importer stamps @import.local identities when no real contact is supplied
      // (importPlaceholderEmail); account materialization uses this same suffix rule.
      const isPlaceholderImportEmail = email.endsWith('@import.local');
      if (!email || isPlaceholderImportEmail) {
        // ABY-85: log the skip so operators can spot policies that would
        // otherwise silently never receive a renewal reminder. Without
        // this, a missing `quoteData.proposer.email` produced *no* signal
        // whatsoever and the issue was only visible by inspecting the DB
        // row by row.
        skippedNoEmail += 1;
        logger.warn({
          event: 'renewal.email_scan.skip_missing_email',
          reason: isPlaceholderImportEmail ? 'IMPORTED_PLACEHOLDER_EMAIL' : 'MISSING_EMAIL',
          policyId: policy.id,
          policyNumber: policy.policyNumber,
          productType: policy.productType,
        }, 'renewal.email_scan.skip_missing_email');
        continue;
      }

      const dueInDays = daysBetween(now, new Date(policy.expiryDate));
      // Tenant-aware: resolves to the operating tenant's `publicBaseUrl`
      // (set by the worker entry-point's `runWith*OperatingTenant` scope),
      // falling back to env vars in single-tenant deploys.
      const renewalUrl = `${resolvePublicAppBaseUrlFromTenant()}/policies/${policy.id}/renewal`;
      const state = policy.renewalEmailState;
      const renewalDateIso = policy.expiryDate.toISOString().slice(0, 10);

      if (dueInDays <= RENEWAL_INVITE_DAYS_BEFORE_EXPIRY && dueInDays >= 1 && !state?.inviteSentAt) {
        invitesEligible += 1;
        if (dispatchEnabled) {
          const inviteResult = await dispatchCustomerEmailTrigger({
            trigger: 'RENEWAL_INVITE',
            entityType: 'POLICY',
            entityId: policy.id,
            toEmail: email,
            variables: {
              customer: { firstName },
              policy: { number: policy.policyNumber, renewalDate: renewalDateIso },
              renewal: { url: renewalUrl, homeUplift: RENEWAL_HOME_UPLIFT_SKELETON },
            },
            productCode: policy.productType ?? undefined,
            idempotencySeed: `renewal-invite:${policy.policyNumber}:${renewalDateIso}`,
          });
          if (!inviteResult.skipped) {
            invitesSent += 1;
            await prisma.renewalEmailState.upsert({
              where: { policyId: policy.id },
              update: {
                inviteSentAt: new Date(),
                inviteAttemptCount: { increment: 1 },
                lastError: null,
              },
              create: {
                policyId: policy.id,
                inviteSentAt: new Date(),
                inviteAttemptCount: 1,
              },
            });
          }
        }
      }

      if (dueInDays <= RENEWAL_CHASER_DAYS_BEFORE_EXPIRY && dueInDays >= 1 && !state?.chaserSentAt) {
        const inviteSentAt = state?.inviteSentAt ? new Date(state.inviteSentAt) : null;
        const chaserAllowedAt = inviteSentAt
          ? new Date(inviteSentAt.getTime() + RENEWAL_INVITE_TO_CHASER_MIN_GAP_DAYS * 24 * 60 * 60 * 1000)
          : null;
        if (!chaserAllowedAt || chaserAllowedAt > now) {
          chasersDeferred += 1;
          continue;
        }
        // inviteSentAt records queue acceptance. Confirm delivery of the same
        // policy term to the current recipient before treating it as an invitation.
        const deliveredAt = await deliveredInvitationAt({
          policyId: policy.id,
          policyNumber: policy.policyNumber,
          renewalDate: renewalDateIso,
          email,
          now,
        });
        if (!deliveredAt
          || deliveredAt.getTime() + RENEWAL_INVITE_TO_CHASER_MIN_GAP_DAYS * 24 * 60 * 60 * 1000 > now.getTime()) {
          chasersDeferred += 1;
          continue;
        }
        chasersEligible += 1;
        if (dispatchEnabled) {
          const chaserResult = await dispatchCustomerEmailTrigger({
            trigger: 'RENEWAL_CHASER',
            entityType: 'POLICY',
            entityId: policy.id,
            toEmail: email,
            variables: {
              customer: { firstName },
              policy: { number: policy.policyNumber, renewalDate: renewalDateIso },
              renewal: { url: renewalUrl, homeUplift: RENEWAL_HOME_UPLIFT_SKELETON },
            },
            productCode: policy.productType ?? undefined,
            idempotencySeed: `renewal-chaser:${policy.policyNumber}:${renewalDateIso}`,
          });
          if (!chaserResult.skipped) {
            chasersSent += 1;
            await prisma.renewalEmailState.upsert({
              where: { policyId: policy.id },
              update: {
                chaserSentAt: new Date(),
                chaserAttemptCount: { increment: 1 },
                lastError: null,
              },
              create: {
                policyId: policy.id,
                chaserSentAt: new Date(),
                chaserAttemptCount: 1,
              },
            });
          }
        }
      }
    }

    if (policies.length < RENEWAL_SCAN_PAGE_SIZE) break;
    afterPolicyId = policies[policies.length - 1].id;
  }

  logger.info({
    event: 'renewal.email_scan.completed',
    scanned,
    invitesEligible,
    chasersEligible,
    chasersDeferred,
    invitesSent,
    chasersSent,
    skippedNoEmail,
    dispatchEnabled,
    inviteThresholdDays: RENEWAL_INVITE_DAYS_BEFORE_EXPIRY,
    chaserThresholdDays: RENEWAL_CHASER_DAYS_BEFORE_EXPIRY,
    inviteToChaserMinGapDays: RENEWAL_INVITE_TO_CHASER_MIN_GAP_DAYS,
  }, 'renewal.email_scan.completed');

  return {
    scanned,
    invitesEligible,
    chasersEligible,
    chasersDeferred,
    invitesSent,
    chasersSent,
    skippedNoEmail,
    dispatchEnabled,
  };
}

export async function runRenewalEmailScan(jobData: unknown): Promise<RenewalEmailScanSummary> {
  const envelope = EnvelopeSchema.parse(jobData);
  return runWithOperatingTenantById(envelope.data.operatingTenantId, () =>
    scanRenewalEmailsForCurrentTenant());
}

export const handleRenewalEmailScan: JobHandler = async (job: Job) =>
  runRenewalEmailScan(job.data);

registerHandler('RENEWAL.EMAIL_SCAN', handleRenewalEmailScan);

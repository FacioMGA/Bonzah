import { Job } from 'bullmq';
import { prisma, tenantScopedPrisma } from '../../platform/db/connection.js';
import { logger } from '../../platform/utils/logger.js';
import { dispatchCustomerEmailTrigger } from '../../modules/communications/app/customerEmailTriggerService.js';
import { resolvePublicAppBaseUrlFromTenant } from '../../platform/http/publicAppLinks.js';
import { registerHandler, JobHandler } from '../index.js';

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
const RENEWAL_INVITE_DAYS_BEFORE_EXPIRY = 21;
const RENEWAL_CHASER_DAYS_BEFORE_EXPIRY = 9;
const RENEWAL_HOME_UPLIFT_SKELETON = {
  enabled: false,
  valuePct: 3,
};
const RENEWAL_LOOKAHEAD_DAYS =
  Math.max(RENEWAL_INVITE_DAYS_BEFORE_EXPIRY, RENEWAL_CHASER_DAYS_BEFORE_EXPIRY) + 5;

// `job.data` is unused — the scan reads policies from the DB directly.
// Typing the arg as `Job<unknown>` keeps this handler from contributing
// to the resolved-any baseline. The `asRecord(policy.quoteData)`
// laundering below is a separate concern (Prisma JSON column typing)
// and is tracked as a follow-up for ADR-0029 + the upcoming
// quote-data canonicalization work.
export const handleRenewalEmailScan: JobHandler = async (_job: Job<unknown>) => {
  const now = new Date();
  const policies = await tenantScopedPrisma.policy.findMany({
    where: {
      status: { in: ['ISSUED', 'ACTIVE'] },
      expiryDate: {
        gte: now,
        lte: new Date(now.getTime() + RENEWAL_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000),
      },
    },
    select: {
      id: true,
      policyNumber: true,
      productType: true,
      expiryDate: true,
      quoteData: true,
      renewalEmailState: true,
    },
    take: 1000,
  });

  let invitesSent = 0;
  let chasersSent = 0;
  let skippedNoEmail = 0;

  for (const policy of policies) {
    const qd = asRecord(policy.quoteData);
    const proposer = asRecord(qd.proposer);
    const email = String(proposer.email || '').trim().toLowerCase();
    const firstName = String(proposer.firstName || '').trim() || 'there';
    if (!email) {
      // ABY-85: log the skip so operators can spot policies that would
      // otherwise silently never receive a renewal reminder. Without
      // this, a missing `quoteData.proposer.email` produced *no* signal
      // whatsoever and the issue was only visible by inspecting the DB
      // row by row.
      skippedNoEmail += 1;
      logger.warn({
        event: 'renewal.email_scan.skip_missing_email',
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

    if (dueInDays <= RENEWAL_CHASER_DAYS_BEFORE_EXPIRY && dueInDays >= 1 && !state?.chaserSentAt) {
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

  logger.info({
    event: 'renewal.email_scan.completed',
    scanned: policies.length,
    invitesSent,
    chasersSent,
    skippedNoEmail,
    inviteThresholdDays: RENEWAL_INVITE_DAYS_BEFORE_EXPIRY,
    chaserThresholdDays: RENEWAL_CHASER_DAYS_BEFORE_EXPIRY,
  }, 'renewal.email_scan.completed');
};

registerHandler('RENEWAL.EMAIL_SCAN', handleRenewalEmailScan);

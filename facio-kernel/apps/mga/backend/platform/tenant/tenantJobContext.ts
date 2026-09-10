import type { Prisma } from '@prisma/client';
import { prisma } from '../db/connection.js';
import { runWithOperatingTenant, getOperatingTenantConfig } from './tenantAls.js';
import type { TenantConfig } from './tenantConfig.js';

import { tenantRowToConfig } from './tenantConfigProjection.js';

async function workerRecordRead<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  if (process.env.KERNEL_PLATFORM_MODE !== 'true') return work(prisma);
  const tenant = getOperatingTenantConfig();
  if (!tenant) throw new Error('A durable worker tenant envelope is required');
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('app.operating_tenant_id', ${tenant.id}, true)`;
    return work(tx);
  });
}

async function loadTenantById(operatingTenantId: string): Promise<TenantConfig> {
  const row = await prisma.tenant.findUnique({ where: { id: operatingTenantId }, include: { parentOrganization: { select: { active: true } } } });
  if (!row || row.status !== 'ACTIVE' || (process.env.KERNEL_PLATFORM_MODE === 'true' && !row.parentOrganization?.active)) throw new Error(`Operating tenant not found or inactive: ${operatingTenantId}`);
  const current = getOperatingTenantConfig();
  if (process.env.KERNEL_PLATFORM_MODE === 'true' && current && current.id !== row.id) throw new Error('Worker cannot switch operating tenant');
  return tenantRowToConfig(row);
}

export async function loadTenantBySlug(tenantSlug: string): Promise<TenantConfig | null> {
  const row = await prisma.tenant.findUnique({ // guard:cross-tenant-intentional - DevOps job creation restores tenant context from explicit tenant slug.
    where: { tenantSlug }, include: { parentOrganization: { select: { active: true } } },
  });
  if (process.env.KERNEL_PLATFORM_MODE === 'true' && (!row || row.status !== 'ACTIVE' || !row.parentOrganization?.active)) return null;
  return row ? tenantRowToConfig(row) : null;
}

/**
 * ADR-0044 — restore operating-tenant context from an explicit tenant id
 * carried on a worker envelope (e.g. `COMM.EMAIL_INGESTED`). Used when the
 * job is not yet anchored to a single durable business object (an
 * unresolved ingested email still needs a tenant to log against).
 */
export async function runWithOperatingTenantById<T>(
  operatingTenantId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const tenant = await loadTenantById(operatingTenantId);
  return runWithOperatingTenant(tenant, fn);
}

/**
 * Thrown by `runWithPolicyOperatingTenant` when the durable Policy row has no
 * `operatingTenantId` (or the policy no longer exists). This is a PERMANENT
 * condition: the fail-closed tenant extension (ADR-0019) cannot resolve a
 * tenant, and no amount of retrying will change that. Worker handlers detect
 * this typed error to dead-letter the job on the first attempt instead of
 * exhausting retries + firing an exhaustion alert on a data defect
 * (see `POLICY.INDEX_UPDATE.ts`, ABBEYGATE-W). The message is kept identical
 * to the previous plain Error so existing Sentry grouping is preserved.
 */
export class PolicyTenantContextMissingError extends Error {
  readonly policyId: string;
  constructor(policyId: string) {
    super(`Policy tenant context not found: ${policyId}`);
    this.name = 'PolicyTenantContextMissingError';
    this.policyId = policyId;
  }
}

export async function runWithPolicyOperatingTenant<T>(
  policyId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const policy = await workerRecordRead(tx => tx.policy.findUnique({ // guard:cross-tenant-intentional - restore worker tenant context from durable policy id.
    where: { id: policyId },
    select: { operatingTenantId: true },
  }));
  if (!policy?.operatingTenantId) throw new PolicyTenantContextMissingError(policyId);
  const tenant = await loadTenantById(policy.operatingTenantId);
  return runWithOperatingTenant(tenant, fn);
}

export async function runWithBinderOperatingTenant<T>(
  binderId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const binder = await workerRecordRead(tx => tx.binder.findUnique({ // guard:cross-tenant-intentional - restore worker tenant context from durable binder id.
    where: { id: binderId },
    select: { operatingTenantId: true },
  }));
  if (!binder?.operatingTenantId) throw new Error(`Binder tenant context not found: ${binderId}`);
  const tenant = await loadTenantById(binder.operatingTenantId);
  return runWithOperatingTenant(tenant, fn);
}

/**
 * Thrown by `runWithAccountOperatingTenant` when neither the durable
 * PolicyHolder row nor any remaining account projection carries an
 * `operatingTenantId`. Permanent: the fail-closed tenant extension
 * (ADR-0019) cannot resolve a tenant, and retrying will not create one.
 * Workers dead-letter on this typed error (ABY-408) instead of burning
 * retries + firing exhaustion alerts. Message kept identical to the
 * previous plain Error so existing Sentry grouping is preserved.
 */
export class AccountTenantContextMissingError extends Error {
  readonly accountId: string;
  constructor(accountId: string) {
    super(`Account tenant context not found: ${accountId}`);
    this.name = 'AccountTenantContextMissingError';
    this.accountId = accountId;
  }
}

/**
 * Resolve `operatingTenantId` for an Accounts360 / AccountIntelligence
 * `accountId` (= `PolicyHolder.id` per accounts-intelligence-api.md).
 *
 * Primary source: the durable PolicyHolder row.
 * Cleanup source: when the holder has already been deleted (e.g.
 * `DELETE /api/accounts/:id` enqueues `ACCOUNTS360.PROJECTION_UPDATE` so
 * `rebuildAccount360Projection` can purge orphan projection rows —
 * see the `if (!holder)` branch there), restore tenant from those
 * projection rows themselves. That is not a soft default: the
 * projections carry the immutable tenant FK of the rows the rebuild
 * is about to delete under `tenantScopedPrisma`.
 */
async function loadOperatingTenantIdForAccount(accountId: string): Promise<string | null> {
  const holder = await workerRecordRead(tx => tx.policyHolder.findUnique({ // guard:cross-tenant-intentional - restore worker tenant context from durable account/policyHolder id.
    where: { id: accountId },
    select: { operatingTenantId: true },
  }));
  if (holder?.operatingTenantId) return holder.operatingTenantId;

  const summary = await workerRecordRead(tx => tx.accountSummaryProjection.findUnique({ // guard:cross-tenant-intentional - restore worker tenant context from leftover account projection after holder delete.
    where: { accountId },
    select: { operatingTenantId: true },
  }));
  if (summary?.operatingTenantId) return summary.operatingTenantId;

  const intelligence = await workerRecordRead(tx => tx.accountIntelligenceProjection.findUnique({ // guard:cross-tenant-intentional - restore worker tenant context from leftover account intelligence projection after holder delete.
    where: { accountId },
    select: { operatingTenantId: true },
  }));
  if (intelligence?.operatingTenantId) return intelligence.operatingTenantId;

  const portfolio = await workerRecordRead(tx => tx.accountPortfolioMetrics.findUnique({ // guard:cross-tenant-intentional - restore worker tenant context from leftover portfolio metrics after holder delete.
    where: { accountId },
    select: { operatingTenantId: true },
  }));
  if (portfolio?.operatingTenantId) return portfolio.operatingTenantId;

  const alert = await workerRecordRead(tx => tx.accountAlertsProjection.findFirst({ // guard:cross-tenant-intentional - restore worker tenant context from leftover account alert after holder delete.
    where: { accountId },
    select: { operatingTenantId: true },
  }));
  if (alert?.operatingTenantId) return alert.operatingTenantId;

  const activity = await workerRecordRead(tx => tx.accountActivityFeed.findFirst({ // guard:cross-tenant-intentional - restore worker tenant context from leftover account activity after holder delete.
    where: { accountId },
    select: { operatingTenantId: true },
  }));
  if (activity?.operatingTenantId) return activity.operatingTenantId;

  return null;
}

/**
 * ABY-281 / ABY-408 — restore operating-tenant context for the
 * `ACCOUNTS360.PROJECTION_UPDATE` and
 * `ACCOUNT_INTELLIGENCE.PROJECTION_UPDATE` workers when rebuilding the
 * tenant-scoped account projections (`AccountSummaryProjection`,
 * `AccountAlertsProjection`, etc.).
 *
 * Mirrors `runWithPolicyOperatingTenant`: the durable account (or its
 * leftover projection rows after delete) is queried via the bare
 * `prisma` client (cross-tenant-intentional — we are RESTORING the
 * context, not running inside one yet), and the supplied function
 * executes inside `runWithOperatingTenant` so every
 * `tenantScopedPrisma` query inside `fn` passes the fail-closed
 * tenant extension (ADR-0019).
 */
export async function runWithAccountOperatingTenant<T>(
  accountId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const operatingTenantId = await loadOperatingTenantIdForAccount(accountId);
  if (!operatingTenantId) throw new AccountTenantContextMissingError(accountId);
  const tenant = await loadTenantById(operatingTenantId);
  return runWithOperatingTenant(tenant, fn);
}

/**
 * ADR-0041 — restore operating-tenant context for the
 * `CLAIM_MEMORY.REFRESH` worker.  Same pattern as the policy / binder /
 * account variants: the durable claim row is queried via the bare
 * `prisma` client (cross-tenant-intentional — we are RESTORING the
 * context, not running inside one yet), and the supplied function
 * executes inside `runWithOperatingTenant` so every `tenantScopedPrisma`
 * query inside `fn` passes the fail-closed tenant extension (ADR-0019).
 */
export async function runWithClaimOperatingTenant<T>(
  claimId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const claim = await workerRecordRead(tx => tx.claim.findUnique({ // guard:cross-tenant-intentional - restore worker tenant context from durable claim id.
    where: { id: claimId },
    select: { operatingTenantId: true },
  }));
  if (!claim?.operatingTenantId) throw new Error(`Claim tenant context not found: ${claimId}`);
  const tenant = await loadTenantById(claim.operatingTenantId);
  return runWithOperatingTenant(tenant, fn);
}

/**
 * ABY-77 — restore operating-tenant context for the COMM.OUTBOUND_QUEUED
 * worker when emitting `COMM.MESSAGE_SENT` / `COMM.MESSAGE_FAILED` audit
 * events into the tenant-scoped Outbox table.
 *
 * The communications schema (`CommunicationMessage` /
 * `CommunicationThread`) intentionally does not carry an
 * `operatingTenantId` column today — both are addressed via the entity
 * reference on the thread (POLICY/CLAIM/ACCOUNT/etc.). We resolve the
 * tenant via that entity so the audit-event outbox write satisfies the
 * fail-closed Prisma extension (`tenantExtension.ts`).
 *
 * Returns null when:
 *  - the entityType isn't one we can resolve a tenant from, OR
 *  - the entity row no longer exists.
 *
 * Callers should treat a null result as "skip the tenant-scoped write,
 * log a warning" rather than crashing the worker — audit failures must
 * never break the main delivery flow (see `commAuditEvents.ts`).
 */
export async function loadOperatingTenantForCommThread(args: {
  entityType: string | null | undefined;
  entityId: string | null | undefined;
}): Promise<TenantConfig | null> {
  const entityType = String(args.entityType || '').trim().toUpperCase();
  const entityId = String(args.entityId || '').trim();
  if (!entityType || !entityId) return null;
  let operatingTenantId: string | null = null;
  try {
    if (entityType === 'POLICY') {
      const row = await workerRecordRead(tx => tx.policy.findUnique({ // guard:cross-tenant-intentional - restore worker tenant context from durable policy id.
        where: { id: entityId },
        select: { operatingTenantId: true },
      }));
      operatingTenantId = row?.operatingTenantId ?? null;
    } else if (entityType === 'CLAIM') {
      const row = await workerRecordRead(tx => tx.claim.findUnique({ // guard:cross-tenant-intentional - restore worker tenant context from durable claim id.
        where: { id: entityId },
        select: { operatingTenantId: true },
      }));
      operatingTenantId = row?.operatingTenantId ?? null;
    } else if (entityType === 'ACCOUNT') {
      const row = await workerRecordRead(tx => tx.account.findUnique({ // guard:cross-tenant-intentional - read durable account inside the current worker envelope.
        where: { id: entityId },
        select: { operatingTenantId: true },
      }));
      operatingTenantId = row?.operatingTenantId ?? null;
    }
  } catch {
    return null;
  }
  if (!operatingTenantId) return null;
  try {
    return await loadTenantById(operatingTenantId);
  } catch {
    return null;
  }
}

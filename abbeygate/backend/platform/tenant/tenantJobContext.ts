import { prisma } from '../db/connection.js';
import { runWithOperatingTenant } from './tenantAls.js';
import type { TenantConfig } from './tenantConfig.js';

type TenantRow = {
  id: string;
  tenantSlug: string;
  countryCode: string;
  country: string;
  currency: string;
  iptJson: unknown;
  adminFee: unknown;
  legalPack: string;
  publicBaseUrl: string;
  fromEmail: string;
  brandLogos: unknown;
  defaultBrokerName: string | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function tenantRowToConfig(row: TenantRow): TenantConfig {
  const ipt = asRecord(row.iptJson);
  const logos = asRecord(row.brandLogos);
  return {
    id: row.id,
    tenantSlug: row.tenantSlug,
    countryCode: row.countryCode as TenantConfig['countryCode'],
    country: row.country,
    currency: row.currency,
    ipt: {
      rate: typeof ipt.rate === 'number' ? ipt.rate : undefined,
      flatFee: typeof ipt.flatFee === 'number' ? ipt.flatFee : undefined,
    },
    adminFee: Number(row.adminFee),
    legalPack: row.legalPack as TenantConfig['legalPack'],
    publicBaseUrl: row.publicBaseUrl,
    fromEmail: row.fromEmail,
    brandLogo: {
      white: typeof logos.white === 'string' ? logos.white : '',
      blue: typeof logos.blue === 'string' ? logos.blue : '',
    },
    defaultBrokerName: row.defaultBrokerName ?? undefined,
  };
}

async function loadTenantById(operatingTenantId: string): Promise<TenantConfig> {
  const row = await prisma.tenant.findUnique({ where: { id: operatingTenantId } });
  if (!row) throw new Error(`Operating tenant not found: ${operatingTenantId}`);
  return tenantRowToConfig(row);
}

export async function loadTenantBySlug(tenantSlug: string): Promise<TenantConfig | null> {
  const row = await prisma.tenant.findUnique({ // guard:cross-tenant-intentional - DevOps job creation restores tenant context from explicit tenant slug.
    where: { tenantSlug },
  });
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
  const policy = await prisma.policy.findUnique({ // guard:cross-tenant-intentional - restore worker tenant context from durable policy id.
    where: { id: policyId },
    select: { operatingTenantId: true },
  });
  if (!policy?.operatingTenantId) throw new PolicyTenantContextMissingError(policyId);
  const tenant = await loadTenantById(policy.operatingTenantId);
  return runWithOperatingTenant(tenant, fn);
}

export async function runWithBinderOperatingTenant<T>(
  binderId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const binder = await prisma.binder.findUnique({ // guard:cross-tenant-intentional - restore worker tenant context from durable binder id.
    where: { id: binderId },
    select: { operatingTenantId: true },
  });
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
  const holder = await prisma.policyHolder.findUnique({ // guard:cross-tenant-intentional - restore worker tenant context from durable account/policyHolder id.
    where: { id: accountId },
    select: { operatingTenantId: true },
  });
  if (holder?.operatingTenantId) return holder.operatingTenantId;

  const summary = await prisma.accountSummaryProjection.findUnique({ // guard:cross-tenant-intentional - restore worker tenant context from leftover account projection after holder delete.
    where: { accountId },
    select: { operatingTenantId: true },
  });
  if (summary?.operatingTenantId) return summary.operatingTenantId;

  const intelligence = await prisma.accountIntelligenceProjection.findUnique({ // guard:cross-tenant-intentional - restore worker tenant context from leftover account intelligence projection after holder delete.
    where: { accountId },
    select: { operatingTenantId: true },
  });
  if (intelligence?.operatingTenantId) return intelligence.operatingTenantId;

  const portfolio = await prisma.accountPortfolioMetrics.findUnique({ // guard:cross-tenant-intentional - restore worker tenant context from leftover portfolio metrics after holder delete.
    where: { accountId },
    select: { operatingTenantId: true },
  });
  if (portfolio?.operatingTenantId) return portfolio.operatingTenantId;

  const alert = await prisma.accountAlertsProjection.findFirst({ // guard:cross-tenant-intentional - restore worker tenant context from leftover account alert after holder delete.
    where: { accountId },
    select: { operatingTenantId: true },
  });
  if (alert?.operatingTenantId) return alert.operatingTenantId;

  const activity = await prisma.accountActivityFeed.findFirst({ // guard:cross-tenant-intentional - restore worker tenant context from leftover account activity after holder delete.
    where: { accountId },
    select: { operatingTenantId: true },
  });
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
  const claim = await prisma.claim.findUnique({ // guard:cross-tenant-intentional - restore worker tenant context from durable claim id.
    where: { id: claimId },
    select: { operatingTenantId: true },
  });
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
      const row = await prisma.policy.findUnique({ // guard:cross-tenant-intentional - restore worker tenant context from durable policy id.
        where: { id: entityId },
        select: { operatingTenantId: true },
      });
      operatingTenantId = row?.operatingTenantId ?? null;
    } else if (entityType === 'CLAIM') {
      const row = await prisma.claim.findUnique({ // guard:cross-tenant-intentional - restore worker tenant context from durable claim id.
        where: { id: entityId },
        select: { operatingTenantId: true },
      });
      operatingTenantId = row?.operatingTenantId ?? null;
    } else if (entityType === 'ACCOUNT') {
      const row = await prisma.account.findUnique({ // guard:cross-tenant-intentional - restore worker tenant context from durable account id.
        where: { id: entityId },
        select: { operatingTenantId: true },
      });
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

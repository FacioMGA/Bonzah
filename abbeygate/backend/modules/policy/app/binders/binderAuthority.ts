/**
 * Binder ↔ Product authorization guard.
 *
 * Central source of truth: a policy may only be bound to a (binder, product) pair
 * when a matching BinderProductAuthority row exists and is ACTIVE within its
 * effective window. This enforces Lloyd's-grade line-of-business authorization.
 *
 * Called by every code path that writes `policy.productType` + `policy.binderId`
 * together (program/binder assignment, any future direct bind, etc).
 *
 * **ADR-0019 (PR 1B): strict by default, no opt-out.** A missing
 * `BinderProductAuthority` row throws `BinderAuthorityError`. The legacy
 * strictness env-flag, the synthetic-result branch, and the legacy-COB
 * scalar fallback in `resolveBinderProductReporting` have all been
 * deleted — there is no code path that lets a bind / program assignment
 * / reporting query succeed without a real authority row. The deleted
 * identifiers are pinned by `tools/quality/deleted-identifiers.json`;
 * see ADR-0019 for the full rationale.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '../../../../platform/db/connection.js';
import { getTenantConfig } from '../../../../platform/tenant/tenantConfig.js';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export type BinderAuthorityFailureReason =
  | 'PRODUCT_NOT_AUTHORIZED_ON_BINDER'
  | 'PRODUCT_AUTHORITY_SUSPENDED'
  | 'PRODUCT_AUTHORITY_NOT_EFFECTIVE';

export class BinderAuthorityError extends Error {
  readonly code: 'PROGRAM_BINDER_NOT_ALLOWED' = 'PROGRAM_BINDER_NOT_ALLOWED';
  readonly reason: BinderAuthorityFailureReason;
  readonly binderId: string;
  readonly productCode: string;
  constructor(binderId: string, productCode: string, reason: BinderAuthorityFailureReason, message: string) {
    super(message);
    this.name = 'BinderAuthorityError';
    this.reason = reason;
    this.binderId = binderId;
    this.productCode = productCode;
  }
}

export interface BinderAuthorityResult {
  binderId: string;
  productCode: string;
  authorityId: string;
  classOfBusiness: string;
  riskCode: string | null;
  status: string;
}

/**
 * Raised when an issuance path tries to resolve a policy's Unique Market
 * Reference but the bound binder has no UMR. Issuance MUST fail loud rather
 * than fabricate a placeholder — a wrong UMR on a Lloyd's schedule is a
 * regulatory defect, not a cosmetic one.
 */
export class BinderUmrMissingError extends Error {
  readonly code = 'BINDER_UMR_MISSING' as const;
  readonly binderId: string;
  constructor(binderId: string) {
    super(
      `Binder ${binderId || '(none)'} has no Unique Market Reference (UMR). ` +
        'A policy\'s UMR is the binder\'s delegated-authority reference and must ' +
        'never be derived from the policy/quote number or generated. ' +
        'Backfill the binder UMR before issuing.',
    );
    this.name = 'BinderUmrMissingError';
    this.binderId = binderId;
  }
}

/**
 * Canonical resolver for the UMR shown on every issued policy document.
 *
 * The Unique Market Reference is owned by the **binder** (the delegated-
 * authority agreement). A policy's `umr` is a mirror of the binder it is
 * bound to — nothing more. This function is the single sanctioned way for an
 * issuance path to obtain that value. It never falls back to the policy
 * number, never generates a synthetic reference, and throws
 * {@link BinderUmrMissingError} when the binder has no UMR (fail loud;
 * `no-defensive-fallbacks` skill, ADR-0019).
 */
export function resolvePolicyUmrFromBinder(
  binder: { id?: string | null; umr?: string | null } | null | undefined,
): string {
  const umr = String(binder?.umr ?? '').trim();
  if (!umr) throw new BinderUmrMissingError(String(binder?.id ?? ''));
  return umr;
}

/**
 * Throws {@link BinderAuthorityError} if the binder does not authorize the given
 * product at the given effective date. Returns the matching authority row on success.
 *
 * Always strict (ADR-0019). A missing or non-ACTIVE row is a hard failure;
 * there is no synthetic / legacy / non-strict path. Backfill the authority
 * row before retrying the bind / program assignment.
 */
export async function assertBinderAuthorizesProduct(args: {
  binderId: string;
  productCode: string;
  effectiveDate?: Date;
  db?: PrismaLike;
}): Promise<BinderAuthorityResult> {
  const binderId = String(args.binderId || '').trim();
  const productCode = String(args.productCode || '').trim().toUpperCase();
  const effectiveDate = args.effectiveDate ?? new Date();
  const db: PrismaLike = (args.db ?? defaultPrisma) as PrismaLike;
  if (!binderId) throw new BinderAuthorityError('', productCode, 'PRODUCT_NOT_AUTHORIZED_ON_BINDER', 'binderId is required');
  if (!productCode) throw new BinderAuthorityError(binderId, '', 'PRODUCT_NOT_AUTHORIZED_ON_BINDER', 'productCode is required');

  const auth = await db.binderProductAuthority.findUnique({
    where: { binderId_productCode: { binderId, productCode } },
    select: {
      id: true, status: true, classOfBusiness: true, riskCode: true,
      effectiveFrom: true, effectiveTo: true,
    },
  });

  if (!auth) {
    throw new BinderAuthorityError(
      binderId,
      productCode,
      'PRODUCT_NOT_AUTHORIZED_ON_BINDER',
      `Binder ${binderId} does not authorize product ${productCode}.`,
    );
  }

  if (String(auth.status).toUpperCase() !== 'ACTIVE') {
    throw new BinderAuthorityError(
      binderId, productCode, 'PRODUCT_AUTHORITY_SUSPENDED',
      `Binder ${binderId} authority for ${productCode} is ${auth.status}.`,
    );
  }
  if (auth.effectiveFrom && effectiveDate < auth.effectiveFrom) {
    throw new BinderAuthorityError(
      binderId, productCode, 'PRODUCT_AUTHORITY_NOT_EFFECTIVE',
      `Binder ${binderId} authority for ${productCode} is not yet effective (starts ${auth.effectiveFrom.toISOString()}).`,
    );
  }
  if (auth.effectiveTo && effectiveDate > auth.effectiveTo) {
    throw new BinderAuthorityError(
      binderId, productCode, 'PRODUCT_AUTHORITY_NOT_EFFECTIVE',
      `Binder ${binderId} authority for ${productCode} expired on ${auth.effectiveTo.toISOString()}.`,
    );
  }

  return {
    binderId,
    productCode,
    authorityId: auth.id,
    classOfBusiness: auth.classOfBusiness,
    riskCode: auth.riskCode ?? null,
    status: auth.status,
  };
}

/**
 * Resolver used by reporting: returns the Lloyd's class-of-business + risk-code
 * for a (binder, product) pair. Always sourced from the authority row; per
 * ADR-0019 there is no legacy-scalar fallback. Reporting queries that need
 * this data must operate on (binder, product) pairs that have an authority
 * row — backfill or fail the export, never invent a class of business.
 */
export async function resolveBinderProductReporting(args: {
  binderId: string;
  productCode: string;
}): Promise<{ classOfBusiness: string; riskCode: string | null }> {
  const auth = await assertBinderAuthorizesProduct({
    binderId: args.binderId,
    productCode: args.productCode,
  });
  return { classOfBusiness: auth.classOfBusiness, riskCode: auth.riskCode };
}

export interface ActiveBinderLink {
  id: string;
  programId: string;
  binderId: string;
  program: { id: string; name: string; productType: string | null; updatedAt: Date };
  binder: { id: string; agreementNumber: string; umr: string; startDate: Date | null; endDate: Date | null };
}

/**
 * Canonical lookup for "which binder authorises this product in the current
 * operating tenant, for an inception date?" — the single source of truth
 * that every public quote session creator (motor, home, travel, health, plus
 * every future product) must call before persisting `Policy.binderId` /
 * `Policy.programId`.
 *
 * The four ANDed conditions follow the binding contract end-to-end:
 *   1. `Program(operatingTenantId=<tenant>, productType=X, status=ACTIVE)`
 *   2. `ProgramBinderLink(status=ACTIVE)`
 *   3. `Binder(operatingTenantId=<tenant>, status=ACTIVE)` inside its date window
 *   4. `BinderProductAuthority(productCode=X, status=ACTIVE)` inside its effective window
 *
 * A null result is a positive signal — the wizard should refuse with the
 * canonical 503 "No active binder linked for {PRODUCT} in this tenant",
 * not pick a "best-effort" binder or invent a synthetic one
 * (`no-defensive-fallbacks` skill, ADR-0019).
 *
 * Returns the newest matching link by binder start date, then program
 * updatedAt — so a tenant with multiple year-binders for the same product
 * always lands on the most recent.
 */
export async function findLatestActiveBinderLinkForProduct(args: {
  productCode: string;
  inceptionDate: Date;
  db?: PrismaLike;
}): Promise<ActiveBinderLink | null> {
  const tenantId = getTenantConfig().id;
  const productCode = String(args.productCode || '').trim().toUpperCase();
  const db: PrismaLike = (args.db ?? defaultPrisma) as PrismaLike;
  if (!productCode) return null;

  const links = await db.programBinderLink.findMany({
    where: {
      status: 'ACTIVE',
      program: {
        operatingTenantId: tenantId,
        productType: productCode,
        status: 'ACTIVE',
      },
      binder: {
        operatingTenantId: tenantId,
        status: 'ACTIVE',
        OR: [{ startDate: null }, { startDate: { lte: args.inceptionDate } }],
        AND: [
          { OR: [{ endDate: null }, { endDate: { gte: args.inceptionDate } }] },
          {
            productAuthorities: {
              some: {
                productCode,
                status: 'ACTIVE',
                OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: args.inceptionDate } }],
                AND: [{ OR: [{ effectiveTo: null }, { effectiveTo: { gte: args.inceptionDate } }] }],
              },
            },
          },
        ],
      },
    },
    include: {
      binder: { select: { id: true, agreementNumber: true, umr: true, startDate: true, endDate: true } },
      program: { select: { id: true, name: true, productType: true, updatedAt: true } },
    },
  });
  const sorted = links.sort((a, b) => {
    const binderDate = new Date(b.binder.startDate || 0).getTime() - new Date(a.binder.startDate || 0).getTime();
    if (binderDate !== 0) return binderDate;
    return new Date(b.program.updatedAt || 0).getTime() - new Date(a.program.updatedAt || 0).getTime();
  });
  return (sorted[0] as ActiveBinderLink | undefined) ?? null;
}

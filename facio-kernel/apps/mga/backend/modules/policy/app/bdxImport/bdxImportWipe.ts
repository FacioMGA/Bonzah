import { prisma } from '../../../../platform/db/connection.js';
import { cleanupImportedPolicy } from './bdxImportCleanup.js';

export type BdxWipeProductFilter = 'MOTOR' | 'TRAVEL' | 'HOME' | null;

export type BdxWipeCandidate = {
  policyId: string;
  productType: string;
  policyHolderId: string;
  policyNumber: string | null;
};

export type BdxWipeFailure = {
  policyId: string;
  policyNumber: string | null;
  error: string;
};

export type BdxWipeResult = {
  tenantSlug: string;
  operatingTenantId: string;
  product: BdxWipeProductFilter;
  committed: boolean;
  totals: { total: number; byProduct: Record<string, number> };
  deleted: number;
  failed: number;
  failures: BdxWipeFailure[];
};

/**
 * List BDX-tagged policies in the current operating tenant, optionally
 * filtered by product. Returns the candidate set without mutating anything.
 *
 * Caller MUST be inside `runWithOperatingTenant(...)` so the explicit
 * tenant filter below matches the resolved ALS tenant.
 */
export async function listBdxImportedPolicies(args: {
  operatingTenantId: string;
  product: BdxWipeProductFilter;
}): Promise<BdxWipeCandidate[]> {
  if (args.product) {
    return prisma.$queryRaw<BdxWipeCandidate[]>`
      SELECT p.id              AS "policyId",
             p."productType"   AS "productType",
             p."policyHolderId" AS "policyHolderId",
             p."policyNumber"  AS "policyNumber"
      FROM policies p
      JOIN policy_state_current psc ON psc."policyId" = p.id
      WHERE p."operatingTenantId" = ${args.operatingTenantId}
        AND psc.snapshot -> 'bdxImport' ->> 'runId' IS NOT NULL
        AND p."productType" = ${args.product}
    `;
  }
  return prisma.$queryRaw<BdxWipeCandidate[]>`
    SELECT p.id              AS "policyId",
           p."productType"   AS "productType",
           p."policyHolderId" AS "policyHolderId",
           p."policyNumber"  AS "policyNumber"
    FROM policies p
    JOIN policy_state_current psc ON psc."policyId" = p.id
    WHERE p."operatingTenantId" = ${args.operatingTenantId}
      AND psc.snapshot -> 'bdxImport' ->> 'runId' IS NOT NULL
  `;
}

function buildTotals(candidates: BdxWipeCandidate[]): { total: number; byProduct: Record<string, number> } {
  const byProduct: Record<string, number> = {};
  for (const row of candidates) {
    const key = String(row.productType || 'UNKNOWN').toUpperCase();
    byProduct[key] = (byProduct[key] || 0) + 1;
  }
  return { total: candidates.length, byProduct };
}

/**
 * Delete the BDX-imported policies on the current operating tenant.
 *
 * Reuses `cleanupImportedPolicy` per policy: deletes the Policy row
 * (Prisma `onDelete: Cascade` cleans PolicyStateCurrent / RiskTransaction /
 * Document / PolicyQuoteHistory / PolicySearchIndex) and removes the
 * orphan PolicyHolder if it has no remaining policies.
 *
 * STAGING ONLY — see `docs/operate/bdx-recovery-rules.md`. Callers must
 * gate on `NODE_ENV !== 'production'` plus an explicit destructive-mode
 * env / body flag before invoking with `commit: true`.
 */
export async function wipeBdxImportedPoliciesForTenant(args: {
  tenantSlug: string;
  operatingTenantId: string;
  product: BdxWipeProductFilter;
  commit: boolean;
  onProgress?: (deleted: number, total: number) => void;
}): Promise<BdxWipeResult> {
  const candidates = await listBdxImportedPolicies({
    operatingTenantId: args.operatingTenantId,
    product: args.product,
  });
  const totals = buildTotals(candidates);

  if (!args.commit) {
    return {
      tenantSlug: args.tenantSlug,
      operatingTenantId: args.operatingTenantId,
      product: args.product,
      committed: false,
      totals,
      deleted: 0,
      failed: 0,
      failures: [],
    };
  }

  let deleted = 0;
  let failed = 0;
  const failures: BdxWipeFailure[] = [];
  for (const row of candidates) {
    try {
      await cleanupImportedPolicy({ policyId: row.policyId, policyHolderId: row.policyHolderId });
      deleted += 1;
      if (args.onProgress) args.onProgress(deleted, candidates.length);
    } catch (err) {
      failed += 1;
      const message = err instanceof Error ? err.message : String(err);
      failures.push({ policyId: row.policyId, policyNumber: row.policyNumber, error: message });
    }
  }

  return {
    tenantSlug: args.tenantSlug,
    operatingTenantId: args.operatingTenantId,
    product: args.product,
    committed: true,
    totals,
    deleted,
    failed,
    failures,
  };
}

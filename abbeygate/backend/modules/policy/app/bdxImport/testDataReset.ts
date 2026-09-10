import { prisma } from '../../../../platform/db/connection.js';
import { cleanupImportedPolicy } from './bdxImportCleanup.js';

/**
 * Pre-go-live test-data reset (ADR-0051).
 *
 * Selection is by an explicit TEST-EMAIL predicate on the customer's proposer
 * email — NOT by "untagged". Production ground-truth (2026-07-21) showed the
 * "untagged" set contains real, active policies across every product (incl.
 * live Cyprus Immigration Health), and that the BDX migration stamped a
 * placeholder `bdx-import@import.local` on REAL migrated policies. So neither
 * "untagged" nor `import.local` is a safe test signal. The only clear,
 * operator-confirmed signal is an internal/seed email address.
 *
 * A row is deleted only when BOTH hold:
 *   1. its proposer email matches a TEST_EMAIL_PATTERN, AND
 *   2. it is NOT BDX-tagged (`snapshot.bdxImport.runId IS NULL`) — belt-and-
 *      suspenders so a migrated policy can never be caught even if it somehow
 *      carried a test email.
 *
 * Everything else — the "remainder" of untagged rows with real/other emails —
 * is reported for a separate human decision and never deleted here.
 */

/** Internal/seed email markers that unambiguously denote Abbeygate/Facio test data. */
export const TEST_EMAIL_PATTERNS = [
  '%example%',
  '%test%',
  '%@facio.io',
  '%@abbeygate.cy',
  '%@abbeygate.pt',
  '%@abbeygate.py',
  '%@abbeygate.gr',
];

export const TEST_DATA_RESET_TENANT_ALLOWLIST = new Set([
  'abbeygate-cy',
  'abbeygate-pt',
  'abbeygate-gr',
]);

// Canonical proposer-email SQL expression (jsonb path). Kept in one place so
// the match, the delete set, the distinct-email preview and the remainder
// report all read the same field.
const EMAIL_SQL = `lower(coalesce(p."quoteData"->'proposer'->>'email',''))`;
// Patterns are hardcoded constants (no user input) → safe to inline.
const MATCH_SQL = TEST_EMAIL_PATTERNS.map((pattern) => `${EMAIL_SQL} LIKE '${pattern}'`).join(' OR ');
const UNTAGGED_SQL = `psc.snapshot -> 'bdxImport' ->> 'runId' IS NULL`;

export type TestPolicyCandidate = {
  policyId: string;
  productType: string;
  policyHolderId: string;
  policyNumber: string | null;
  status: string;
  email: string;
};

export type TestDataResetResult = {
  tenantSlug: string;
  operatingTenantId: string;
  committed: boolean;
  bdxTaggedCount: number;
  matched: {
    total: number;
    byProduct: Record<string, number>;
    byStatus: Record<string, number>;
    distinctEmails: Array<{ email: string; n: number }>;
  };
  remainderUntagged: {
    total: number;
    byProductStatus: Array<{ product: string; status: string; n: number }>;
  };
  deleted: number;
  failed: number;
  failures: Array<{ policyId: string; policyNumber: string | null; error: string }>;
};

export function assertTenantEligibleForTestDataReset(tenantSlug: string): void {
  if (!TEST_DATA_RESET_TENANT_ALLOWLIST.has(tenantSlug)) {
    throw new Error(
      `Tenant '${tenantSlug}' is not eligible for the pre-go-live test-data reset. ` +
        `Allowed: ${[...TEST_DATA_RESET_TENANT_ALLOWLIST].join(', ')}.`,
    );
  }
}

export async function countBdxTaggedPolicies(operatingTenantId: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
    `SELECT COUNT(*)::int AS count
     FROM policies p
     JOIN policy_state_current psc ON psc."policyId" = p.id
     WHERE p."operatingTenantId" = $1
       AND psc.snapshot -> 'bdxImport' ->> 'runId' IS NOT NULL`,
    operatingTenantId,
  );
  return Number(rows[0]?.count ?? 0);
}

export async function listTestPolicies(operatingTenantId: string): Promise<TestPolicyCandidate[]> {
  return prisma.$queryRawUnsafe<TestPolicyCandidate[]>(
    `SELECT p.id              AS "policyId",
            p."productType"    AS "productType",
            p."policyHolderId" AS "policyHolderId",
            p."policyNumber"   AS "policyNumber",
            p.status           AS "status",
            ${EMAIL_SQL}       AS "email"
     FROM policies p
     JOIN policy_state_current psc ON psc."policyId" = p.id
     WHERE p."operatingTenantId" = $1
       AND ${UNTAGGED_SQL}
       AND (${MATCH_SQL})`,
    operatingTenantId,
  );
}

async function distinctMatchedEmails(operatingTenantId: string): Promise<Array<{ email: string; n: number }>> {
  return prisma.$queryRawUnsafe<Array<{ email: string; n: number }>>(
    `SELECT ${EMAIL_SQL} AS email, COUNT(*)::int AS n
     FROM policies p
     JOIN policy_state_current psc ON psc."policyId" = p.id
     WHERE p."operatingTenantId" = $1 AND ${UNTAGGED_SQL} AND (${MATCH_SQL})
     GROUP BY 1 ORDER BY 2 DESC`,
    operatingTenantId,
  );
}

async function remainderReport(operatingTenantId: string): Promise<Array<{ product: string; status: string; n: number }>> {
  return prisma.$queryRawUnsafe<Array<{ product: string; status: string; n: number }>>(
    `SELECT COALESCE(p."productType", '?') AS product, p.status AS status, COUNT(*)::int AS n
     FROM policies p
     JOIN policy_state_current psc ON psc."policyId" = p.id
     WHERE p."operatingTenantId" = $1 AND ${UNTAGGED_SQL} AND NOT (${MATCH_SQL})
     GROUP BY 1, 2 ORDER BY 1, 2`,
    operatingTenantId,
  );
}

function buildMatchedTotals(candidates: TestPolicyCandidate[]): { byProduct: Record<string, number>; byStatus: Record<string, number> } {
  const byProduct: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  for (const row of candidates) {
    const product = String(row.productType || 'UNKNOWN').toUpperCase();
    const status = String(row.status || 'UNKNOWN').toUpperCase();
    byProduct[product] = (byProduct[product] || 0) + 1;
    byStatus[status] = (byStatus[status] || 0) + 1;
  }
  return { byProduct, byStatus };
}

/**
 * Preview (commit=false) or execute (commit=true) the test-data reset for the
 * current operating tenant. Caller MUST already be inside
 * `runWithOperatingTenant(...)` and MUST have passed
 * `assertTenantEligibleForTestDataReset`.
 */
export async function runTestDataReset(args: {
  tenantSlug: string;
  operatingTenantId: string;
  commit: boolean;
  onProgress?: (deleted: number, total: number) => void;
}): Promise<TestDataResetResult> {
  assertTenantEligibleForTestDataReset(args.tenantSlug);

  const [bdxTaggedCount, candidates, distinctEmails, remainder] = await Promise.all([
    countBdxTaggedPolicies(args.operatingTenantId),
    listTestPolicies(args.operatingTenantId),
    distinctMatchedEmails(args.operatingTenantId),
    remainderReport(args.operatingTenantId),
  ]);

  const { byProduct, byStatus } = buildMatchedTotals(candidates);
  const base = {
    tenantSlug: args.tenantSlug,
    operatingTenantId: args.operatingTenantId,
    bdxTaggedCount,
    matched: { total: candidates.length, byProduct, byStatus, distinctEmails },
    remainderUntagged: {
      total: remainder.reduce((acc, r) => acc + Number(r.n), 0),
      byProductStatus: remainder,
    },
  };

  if (!args.commit) {
    return { ...base, committed: false, deleted: 0, failed: 0, failures: [] };
  }

  let deleted = 0;
  let failed = 0;
  const failures: TestDataResetResult['failures'] = [];
  for (const row of candidates) {
    try {
      await cleanupImportedPolicy({ policyId: row.policyId, policyHolderId: row.policyHolderId });
      deleted += 1;
      if (args.onProgress) args.onProgress(deleted, candidates.length);
    } catch (err) {
      failed += 1;
      failures.push({
        policyId: row.policyId,
        policyNumber: row.policyNumber,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { ...base, committed: true, deleted, failed, failures };
}

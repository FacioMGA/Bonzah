/**
 * Pre-merge verification: `policySearchIndex.totalPremium` (projection) ==
 * legacy `quoteResponse` resolver path, on a live sample.
 *
 * Legacy chain (formerly inlined in reportsRouter.ts):
 *   pricing.total ?? primaryOption.costDetails.totalPremium ?? pricing.annualPremium
 *     ?? primaryOption.annualPremium ?? quoteResponse.premium ?? 0
 * Projection chain (policyListIndex.ts):
 *   pricing.total || pricing.annualPremium || primaryOption.annualPremium
 *     || quoteResponse.premium || 0
 *
 * Run: `npm run verify:dashboard-premium-projection`
 *      SAMPLE_SIZE=200 STATUSES=ISSUED,ACTIVE TOLERANCE=0.01 ...
 * Exits non-zero on aggregate drift > tolerance OR > 1% of sample diverging.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SAMPLE_SIZE = Math.max(1, Number(process.env.SAMPLE_SIZE || 50));
const TOLERANCE   = Math.max(0, Number(process.env.TOLERANCE   || 0.01));
const STATUSES    = String(process.env.STATUSES || 'ISSUED,ACTIVE')
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as JsonRecord)
        : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function toNumber(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

// Verbatim copy of the legacy `resolvePolicyTotalPremium` previously inlined in
// reportsRouter.ts. Kept here purely so the verification script can compare the
// two formulas head-to-head.
function legacyResolvePremium(quoteResponseRaw: unknown): number {
  const quoteResponse = asRecord(quoteResponseRaw);
  const pricing       = asRecord(quoteResponse.pricing);
  const primaryOption = asRecord(quoteResponse.primaryOption);
  const costDetails   = asRecord(primaryOption.costDetails);
  return toNumber(
    pricing.total
    ?? costDetails.totalPremium
    ?? pricing.annualPremium
    ?? primaryOption.annualPremium
    ?? quoteResponse.premium
    ?? 0,
  );
}

type Divergence = {
  policyId: string;
  policyNumber: string;
  status: string;
  projection: number;
  legacy: number;
  delta: number;
  reason: string;
};

async function main() {
  // eslint-disable-next-line no-console
  console.log(`[premium-projection-check] sampling ${SAMPLE_SIZE} policies in [${STATUSES.join(', ')}], tolerance €${TOLERANCE}`);

  const policies = await prisma.policy.findMany({
    where: {
      status: { in: STATUSES },
      productType: { not: null },
    },
    select: {
      id: true,
      policyNumber: true,
      status: true,
      quoteResponse: true,
      searchIndex: { select: { totalPremium: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: SAMPLE_SIZE,
  });

  if (policies.length === 0) {
    // eslint-disable-next-line no-console
    console.warn('[premium-projection-check] no policies matched the filter — nothing to verify.');
    process.exit(0);
  }

  const divergences: Divergence[] = [];
  let projectionSum = 0;
  let legacySum     = 0;
  let missingIndex  = 0;

  for (const policy of policies) {
    const projection = toNumber(policy.searchIndex?.totalPremium);
    const legacy     = legacyResolvePremium(policy.quoteResponse);
    projectionSum += projection;
    legacySum     += legacy;

    if (!policy.searchIndex) missingIndex += 1;

    const delta = Math.abs(projection - legacy);
    if (delta > TOLERANCE) {
      let reason = 'unknown';
      const qr = asRecord(policy.quoteResponse);
      const pricing = asRecord(qr.pricing);
      const primaryOption = asRecord(qr.primaryOption);
      const costDetails = asRecord(primaryOption.costDetails);
      if (!policy.searchIndex) {
        reason = 'missing policySearchIndex row (projection backfill needed)';
      } else if (toNumber(pricing.total) === 0 && toNumber(costDetails.totalPremium) > 0) {
        reason = 'pricing.total falsy AND costDetails.totalPremium populated — legacy-only path';
      } else if (projection === 0 && legacy > 0) {
        reason = 'projection stale (re-run policyListIndex projection)';
      } else if (projection > 0 && legacy === 0) {
        reason = 'legacy resolved 0 (no quoteResponse) but projection has a value';
      } else {
        reason = 'numeric drift';
      }
      divergences.push({
        policyId: policy.id,
        policyNumber: policy.policyNumber,
        status: policy.status,
        projection,
        legacy,
        delta,
        reason,
      });
    }
  }

  const ratio = legacySum === 0 ? 0 : Math.abs(projectionSum - legacySum) / legacySum;

  // eslint-disable-next-line no-console
  console.log(`[premium-projection-check] sampled       : ${policies.length}`);
  // eslint-disable-next-line no-console
  console.log(`[premium-projection-check] missing index : ${missingIndex}`);
  // eslint-disable-next-line no-console
  console.log(`[premium-projection-check] sum projection: €${projectionSum.toFixed(2)}`);
  // eslint-disable-next-line no-console
  console.log(`[premium-projection-check] sum legacy    : €${legacySum.toFixed(2)}`);
  // eslint-disable-next-line no-console
  console.log(`[premium-projection-check] aggregate drift: ${(ratio * 100).toFixed(4)}% (tolerance ${(TOLERANCE * 100).toFixed(4)}%)`);
  // eslint-disable-next-line no-console
  console.log(`[premium-projection-check] divergent rows: ${divergences.length}`);

  if (divergences.length > 0) {
    // eslint-disable-next-line no-console
    console.log('[premium-projection-check] first 20 divergences:');
    for (const d of divergences.slice(0, 20)) {
      // eslint-disable-next-line no-console
      console.log(
        `  - ${d.policyNumber} (${d.status})  projection=€${d.projection.toFixed(2)}  legacy=€${d.legacy.toFixed(2)}  Δ=€${d.delta.toFixed(2)}  [${d.reason}]`,
      );
    }
  }

  // Material aggregate drift OR > 1% of sample diverging fails the check.
  const sampleFailRate = divergences.length / policies.length;
  if (ratio > TOLERANCE || sampleFailRate > 0.01) {
    // eslint-disable-next-line no-console
    console.error(`[premium-projection-check] FAIL — drift exceeds tolerance (sample fail rate ${(sampleFailRate * 100).toFixed(2)}%)`);
    // eslint-disable-next-line no-console
    console.error('[premium-projection-check] options: (a) re-run policyListIndex projection, (b) widen the projection adapter chain to match the legacy resolver, (c) tighten this script\'s tolerance.');
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.log('[premium-projection-check] ok — projection.totalPremium matches legacy resolver within tolerance.');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[premium-projection-check] crashed:', err);
    process.exit(2);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

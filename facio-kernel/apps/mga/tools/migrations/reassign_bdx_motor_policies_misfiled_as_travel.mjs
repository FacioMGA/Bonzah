#!/usr/bin/env node
/**
 * BDX program-binder reassignment — staging cleanup for the May 2026 incident.
 *
 * Context
 * -------
 * `bdxImportJobRunner` previously called `resolveProgramBinder({})` with no
 * arguments. Inside `bdxImportContext.resolveProgramBinder`, that fell through
 * to `findFirst({ status: 'ACTIVE' }, orderBy: { updatedAt: 'desc' })`. On
 * staging the Travel program happened to be the most recently updated ACTIVE
 * program, so 5,702 BDX-imported MOTOR policies were committed under the
 * Travel program/binder.
 *
 * The worker is fixed (`resolveProgramBinder` now requires productType, refuses
 * to guess, and the runner fails loudly when no unique ACTIVE program/binder
 * pair exists). This script cleans up the rows that were already committed.
 *
 * What it does
 * ------------
 * 1. Resolves the operating tenant (default abbeygate-cy) and scopes Prisma.
 * 2. Resolves the unique ACTIVE Travel program (source of pollution) AND the
 *    unique ACTIVE Motor program (target). Aborts on ambiguity.
 * 3. Safety check: counts Policy rows under the Travel program by productType.
 *    Aborts if any productType=TRAVEL rows exist (would mean real travel
 *    policies are present and the cleanup would corrupt them).
 * 4. Resolves the unique ACTIVE binder linked to the Motor program via
 *    ProgramBinderLink. Aborts on ambiguity.
 * 5. Reports the planned reassignment with sample rows. Dry-run by default.
 * 6. With --apply, runs an UPDATE inside a single transaction.
 * 7. Final verification:
 *      - Travel-program policy count == 0
 *      - Motor-program delta == reassigned count
 *      - 0 MOTOR policies remain attached to the Travel binder
 *
 * Usage
 * -----
 *   node tools/migrations/reassign_bdx_motor_policies_misfiled_as_travel.mjs           # dry-run
 *   node tools/migrations/reassign_bdx_motor_policies_misfiled_as_travel.mjs --apply   # commit
 *
 * Env
 * ---
 *   TENANT_SLUG  default: abbeygate-cy
 *
 * Notes
 * -----
 * - Touches `policies` only. Policy projections (PolicyListIndex,
 *   PolicySearchIndex) and RiskTransaction snapshots also denormalise
 *   programId/binderId. After --apply you must enqueue
 *   POLICY.INDEX_RECONCILE so projections rebuild against the corrected ids.
 *   This script intentionally does NOT touch projections.
 * - Wraps the UPDATE in a single transaction so it's atomic.
 */
import { runWithOperatingTenant } from '../../backend/dist/platform/tenant/tenantAls.js';
import { loadTenantBySlug } from '../../backend/dist/platform/tenant/tenantJobContext.js';
import { prisma, tenantScopedPrisma } from '../../backend/dist/platform/db/connection.js';

const TENANT_SLUG = String(process.env.TENANT_SLUG || 'abbeygate-cy').trim();
const APPLY = process.argv.slice(2).includes('--apply');

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function info(message) {
  console.log(`• ${message}`);
}

function ok(message) {
  console.log(`✓ ${message}`);
}

async function findUniqueActiveProgram(productType) {
  const matches = await tenantScopedPrisma.program.findMany({
    where: { status: 'ACTIVE', productType },
    select: { id: true, name: true, productType: true },
  });
  if (matches.length === 0) {
    fail(`No ACTIVE program found for productType=${productType}.`);
  }
  if (matches.length > 1) {
    const ids = matches.map((m) => `${m.id} (${m.name})`).join(', ');
    fail(`Ambiguous: ${matches.length} ACTIVE programs for productType=${productType}: ${ids}.`);
  }
  return matches[0];
}

async function findUniqueActiveLinkedBinder(programId) {
  const links = await prisma.programBinderLink.findMany({
    where: { programId, status: 'ACTIVE' },
    include: { binder: { select: { id: true, status: true, agreementNumber: true, umr: true } } },
  });
  const active = links
    .map((link) => link.binder)
    .filter((b) => String(b?.status || '').toUpperCase() === 'ACTIVE');
  if (active.length === 0) {
    fail(`Program ${programId} has no ACTIVE linked binders.`);
  }
  if (active.length > 1) {
    const ids = active.map((b) => `${b.id} (${b.agreementNumber || b.umr || ''})`).join(', ');
    fail(`Ambiguous: ${active.length} ACTIVE binders linked to program ${programId}: ${ids}.`);
  }
  return active[0];
}

async function countPoliciesByProductType(programId) {
  const rows = await tenantScopedPrisma.policy.groupBy({
    by: ['productType'],
    where: { programId },
    _count: { _all: true },
  });
  const out = {};
  for (const row of rows) out[String(row.productType || 'NULL')] = row._count._all;
  return out;
}

async function run() {
  const tenant = await loadTenantBySlug(TENANT_SLUG);
  if (!tenant) fail(`Unknown tenant slug: ${TENANT_SLUG}`);

  await runWithOperatingTenant(tenant, async () => {
    info(`Tenant: ${tenant.id} (${TENANT_SLUG})`);
    info(`Mode:   ${APPLY ? 'APPLY (will commit changes)' : 'DRY-RUN (no writes)'}`);

    const travelProgram = await findUniqueActiveProgram('TRAVEL');
    const motorProgram = await findUniqueActiveProgram('MOTOR');
    info(`Travel program (source of pollution): ${travelProgram.id} — ${travelProgram.name}`);
    info(`Motor program (target):              ${motorProgram.id} — ${motorProgram.name}`);

    info('Safety check: count by productType under the Travel program …');
    const travelCounts = await countPoliciesByProductType(travelProgram.id);
    console.table(travelCounts);
    const realTravel = Number(travelCounts.TRAVEL || 0);
    if (realTravel > 0) {
      fail(
        `Refusing to proceed: ${realTravel} policy/policies under the Travel program have productType=TRAVEL. `
        + 'These look like real travel policies — verify before running cleanup.'
      );
    }

    const motorBinder = await findUniqueActiveLinkedBinder(motorProgram.id);
    info(`Motor binder (target): ${motorBinder.id} (${motorBinder.agreementNumber || motorBinder.umr || ''})`);

    info('Identifying rows to reassign (productType=MOTOR under Travel program) …');
    const candidates = await tenantScopedPrisma.policy.findMany({
      where: { programId: travelProgram.id, productType: 'MOTOR' },
      select: { id: true, policyNumber: true, binderId: true },
    });
    info(`Found ${candidates.length} candidate row(s) to reassign.`);
    const sampleRows = candidates.slice(0, 5).map((row) => ({
      id: row.id,
      policyNumber: row.policyNumber,
      currentBinderId: row.binderId,
      newProgramId: motorProgram.id,
      newBinderId: motorBinder.id,
    }));
    if (sampleRows.length > 0) {
      info('Sample (first 5):');
      console.table(sampleRows);
    }

    const motorBefore = await tenantScopedPrisma.policy.count({ where: { programId: motorProgram.id } });
    info(`Motor program currently has ${motorBefore} policy/policies.`);

    if (!APPLY) {
      ok('Dry-run complete. Re-run with --apply to commit.');
      return;
    }

    info('Applying reassignment in a single transaction …');
    const result = await tenantScopedPrisma.$transaction(async (tx) => {
      const updated = await tx.policy.updateMany({
        where: { programId: travelProgram.id, productType: 'MOTOR' },
        data: { programId: motorProgram.id, binderId: motorBinder.id },
      });
      return updated;
    });
    ok(`Reassigned ${result.count} row(s).`);

    info('Final verification …');
    const travelAfter = await tenantScopedPrisma.policy.count({ where: { programId: travelProgram.id } });
    const motorAfter = await tenantScopedPrisma.policy.count({ where: { programId: motorProgram.id } });
    const motorOnTravelBinders = await tenantScopedPrisma.policy.count({
      where: {
        productType: 'MOTOR',
        binderId: { not: motorBinder.id },
        programId: travelProgram.id,
      },
    });

    console.table({
      'travel-program.policyCount':       travelAfter,
      'motor-program.policyCount.before': motorBefore,
      'motor-program.policyCount.after':  motorAfter,
      'motor-program.delta':              motorAfter - motorBefore,
      'motor-on-travel-program-after':    motorOnTravelBinders,
    });

    if (travelAfter !== 0) {
      fail(`Verification failed: travel program still has ${travelAfter} policies.`);
    }
    if (motorAfter - motorBefore !== result.count) {
      fail(`Verification failed: motor program delta (${motorAfter - motorBefore}) != reassigned count (${result.count}).`);
    }
    if (motorOnTravelBinders !== 0) {
      fail(`Verification failed: ${motorOnTravelBinders} MOTOR policies still attached to the Travel program.`);
    }
    ok('All verification checks passed.');
    info('Next: enqueue POLICY.INDEX_RECONCILE so policyListIndex / policySearchIndex projections rebuild against the corrected programId/binderId.');
  });
}

run()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

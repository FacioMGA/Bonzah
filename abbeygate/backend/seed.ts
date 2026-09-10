// Gen2 seed entrypoint. Composer only — each stage lives in its own
// file under `./seed/` (split in PR 2.3b of the errors-and-warnings
// cleanup so each concern stays under the file-size cap):
//
//   context.ts                    - PrismaClient singleton + canonical fixture re-exports
//   helpers.ts                    - pure + tenant-scoped helpers
//   binders.ts                    - seedAllBinders(): year/home/travel binders
//   exampleAndClaimPolicies.ts    - Active, Issued, CancellationPending, OpenClaim
//   renewalAndDemoLanes.ts        - RenewalInProgress + Green/Yellow/Red lanes
//   reporting.ts                  - reporting period + projection backfill
//
// `npm run db:seed` invokes this script via `tsx`. The script makes
// network calls (DB writes), so it cannot be safely `import`-ed by
// tests; treat it as a CLI entrypoint only.

import { tenantScopedPrisma } from './platform/db/connection.js';
import { runWithOperatingTenant } from './platform/tenant/tenantAls.js';
import { TENANT_IDS } from './platform/tenant/tenantConfig.js';
import { buildTenantConfigFromEnv } from './platform/tenant/tenantConfigForCli.js';
import { logger } from './platform/utils/logger.js';
import { registerAllProducts } from './products/registerProducts.js';
import {
  CANONICAL_PROGRAMS,
  prisma,
  SEEDED_HEALTH_PROGRAM_ID,
  SEEDED_HOME_PROGRAM_ID,
  SEEDED_PROGRAM_ID,
  SEEDED_TRAVEL_PROGRAM_ID,
} from './seed/context.js';
import { seedAllBinders } from './seed/binders.js';
import { seedExampleAndClaimPolicies } from './seed/exampleAndClaimPolicies.js';
import { seedRenewalAndDemoLanes } from './seed/renewalAndDemoLanes.js';
import { seedReportingPeriodAndProjections } from './seed/reporting.js';

// Product adapters must be registered before any calculator runs, because
// pricing/effects resolution goes through the product-scoped MBE catalog.
registerAllProducts();

async function main() {
  logger.info('🌱 Starting Gen2 Seed...');

  // 1. Create Policy Holder
  const ph = await tenantScopedPrisma.policyHolder.create({
    data: {
      operatingTenantId: TENANT_IDS.CY,
      name: 'Uriel Aharoni (Seed)',
      contact: JSON.stringify({ email: 'uriel@example.com', phone: '+357 99 123456', firstName: 'Uriel', lastName: 'Aharoni' }),
      segment: 'Auto Insurance',
      address: 'Limassol, Cyprus',
    },
  });
  logger.info(`✅ Created PolicyHolder: ${ph.name}`);

  // 2. Ensure ProductDefinition rows exist for every product the platform ships.
  const PRODUCT_DEFINITIONS = [
    { code: 'MOTOR', displayName: 'Motor Insurance', icon: 'car' },
    { code: 'HOME', displayName: 'Home Insurance', icon: 'home' },
    { code: 'TRAVEL', displayName: 'Travel Insurance', icon: 'plane' },
    { code: 'HEALTH', displayName: 'Immigration Medical Insurance', icon: 'heart-pulse' },
  ] as const;
  for (const def of PRODUCT_DEFINITIONS) {
    await prisma.productDefinition.upsert({
      where: { code: def.code },
      update: { displayName: def.displayName, icon: def.icon, isActive: true },
      create: { code: def.code, displayName: def.displayName, icon: def.icon, isActive: true },
    });
  }
  logger.info(`✅ Seeded product definitions: ${PRODUCT_DEFINITIONS.map((p) => p.code).join(', ')}`);

  const program = await tenantScopedPrisma.program.upsert({
    where: { id: SEEDED_PROGRAM_ID },
    update: {
      operatingTenantId: TENANT_IDS.CY,
      name: CANONICAL_PROGRAMS.MOTOR.name,
      status: 'ACTIVE',
      productType: 'MOTOR',
    },
    create: {
      id: SEEDED_PROGRAM_ID,
      operatingTenantId: TENANT_IDS.CY,
      name: CANONICAL_PROGRAMS.MOTOR.name,
      status: 'ACTIVE',
      productType: 'MOTOR',
    },
  });

  const homeProgram = await tenantScopedPrisma.program.upsert({
    where: { id: SEEDED_HOME_PROGRAM_ID },
    update: { operatingTenantId: TENANT_IDS.CY, name: CANONICAL_PROGRAMS.HOME.name, status: 'ACTIVE', productType: 'HOME' },
    create: {
      id: SEEDED_HOME_PROGRAM_ID,
      operatingTenantId: TENANT_IDS.CY,
      name: CANONICAL_PROGRAMS.HOME.name,
      status: 'ACTIVE',
      productType: 'HOME',
    },
  });

  const travelProgram = await tenantScopedPrisma.program.upsert({
    where: { id: SEEDED_TRAVEL_PROGRAM_ID },
    update: { operatingTenantId: TENANT_IDS.CY, name: CANONICAL_PROGRAMS.TRAVEL.name, status: 'ACTIVE', productType: 'TRAVEL' },
    create: {
      id: SEEDED_TRAVEL_PROGRAM_ID,
      operatingTenantId: TENANT_IDS.CY,
      name: CANONICAL_PROGRAMS.TRAVEL.name,
      status: 'ACTIVE',
      productType: 'TRAVEL',
    },
  });

  // HEALTH program — Brit Immigration Medical Insurance.
  // Rides the existing BRIT travel binder family (overlay-only — no
  // dedicated binder rows). Allows BO Programs page to list HEALTH
  // and enables MBE templates fetch via the product adapter.
  const healthProgram = await tenantScopedPrisma.program.upsert({
    where: { id: SEEDED_HEALTH_PROGRAM_ID },
    update: { operatingTenantId: TENANT_IDS.CY, name: CANONICAL_PROGRAMS.HEALTH.name, status: 'ACTIVE', productType: 'HEALTH' },
    create: {
      id: SEEDED_HEALTH_PROGRAM_ID,
      operatingTenantId: TENANT_IDS.CY,
      name: CANONICAL_PROGRAMS.HEALTH.name,
      status: 'ACTIVE',
      productType: 'HEALTH',
    },
  });

  // 3. Seed binders + return the active motor binder used by every policy below.
  const motorPolicyBinder = await seedAllBinders({ program, homeProgram, travelProgram, healthProgram });

  // 4. Seed the example policy lifecycle states (Active / Issued / Cancellation-Pending / OpenClaim).
  await seedExampleAndClaimPolicies({ ph, program, motorPolicyBinder });

  // 5. Seed renewal-in-progress + the Green/Yellow/Red UW demo lanes.
  await seedRenewalAndDemoLanes({ ph, program, motorPolicyBinder });

  // 6. Seed the reporting period + backfill the policy list projection.
  await seedReportingPeriodAndProjections({ motorPolicyBinder });

  logger.info('🎉 Seed Complete!');
}

runWithOperatingTenant(buildTenantConfigFromEnv(), main)
  .catch((e) => {
    logger.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

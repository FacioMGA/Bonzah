// Reporting-period seed + projection backfill, run last so the policy
// list index reflects everything seeded above.

import { runWithOperatingTenant } from '../platform/tenant/tenantAls.js';
import { buildTenantConfigFromEnv } from '../platform/tenant/tenantConfigForCli.js';
import { backfillPolicyListIndex } from '../modules/policy/infra/projections/policyListIndex.js';
import { logger } from '../platform/utils/logger.js';
import { prisma } from './context.js';
import type { SeededMotorBinder } from './binders.js';

export async function seedReportingPeriodAndProjections(args: {
  motorPolicyBinder: SeededMotorBinder;
}): Promise<void> {
  const { motorPolicyBinder } = args;

  const motorReportingPeriodStart = new Date(motorPolicyBinder.startDate);
  const motorReportingPeriodEnd = new Date(motorReportingPeriodStart);
  motorReportingPeriodEnd.setUTCMonth(motorReportingPeriodEnd.getUTCMonth() + 1, 0);
  const motorReportingYear = motorReportingPeriodStart.getUTCFullYear();
  const motorReportingMonth = motorReportingPeriodStart.getUTCMonth() + 1;
  await prisma.reportingPeriod.upsert({
    where: {
      binderId_year_month: {
        binderId: motorPolicyBinder.id,
        year: motorReportingYear,
        month: motorReportingMonth,
      },
    },
    update: {
      startDate: motorReportingPeriodStart,
      endDate: motorReportingPeriodEnd,
      status: 'OPEN',
    },
    create: {
      binderId: motorPolicyBinder.id,
      year: motorReportingYear,
      month: motorReportingMonth,
      startDate: motorReportingPeriodStart,
      endDate: motorReportingPeriodEnd,
      status: 'OPEN'
    }
  });
  logger.info(`✅ Created Reporting Period for ${motorReportingYear}-${String(motorReportingMonth).padStart(2, '0')}`);

  // Ensure seeded policies are visible in /policies immediately (list reads projection table).
  const indexed = await runWithOperatingTenant(buildTenantConfigFromEnv(), () => backfillPolicyListIndex(500, 20));
  logger.info(`✅ Backfilled policy_list_index rows: ${indexed}`);
}

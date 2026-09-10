// Year/Home/Travel binder seeding (with their ProgramBinderLink and
// BinderProductAuthority rows). Returns the active motor binder used
// by every example policy seeded downstream.

import type { Program } from '@prisma/client';
import { tenantScopedPrisma } from '../platform/db/connection.js';
import { TENANT_IDS } from '../platform/tenant/tenantConfig.js';
import { logger } from '../platform/utils/logger.js';
import {
  HOME_BINDERS,
  LEGACY_MOTOR_BINDER_ID,
  SEED_OVERWRITE_BINDERS,
  TRAVEL_BINDERS,
  YEAR_BINDERS,
} from './context.js';
import {
  reseedBinderParties,
  statusForPeriod,
  statusUpdateForPeriod,
  toInputJson,
} from './helpers.js';

export type SeededMotorBinder = {
  id: string;
  agreementNumber: string;
  umr: string;
  startDate: Date;
};

export async function seedAllBinders(args: {
  program: Program;
  homeProgram: Program;
  travelProgram: Program;
  healthProgram: Program;
}): Promise<SeededMotorBinder> {
  const { program, homeProgram, travelProgram, healthProgram } = args;

  await tenantScopedPrisma.programBinderLink.deleteMany({
    where: { binderId: LEGACY_MOTOR_BINDER_ID },
  }).catch(() => undefined);
  await tenantScopedPrisma.binderProductAuthority.deleteMany({
    where: { binderId: LEGACY_MOTOR_BINDER_ID },
  }).catch(() => undefined);

  let motorPolicyBinder: SeededMotorBinder | null = null;
  for (const yearBinder of YEAR_BINDERS) {
    const seeded = await tenantScopedPrisma.binder.upsert({
      where: { id: yearBinder.id },
      update: SEED_OVERWRITE_BINDERS ? {
        operatingTenantId: TENANT_IDS.CY,
        coverholderName: 'Abbeygate UW Ltd.',
        coverholderPin: '115933OFE',
        umr: yearBinder.umr,
        agreementNumber: yearBinder.agreementNumber,
        config: toInputJson(yearBinder.config),
        lloydsReportingVer: 'V5.2',
        defaultCurrency: 'EUR',
        settlementCurrency: 'EUR',
        startDate: yearBinder.startDate,
        endDate: yearBinder.endDate,
        status: statusForPeriod(yearBinder.startDate, yearBinder.endDate),
      } : statusUpdateForPeriod(yearBinder.startDate, yearBinder.endDate),
      create: {
        id: yearBinder.id,
        operatingTenantId: TENANT_IDS.CY,
        coverholderName: 'Abbeygate UW Ltd.',
        coverholderPin: '115933OFE',
        umr: yearBinder.umr,
        agreementNumber: yearBinder.agreementNumber,
        config: toInputJson(yearBinder.config),
        lloydsReportingVer: 'V5.2',
        defaultCurrency: 'EUR',
        settlementCurrency: 'EUR',
        startDate: yearBinder.startDate,
        endDate: yearBinder.endDate,
        status: statusForPeriod(yearBinder.startDate, yearBinder.endDate),
      },
    });
    await reseedBinderParties(seeded.id, yearBinder.coverholderName, yearBinder.leadName);
    // Motor program linked only to motor year binders.
    await tenantScopedPrisma.programBinderLink.upsert({
      where: { programId_binderId: { programId: program.id, binderId: seeded.id } },
      update: statusUpdateForPeriod(yearBinder.startDate, yearBinder.endDate),
      create: { programId: program.id, binderId: seeded.id, status: statusForPeriod(yearBinder.startDate, yearBinder.endDate) },
    });
    // Remove stub Home/Travel links from motor year binders.
    await tenantScopedPrisma.programBinderLink.deleteMany({
      where: { binderId: seeded.id, programId: { in: [homeProgram.id, travelProgram.id] } },
    }).catch(() => undefined);
    await tenantScopedPrisma.binderProductAuthority.upsert({
      where: { binderId_productCode: { binderId: seeded.id, productCode: yearBinder.productCode } },
      update: SEED_OVERWRITE_BINDERS ? {
        operatingTenantId: TENANT_IDS.CY,
        classOfBusiness: yearBinder.classOfBusiness,
        riskCode: yearBinder.riskCode,
        authorityClasses: [...yearBinder.authorityClasses],
        territorialScope: [...yearBinder.territorialScope],
        status: statusForPeriod(yearBinder.startDate, yearBinder.endDate),
      } : statusUpdateForPeriod(yearBinder.startDate, yearBinder.endDate),
      create: {
        operatingTenantId: TENANT_IDS.CY,
        binderId: seeded.id,
        productCode: yearBinder.productCode,
        classOfBusiness: yearBinder.classOfBusiness,
        riskCode: yearBinder.riskCode,
        authorityClasses: [...yearBinder.authorityClasses],
        territorialScope: [...yearBinder.territorialScope],
        status: statusForPeriod(yearBinder.startDate, yearBinder.endDate),
      },
    });
    await tenantScopedPrisma.binderProductAuthority.deleteMany({
      where: { binderId: seeded.id, productCode: { in: ['HOME', 'TRAVEL'] } },
    }).catch(() => undefined);
    if (statusForPeriod(yearBinder.startDate, yearBinder.endDate) === 'ACTIVE') {
      motorPolicyBinder = { id: seeded.id, agreementNumber: seeded.agreementNumber, umr: seeded.umr, startDate: yearBinder.startDate };
    }
    logger.info(`✅ Seeded motor year binder: ${seeded.agreementNumber}`);
  }

  if (!motorPolicyBinder) {
    throw new Error('No ACTIVE motor year binder is available for seed policies.');
  }

  // ── HOME binder family (real Beazley agreements 24/25/26 EEA6551) ──────────
  for (const hb of HOME_BINDERS) {
    const seeded = await tenantScopedPrisma.binder.upsert({
      where: { id: hb.id },
      update: SEED_OVERWRITE_BINDERS ? {
        operatingTenantId: TENANT_IDS.CY,
        coverholderName: hb.coverholderName,
        coverholderPin: hb.coverholderPin,
        umr: hb.umr,
        agreementNumber: hb.agreementNumber,
        config: toInputJson(hb.config),
        lloydsReportingVer: 'V5.2',
        defaultCurrency: 'EUR',
        settlementCurrency: 'EUR',
        startDate: hb.startDate,
        endDate: hb.endDate,
        status: statusForPeriod(hb.startDate, hb.endDate),
      } : statusUpdateForPeriod(hb.startDate, hb.endDate),
      create: {
        id: hb.id,
        operatingTenantId: TENANT_IDS.CY,
        coverholderName: hb.coverholderName,
        coverholderPin: hb.coverholderPin,
        umr: hb.umr,
        agreementNumber: hb.agreementNumber,
        config: toInputJson(hb.config),
        lloydsReportingVer: 'V5.2',
        defaultCurrency: 'EUR',
        settlementCurrency: 'EUR',
        startDate: hb.startDate,
        endDate: hb.endDate,
        status: statusForPeriod(hb.startDate, hb.endDate),
      },
    });
    await reseedBinderParties(seeded.id, hb.coverholderName, hb.leadName);
    await tenantScopedPrisma.programBinderLink.upsert({
      where: { programId_binderId: { programId: homeProgram.id, binderId: seeded.id } },
      update: statusUpdateForPeriod(hb.startDate, hb.endDate),
      create: { programId: homeProgram.id, binderId: seeded.id, status: statusForPeriod(hb.startDate, hb.endDate) },
    });
    await tenantScopedPrisma.binderProductAuthority.upsert({
      where: { binderId_productCode: { binderId: seeded.id, productCode: 'HOME' } },
      update: SEED_OVERWRITE_BINDERS ? {
        operatingTenantId: TENANT_IDS.CY,
        classOfBusiness: hb.classOfBusiness,
        riskCode: hb.riskCode,
        authorityClasses: [...hb.authorityClasses],
        territorialScope: [...hb.territorialScope],
        status: statusForPeriod(hb.startDate, hb.endDate),
      } : statusUpdateForPeriod(hb.startDate, hb.endDate),
      create: {
        operatingTenantId: TENANT_IDS.CY,
        binderId: seeded.id,
        productCode: 'HOME',
        classOfBusiness: hb.classOfBusiness,
        riskCode: hb.riskCode,
        authorityClasses: [...hb.authorityClasses],
        territorialScope: [...hb.territorialScope],
        status: statusForPeriod(hb.startDate, hb.endDate),
      },
    });
    logger.info(`✅ Seeded HOME binder: ${seeded.agreementNumber} (${seeded.umr})`);
  }

  // ── TRAVEL binder family (real Brit agreements 24/25/26 EEA6153) ───────────
  for (const tb of TRAVEL_BINDERS) {
    const seeded = await tenantScopedPrisma.binder.upsert({
      where: { id: tb.id },
      update: SEED_OVERWRITE_BINDERS ? {
        operatingTenantId: TENANT_IDS.CY,
        coverholderName: tb.coverholderName,
        coverholderPin: tb.coverholderPin,
        umr: tb.umr,
        agreementNumber: tb.agreementNumber,
        config: toInputJson(tb.config),
        lloydsReportingVer: 'V5.2',
        defaultCurrency: 'EUR',
        settlementCurrency: 'EUR',
        startDate: tb.startDate,
        endDate: tb.endDate,
        status: statusForPeriod(tb.startDate, tb.endDate),
      } : statusUpdateForPeriod(tb.startDate, tb.endDate),
      create: {
        id: tb.id,
        operatingTenantId: TENANT_IDS.CY,
        coverholderName: tb.coverholderName,
        coverholderPin: tb.coverholderPin,
        umr: tb.umr,
        agreementNumber: tb.agreementNumber,
        config: toInputJson(tb.config),
        lloydsReportingVer: 'V5.2',
        defaultCurrency: 'EUR',
        settlementCurrency: 'EUR',
        startDate: tb.startDate,
        endDate: tb.endDate,
        status: statusForPeriod(tb.startDate, tb.endDate),
      },
    });
    await reseedBinderParties(seeded.id, tb.coverholderName, tb.leadName);
    await tenantScopedPrisma.programBinderLink.upsert({
      where: { programId_binderId: { programId: travelProgram.id, binderId: seeded.id } },
      update: statusUpdateForPeriod(tb.startDate, tb.endDate),
      create: { programId: travelProgram.id, binderId: seeded.id, status: statusForPeriod(tb.startDate, tb.endDate) },
    });
    await tenantScopedPrisma.binderProductAuthority.upsert({
      where: { binderId_productCode: { binderId: seeded.id, productCode: 'TRAVEL' } },
      update: SEED_OVERWRITE_BINDERS ? {
        operatingTenantId: TENANT_IDS.CY,
        classOfBusiness: tb.classOfBusiness,
        riskCode: tb.riskCode,
        authorityClasses: [...tb.authorityClasses],
        territorialScope: [...tb.territorialScope],
        status: statusForPeriod(tb.startDate, tb.endDate),
      } : statusUpdateForPeriod(tb.startDate, tb.endDate),
      create: {
        operatingTenantId: TENANT_IDS.CY,
        binderId: seeded.id,
        productCode: 'TRAVEL',
        classOfBusiness: tb.classOfBusiness,
        riskCode: tb.riskCode,
        authorityClasses: [...tb.authorityClasses],
        territorialScope: [...tb.territorialScope],
        status: statusForPeriod(tb.startDate, tb.endDate),
      },
    });
    logger.info(`✅ Seeded TRAVEL binder: ${seeded.agreementNumber} (${seeded.umr})`);

    // HEALTH overlay — Brit Immigration Medical rides the same BRIT
    // travel binder (UMR B176023EEA6153 shown on schedule samples).
    // No new binder row, just an additional BinderProductAuthority for
    // HEALTH and a programBinderLink linking healthProgram → travel binder.
    // Same `binderId`, different `productCode` — uses the composite unique.
    await tenantScopedPrisma.programBinderLink.upsert({
      where: { programId_binderId: { programId: healthProgram.id, binderId: seeded.id } },
      update: statusUpdateForPeriod(tb.startDate, tb.endDate),
      create: { programId: healthProgram.id, binderId: seeded.id, status: statusForPeriod(tb.startDate, tb.endDate) },
    });
    await tenantScopedPrisma.binderProductAuthority.upsert({
      where: { binderId_productCode: { binderId: seeded.id, productCode: 'HEALTH' } },
      update: SEED_OVERWRITE_BINDERS ? {
        operatingTenantId: TENANT_IDS.CY,
        classOfBusiness: 'A&H',
        riskCode: 'A2',
        authorityClasses: [],
        territorialScope: ['CY'],
        status: statusForPeriod(tb.startDate, tb.endDate),
      } : statusUpdateForPeriod(tb.startDate, tb.endDate),
      create: {
        operatingTenantId: TENANT_IDS.CY,
        binderId: seeded.id,
        productCode: 'HEALTH',
        classOfBusiness: 'A&H',
        riskCode: 'A2',
        authorityClasses: [],
        territorialScope: ['CY'],
        status: statusForPeriod(tb.startDate, tb.endDate),
      },
    });
    logger.info(`✅ Overlaid HEALTH authority on BRIT binder: ${seeded.agreementNumber}`);
  }

  return motorPolicyBinder;
}

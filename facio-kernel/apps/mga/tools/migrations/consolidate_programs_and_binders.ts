import { Prisma, PrismaClient } from '@prisma/client';
import { TENANT_IDS } from '../../backend/platform/tenant/tenantConfig.js';
import {
  CANONICAL_BINDERS,
  CANONICAL_PRODUCT_CODES,
  CANONICAL_PROGRAMS,
  type CanonicalBinderSeed,
  type CanonicalProductCode,
  statusForCanonicalPeriod,
} from '../../backend/modules/policy/app/binders/canonicalProgramBinderSeed.js';

const prisma = new PrismaClient();

type PolicyRelink = {
  policyId: string;
  productCode: CanonicalProductCode;
  fromProgramId: string | null;
  toProgramId: string;
  fromBinderId: string | null;
  toBinderId: string;
  fromUmr: string | null;
  toUmr: string;
};

const apply = process.argv.includes('--apply');
const now = new Date();

const programs = CANONICAL_PROGRAMS;
const binders: CanonicalBinderSeed[] = CANONICAL_BINDERS;
const productCodes = CANONICAL_PRODUCT_CODES;
const canonicalBinderIds = new Set(binders.map((binder) => binder.id));
const canonicalProgramIds = new Set(productCodes.map((productCode) => programs[productCode].id));
const canonicalPairKeys = new Set(binders.map((binder) => `${programs[binder.productCode].id}::${binder.id}`));
const canonicalAuthorityKeys = new Set(binders.map((binder) => `${binder.id}::${binder.productCode}`));

function statusForPeriod(startDate: Date, endDate: Date): 'ACTIVE' | 'EXPIRED' | 'PENDING' {
  return statusForCanonicalPeriod(startDate, endDate, now);
}

function normalizeProductCode(value: unknown): CanonicalProductCode | null {
  const raw = String(value || '').trim().toUpperCase();
  return productCodes.includes(raw as CanonicalProductCode) ? raw as CanonicalProductCode : null;
}

function resolveBinder(productCode: CanonicalProductCode, inceptionDate: Date): CanonicalBinderSeed | null {
  return binders.find((binder) => (
    binder.productCode === productCode
    && inceptionDate >= binder.startDate
    && inceptionDate <= binder.endDate
  )) ?? null;
}

function asInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function summarizeBy<T extends string>(values: T[]): Record<T, number> {
  return values.reduce<Record<T, number>>((acc, value) => {
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {} as Record<T, number>);
}

async function ensureCanonicalRows(tx: Prisma.TransactionClient) {
  for (const productCode of productCodes) {
    await tx.productDefinition.upsert({
      where: { code: productCode },
      update: { isActive: true },
      create: {
        code: productCode,
        displayName: CANONICAL_PROGRAMS[productCode].displayName,
        icon: CANONICAL_PROGRAMS[productCode].icon,
        isActive: true,
      },
    });
    const program = programs[productCode];
    await tx.program.upsert({
      where: { id: program.id },
      update: {
        operatingTenantId: TENANT_IDS.CY,
        name: program.name,
        productType: productCode,
        status: 'ACTIVE',
      },
      create: {
        id: program.id,
        operatingTenantId: TENANT_IDS.CY,
        name: program.name,
        productType: productCode,
        status: 'ACTIVE',
      },
    });
  }

  for (const binder of binders) {
    await tx.binder.upsert({
      where: { id: binder.id },
      update: {
        operatingTenantId: TENANT_IDS.CY,
        coverholderName: binder.coverholderName,
        coverholderPin: binder.coverholderPin,
        umr: binder.umr,
        agreementNumber: binder.agreementNumber,
        config: asInputJson(binder.config),
        lloydsReportingVer: 'V5.2',
        defaultCurrency: 'EUR',
        settlementCurrency: 'EUR',
        startDate: binder.startDate,
        endDate: binder.endDate,
        status: statusForPeriod(binder.startDate, binder.endDate),
      },
      create: {
        id: binder.id,
        operatingTenantId: TENANT_IDS.CY,
        coverholderName: binder.coverholderName,
        coverholderPin: binder.coverholderPin,
        umr: binder.umr,
        agreementNumber: binder.agreementNumber,
        config: asInputJson(binder.config),
        lloydsReportingVer: 'V5.2',
        defaultCurrency: 'EUR',
        settlementCurrency: 'EUR',
        startDate: binder.startDate,
        endDate: binder.endDate,
        status: statusForPeriod(binder.startDate, binder.endDate),
      },
    });
    await tx.binderParty.deleteMany({ where: { binderId: binder.id } });
    await tx.binderParty.createMany({
      data: [
        { binderId: binder.id, role: 'appointed_coverholder', name: binder.coverholderName },
        { binderId: binder.id, role: 'lead_capacity_provider', name: binder.leadName },
      ],
    });
    await tx.programBinderLink.upsert({
      where: { programId_binderId: { programId: programs[binder.productCode].id, binderId: binder.id } },
      update: { status: statusForPeriod(binder.startDate, binder.endDate) },
      create: {
        programId: programs[binder.productCode].id,
        binderId: binder.id,
        status: statusForPeriod(binder.startDate, binder.endDate),
      },
    });
    await tx.binderProductAuthority.upsert({
      where: { binderId_productCode: { binderId: binder.id, productCode: binder.productCode } },
      update: {
        operatingTenantId: TENANT_IDS.CY,
        classOfBusiness: binder.classOfBusiness,
        riskCode: binder.riskCode,
        authorityClasses: binder.authorityClasses,
        territorialScope: binder.territorialScope,
        status: 'ACTIVE',
        effectiveFrom: binder.startDate,
        effectiveTo: binder.endDate,
      },
      create: {
        operatingTenantId: TENANT_IDS.CY,
        binderId: binder.id,
        productCode: binder.productCode,
        classOfBusiness: binder.classOfBusiness,
        riskCode: binder.riskCode,
        authorityClasses: binder.authorityClasses,
        territorialScope: binder.territorialScope,
        status: 'ACTIVE',
        effectiveFrom: binder.startDate,
        effectiveTo: binder.endDate,
      },
    });
  }
}

async function buildRelinkPlan(): Promise<{ relinks: PolicyRelink[]; blockers: string[] }> {
  const policies = await prisma.policy.findMany({
    select: {
      id: true,
      productType: true,
      inceptionDate: true,
      programId: true,
      binderId: true,
      umr: true,
    },
    orderBy: { createdAt: 'asc' },
  });
  const relinks: PolicyRelink[] = [];
  const blockers: string[] = [];

  for (const policy of policies) {
    const productCode = normalizeProductCode(policy.productType);
    if (!productCode) {
      blockers.push(`Policy ${policy.id} has unsupported productType '${String(policy.productType || '')}'.`);
      continue;
    }
    const binder = resolveBinder(productCode, policy.inceptionDate);
    if (!binder) {
      blockers.push(`Policy ${policy.id} (${productCode}) inception ${policy.inceptionDate.toISOString()} is outside canonical binder windows.`);
      continue;
    }
    const program = programs[productCode];
    if (policy.programId !== program.id || policy.binderId !== binder.id || String(policy.umr || '') !== binder.umr) {
      relinks.push({
        policyId: policy.id,
        productCode,
        fromProgramId: policy.programId,
        toProgramId: program.id,
        fromBinderId: policy.binderId,
        toBinderId: binder.id,
        fromUmr: policy.umr,
        toUmr: binder.umr,
      });
    }
  }

  return { relinks, blockers };
}

async function applyRelinks(tx: Prisma.TransactionClient, relinks: PolicyRelink[]) {
  for (const relink of relinks) {
    await tx.policy.update({
      where: { id: relink.policyId },
      data: {
        programId: relink.toProgramId,
        binderId: relink.toBinderId,
        umr: relink.toUmr,
      },
    });
    await tx.riskTransaction.updateMany({
      where: { policyId: relink.policyId },
      data: {
        programId: relink.toProgramId,
        binderId: relink.toBinderId,
      },
    });
  }
}

async function removeNonCanonicalRows(tx: Prisma.TransactionClient) {
  await tx.programBinderLink.deleteMany({
    where: {
      NOT: [...canonicalPairKeys].map((key) => {
        const [programId, binderId] = key.split('::');
        return { programId, binderId };
      }),
    },
  });

  await tx.binderProductAuthority.deleteMany({
    where: {
      OR: [
        { binderId: { in: [...canonicalBinderIds] } },
        { productCode: { in: productCodes } },
      ],
      NOT: [...canonicalAuthorityKeys].map((key) => {
        const [binderId, productCode] = key.split('::');
        return { binderId, productCode };
      }),
    },
  });

  const nonCanonicalBinders = await tx.binder.findMany({
    where: { id: { notIn: [...canonicalBinderIds] } },
    select: {
      id: true,
      _count: {
        select: {
          policies: true,
          riskTransactions: true,
          programLinks: true,
        },
      },
    },
  });
  const blockedBinders = nonCanonicalBinders.filter((binder) => (
    binder._count.policies > 0 || binder._count.riskTransactions > 0 || binder._count.programLinks > 0
  ));
  if (blockedBinders.length > 0) {
    throw new Error(`Non-canonical binders still referenced: ${blockedBinders.map((binder) => binder.id).join(', ')}`);
  }
  await tx.binder.deleteMany({ where: { id: { notIn: [...canonicalBinderIds] } } });

  const nonCanonicalPrograms = await tx.program.findMany({
    where: {
      productType: { in: productCodes },
      id: { notIn: [...canonicalProgramIds] },
    },
    select: {
      id: true,
      _count: {
        select: {
          policies: true,
          riskTransactions: true,
          binderLinks: true,
        },
      },
    },
  });
  const blockedPrograms = nonCanonicalPrograms.filter((program) => (
    program._count.policies > 0 || program._count.riskTransactions > 0 || program._count.binderLinks > 0
  ));
  if (blockedPrograms.length > 0) {
    throw new Error(`Non-canonical programs still referenced: ${blockedPrograms.map((program) => program.id).join(', ')}`);
  }
  await tx.program.deleteMany({
    where: {
      productType: { in: productCodes },
      id: { notIn: [...canonicalProgramIds] },
    },
  });
}

async function verifyPostState() {
  const [
    nullPolicyBinders,
    nullPolicyPrograms,
    badPolicyBinders,
    badPolicyPrograms,
    badRiskBinders,
    badRiskPrograms,
    nonCanonicalProductPrograms,
    nonCanonicalBinders,
    nonCanonicalLinks,
  ] = await Promise.all([
    prisma.policy.count({ where: { productType: { in: productCodes }, binderId: null } }),
    prisma.policy.count({ where: { productType: { in: productCodes }, programId: null } }),
    prisma.policy.count({ where: { productType: { in: productCodes }, binderId: { notIn: [...canonicalBinderIds] } } }),
    prisma.policy.count({ where: { productType: { in: productCodes }, programId: { notIn: [...canonicalProgramIds] } } }),
    prisma.riskTransaction.count({ where: { policy: { productType: { in: productCodes } }, binderId: { notIn: [...canonicalBinderIds] } } }),
    prisma.riskTransaction.count({ where: { policy: { productType: { in: productCodes } }, programId: { notIn: [...canonicalProgramIds] } } }),
    prisma.program.count({ where: { productType: { in: productCodes }, id: { notIn: [...canonicalProgramIds] } } }),
    prisma.binder.count({ where: { id: { notIn: [...canonicalBinderIds] } } }),
    prisma.programBinderLink.findMany({
      select: { programId: true, binderId: true },
    }).then((links) => links.filter((link) => !canonicalPairKeys.has(`${link.programId}::${link.binderId}`)).length),
  ]);

  return {
    nullPolicyBinders,
    nullPolicyPrograms,
    badPolicyBinders,
    badPolicyPrograms,
    badRiskBinders,
    badRiskPrograms,
    nonCanonicalProductPrograms,
    nonCanonicalBinders,
    nonCanonicalLinks,
  };
}

async function main() {
  const [programCount, binderCount, policyCount, riskTransactionCount] = await Promise.all([
    prisma.program.count(),
    prisma.binder.count(),
    prisma.policy.count(),
    prisma.riskTransaction.count(),
  ]);
  const { relinks, blockers } = await buildRelinkPlan();
  const relinksByProduct = summarizeBy(relinks.map((relink) => relink.productCode));

  const before = {
    programs: programCount,
    binders: binderCount,
    policies: policyCount,
    riskTransactions: riskTransactionCount,
    relinks: relinks.length,
    relinksByProduct,
    blockers,
  };

  if (blockers.length > 0) {
    process.stdout.write(JSON.stringify({ mode: apply ? 'apply-blocked' : 'dry-run-blocked', before }, null, 2) + '\n');
    process.exitCode = 1;
    return;
  }

  if (apply) {
    await prisma.$transaction(async (tx) => {
      await ensureCanonicalRows(tx);
      await applyRelinks(tx, relinks);
      await removeNonCanonicalRows(tx);
    }, { timeout: 120_000 });
  }

  const postState = apply ? await verifyPostState() : null;
  process.stdout.write(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    before,
    target: {
      programs: Object.values(programs).map((program) => ({ id: program.id, productCode: program.productCode })),
      binders: binders.map((binder) => ({ id: binder.id, productCode: binder.productCode, startDate: binder.startDate, endDate: binder.endDate })),
    },
    postState,
  }, null, 2) + '\n');

  if (postState && Object.values(postState).some((value) => value !== 0)) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    process.stderr.write(`[consolidate_programs_and_binders] FAILED: ${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

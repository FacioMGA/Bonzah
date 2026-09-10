/**
 * Backfill BinderProductAuthority from active ProgramBinderLink rows.
 *
 * For every (binder, product) pair reachable via an ACTIVE ProgramBinderLink
 * whose program has a productType, upsert an ACTIVE BinderProductAuthority
 * with sensible Lloyd's defaults derived from the product code.
 *
 * Run: npx tsx tools/migrations/backfill_binder_product_authorities.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Conservative Lloyd's reporting defaults per product code. Ops can edit via
// BO or the binder admin API after backfill.
const PRODUCT_DEFAULTS: Record<string, { classOfBusiness: string; riskCode: string; authorityClasses: string[] }> = {
  MOTOR:  { classOfBusiness: 'MOTOR',    riskCode: 'MC', authorityClasses: ['TPBI', 'TPPD', 'OD'] },
  HOME:   { classOfBusiness: 'PROPERTY', riskCode: 'HH', authorityClasses: [] },
  TRAVEL: { classOfBusiness: 'TRAVEL',   riskCode: 'TE', authorityClasses: [] },
};

async function main() {
  const links = await prisma.programBinderLink.findMany({
    where: { status: 'ACTIVE' },
    include: {
      program:  { select: { productType: true, name: true } },
      binder:   { select: { id: true, agreementNumber: true } },
    },
  });

  const pairs = new Map<string, { binderId: string; productCode: string }>();
  for (const link of links) {
    const productCode = String(link.program?.productType || '').trim().toUpperCase();
    if (!productCode) continue;
    const key = `${link.binderId}::${productCode}`;
    if (!pairs.has(key)) pairs.set(key, { binderId: link.binderId, productCode });
  }

  let created = 0;
  let updated = 0;
  for (const { binderId, productCode } of pairs.values()) {
    const defaults = PRODUCT_DEFAULTS[productCode] || {
      classOfBusiness: productCode,
      riskCode: null as string | null,
      authorityClasses: [] as string[],
    };
    const existing = await prisma.binderProductAuthority.findUnique({
      where: { binderId_productCode: { binderId, productCode } },
    });
    if (existing) {
      await prisma.binderProductAuthority.update({
        where: { id: existing.id },
        data: { status: 'ACTIVE' },
      });
      updated += 1;
    } else {
      await prisma.binderProductAuthority.create({
        data: {
          binderId,
          productCode,
          classOfBusiness: defaults.classOfBusiness,
          riskCode: defaults.riskCode ?? undefined,
          authorityClasses: defaults.authorityClasses,
          territorialScope: ['CY'], // Abbeygate default — edit per deployment
          status: 'ACTIVE',
        },
      });
      created += 1;
    }
  }

  console.log(`[backfill_binder_product_authorities] pairs=${pairs.size} created=${created} updated=${updated}`);
}

main()
  .catch((err) => {
    console.error('[backfill_binder_product_authorities] FAILED', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

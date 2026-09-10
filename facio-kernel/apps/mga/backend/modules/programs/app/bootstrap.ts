import type { Prisma } from '@prisma/client';
import { prisma, tenantScopedPrisma } from '../../../platform/db/connection.js';
import { runWithOperatingTenant } from '../../../platform/tenant/tenantAls.js';
import { buildTenantConfigFromEnv } from '../../../platform/tenant/tenantConfigForCli.js';
import { logger } from '../../../platform/utils/logger.js';

export async function ensureDefaultPrograms(): Promise<void> {
  // Bootstrap runs once at startup, before any HTTP request can establish
  // tenant ALS — see ADR-0019. Use the explicit CLI-bootstrap helper.
  await runWithOperatingTenant(buildTenantConfigFromEnv(), async () => {
    const active = await tenantScopedPrisma.program.findFirst({
      where: { status: 'ACTIVE' },
      select: { id: true, name: true },
      orderBy: { updatedAt: 'desc' },
    });
    if (active) return;

    const productDefs = await prisma.productDefinition.findMany({
      where: { isActive: true },
      select: { code: true, displayName: true },
    });

    if (productDefs.length === 0) {
      logger.warn('No active ProductDefinitions found — skipping program bootstrap');
      return;
    }

    for (const product of productDefs) {
      const name = `${product.displayName} Scheme`;
      const existing = await tenantScopedPrisma.program.findFirst({
        where: { name },
        select: { id: true },
        orderBy: { updatedAt: 'desc' },
      });

      if (existing) {
        await tenantScopedPrisma.program.update({
          where: { id: existing.id },
          data: { status: 'ACTIVE', productType: product.code },
        });
        logger.info(`Bootstrapped ACTIVE program: ${name} (re-activated)`);
      } else {
        await tenantScopedPrisma.program.create({
          data: {
            name,
            status: 'ACTIVE',
            productType: product.code,
            metadata: JSON.parse(JSON.stringify({
              productType: product.code,
              bootstrap: { createdAt: new Date().toISOString(), reason: 'auto-created from ProductDefinition' },
            })),
          } as unknown as Prisma.ProgramUncheckedCreateInput,
        });
        logger.info(`Bootstrapped ACTIVE program: ${name} (created)`);
      }
    }
  });
}


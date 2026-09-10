import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import type { TenantScopedTx } from '../../../platform/db/connection.js';
import { readProgrammeScopeBindings, assertRetainedScopeBindings } from '../infra/questionScopeBindings.js';

/** Explicit local opt-in. All synthetic tenants/programmes/binders roll back in one transaction. */
describe.runIf(process.env.PLATFORM_TENANT_PG_TEST === '1')('PostgreSQL compiler 4 scope catalogue', () => {
  it('uses real RLS to isolate programme binder authorities and rejects withdrawn mappings without committing any rows', async () => {
    const url = new URL(process.env.DATABASE_URL!);
    expect(['localhost', '127.0.0.1']).toContain(url.hostname); expect(url.pathname).toBe('/facio_gen2');
    const db = new PrismaClient({ log: [] }), rollback = new Error('intentional-scope-rollback');
    const tenantIds = [randomUUID(), randomUUID()];
    try {
      const [role] = await db.$queryRaw<Array<{ rolsuper: boolean; rolbypassrls: boolean }>>`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
      expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
      const productBefore = await db.productDefinition.findUnique({ where: { code: 'COMMERCIAL' } });
      await expect(db.$transaction(async (tx) => {
        // A fresh CI database has no product catalogue. Create this prerequisite in the same rollback transaction.
        await tx.productDefinition.upsert({ where: { code: 'COMMERCIAL' }, create: { code: 'COMMERCIAL', displayName: 'Synthetic scope regression' }, update: {} });
        const created: { tenantId: string; programmeId: string; binderId: string; authorityId: string }[] = [];
        for (const tenantId of tenantIds) {
          await tx.tenant.create({ data: { id: tenantId, tenantSlug: `scope-test-${tenantId}`, countryCode: 'CY', country: 'Cyprus', currency: 'EUR', kind: 'SYNTHETIC', status: 'ACTIVE', legalPack: 'synthetic', publicBaseUrl: 'https://example.invalid', fromEmail: 'test@example.invalid', brandLogos: {}, iptJson: {}, adminFee: 0, defaultBrokerName: 'Synthetic scope regression', priorityCountries: ['Cyprus'], allowedRiskCountries: ['Cyprus'], defaultNationality: 'Cyprus', defaultDriversLicenseCountry: 'Cyprus' } });
          await tx.$executeRaw`SELECT set_config('app.operating_tenant_id', ${tenantId}, true)`;
          const programme = await tx.program.create({ data: { operatingTenantId: tenantId, name: 'Synthetic scope regression', productType: 'COMMERCIAL', status: 'ACTIVE' } });
          const binder = await tx.binder.create({ data: { operatingTenantId: tenantId, coverholderName: 'Synthetic scope regression', agreementNumber: 'SAME-REFERENCE', umr: `scope-${tenantId}`, defaultCurrency: 'EUR', settlementCurrency: 'EUR', status: 'ACTIVE' } });
          await tx.programBinderLink.create({ data: { programId: programme.id, binderId: binder.id, status: 'ACTIVE' } });
          const authority = await tx.binderProductAuthority.create({ data: { operatingTenantId: tenantId, binderId: binder.id, productCode: 'COMMERCIAL', classOfBusiness: 'training', status: 'ACTIVE' } });
          created.push({ tenantId, programmeId: programme.id, binderId: binder.id, authorityId: authority.id });
        }
        for (const [index, row] of created.entries()) {
          await tx.$executeRaw`SELECT set_config('app.operating_tenant_id', ${row.tenantId}, true)`;
          // The canonical helper needs the same Prisma method contract; this test establishes the real GUC directly inside its rollback transaction.
          const scoped = tx as unknown as TenantScopedTx;
          const catalogue = await readProgrammeScopeBindings(scoped, row.tenantId, row.programmeId, 'COMMERCIAL');
          expect(catalogue).toEqual([{ binderId: row.binderId, name: 'SAME-REFERENCE', authorityIds: [row.authorityId] }]);
          const other = created[1 - index];
          expect(await readProgrammeScopeBindings(scoped, other.tenantId, other.programmeId, 'COMMERCIAL')).toEqual([]);
          expect(await tx.binderProductAuthority.findUnique({ where: { id: other.authorityId } })).toBeNull();
          await tx.programBinderLink.update({ where: { programId_binderId: { programId: row.programmeId, binderId: row.binderId } }, data: { status: 'INACTIVE' } });
          expect(() => assertRetainedScopeBindings(catalogue, [])).toThrow(/tenant/);
          expect(await readProgrammeScopeBindings(scoped, row.tenantId, row.programmeId, 'COMMERCIAL')).toEqual([]);
        }
        throw rollback;
      }, { timeout: 15000 })).rejects.toBe(rollback);
      expect(await db.tenant.count({ where: { id: { in: tenantIds } } })).toBe(0);
      expect(await db.productDefinition.findUnique({ where: { code: 'COMMERCIAL' } })).toEqual(productBefore);
    } finally { await db.$disconnect(); }
  });
});

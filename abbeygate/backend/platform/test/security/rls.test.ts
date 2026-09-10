import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { prisma } from '../../db/connection.js';
import { TENANT_IDS } from '../../tenant/tenantConfig.js';

const RLS_TEST_ROLE = 'rls_tester_role';
const now = () => new Date();
const describeRls = process.env.INTEGRATION_TESTS === 'true' ? describe : describe.skip;

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function withOperatingTenant<T>(tenantId: string | null, run: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL ROLE ${RLS_TEST_ROLE}`);
    if (tenantId) {
      await tx.$executeRaw`SELECT set_config('app.operating_tenant_id', ${tenantId}, true)`;
    }
    return run(tx);
  });
}

async function provisionRlsPolicy(table: string): Promise<void> {
  await prisma.$executeRawUnsafe(`DROP POLICY IF EXISTS op_tenant_isolation ON ${table}`);
  await prisma.$executeRawUnsafe(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
  await prisma.$executeRawUnsafe(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
  await prisma.$executeRawUnsafe(`
    CREATE POLICY op_tenant_isolation ON ${table}
      USING ("operatingTenantId" = current_setting('app.operating_tenant_id', true))
  `);
}

async function disableRlsPolicy(table: string): Promise<void> {
  await prisma.$executeRawUnsafe(`DROP POLICY IF EXISTS op_tenant_isolation ON ${table}`);
  await prisma.$executeRawUnsafe(`ALTER TABLE ${table} NO FORCE ROW LEVEL SECURITY`);
  await prisma.$executeRawUnsafe(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);
}

describeRls('Row-Level Security (operating tenant)', () => {
  let cyAccountId = '';
  let ptAccountId = '';
  let cyPolicyId = '';
  let ptPolicyId = '';
  let cyPolicyHolderId = '';
  let ptPolicyHolderId = '';

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${RLS_TEST_ROLE}') THEN
          CREATE ROLE ${RLS_TEST_ROLE};
        END IF;
      END
      $$;
    `);
    await prisma.$executeRawUnsafe(`GRANT ${RLS_TEST_ROLE} TO CURRENT_USER`);
    await prisma.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${RLS_TEST_ROLE}`);
    await prisma.$executeRawUnsafe(`GRANT SELECT, UPDATE, DELETE ON TABLE accounts, policies, entities, policy_holders TO ${RLS_TEST_ROLE}`);

    await provisionRlsPolicy('accounts');
    await provisionRlsPolicy('policies');
    await provisionRlsPolicy('entities');
    await provisionRlsPolicy('policy_holders');

    const cyAccount = await prisma.account.create({
      data: { operatingTenantId: TENANT_IDS.CY, name: 'RLS Test Account CY', kind: 'CUSTOMER' },
    });
    cyAccountId = cyAccount.id;
    const ptAccount = await prisma.account.create({
      data: { operatingTenantId: TENANT_IDS.PT, name: 'RLS Test Account PT', kind: 'CUSTOMER' },
    });
    ptAccountId = ptAccount.id;

    await prisma.entity.create({
      data: { operatingTenantId: TENANT_IDS.CY, accountId: cyAccountId, type: 'PERSON', name: 'RLS Entity CY' },
    });
    await prisma.entity.create({
      data: { operatingTenantId: TENANT_IDS.PT, accountId: ptAccountId, type: 'PERSON', name: 'RLS Entity PT' },
    });

    const cyHolder = await prisma.policyHolder.create({
      data: {
        operatingTenantId: TENANT_IDS.CY,
        name: 'RLS Holder CY',
        address: 'Cyprus',
        contact: 'rls-cy@example.com',
      },
    });
    cyPolicyHolderId = cyHolder.id;
    const ptHolder = await prisma.policyHolder.create({
      data: {
        operatingTenantId: TENANT_IDS.PT,
        name: 'RLS Holder PT',
        address: 'Portugal',
        contact: 'rls-pt@example.com',
      },
    });
    ptPolicyHolderId = ptHolder.id;

    const cyPolicy = await prisma.policy.create({
      data: {
        operatingTenantId: TENANT_IDS.CY,
        accountId: cyAccountId,
        policyNumber: `RLS-CY-${Date.now()}`,
        policyHolderId: cyPolicyHolderId,
        status: 'ACTIVE',
        productType: 'MOTOR',
        inceptionDate: now(),
        expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      },
    });
    cyPolicyId = cyPolicy.id;
    const ptPolicy = await prisma.policy.create({
      data: {
        operatingTenantId: TENANT_IDS.PT,
        accountId: ptAccountId,
        policyNumber: `RLS-PT-${Date.now()}`,
        policyHolderId: ptPolicyHolderId,
        status: 'ACTIVE',
        productType: 'MOTOR',
        inceptionDate: now(),
        expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      },
    });
    ptPolicyId = ptPolicy.id;
  });

  afterAll(async () => {
    await disableRlsPolicy('policy_holders');
    await disableRlsPolicy('entities');
    await disableRlsPolicy('policies');
    await disableRlsPolicy('accounts');

    await prisma.policy.deleteMany({ where: { id: { in: [cyPolicyId, ptPolicyId].filter(Boolean) } } });
    await prisma.entity.deleteMany({ where: { accountId: { in: [cyAccountId, ptAccountId].filter(Boolean) } } });
    await prisma.policyHolder.deleteMany({ where: { id: { in: [cyPolicyHolderId, ptPolicyHolderId].filter(Boolean) } } });
    await prisma.account.deleteMany({ where: { id: { in: [cyAccountId, ptAccountId].filter(Boolean) } } });
  });

  test('CY tenant sees only CY policies', async () => {
    await withOperatingTenant(TENANT_IDS.CY, async (tx) => {
      const policies = await tx.policy.findMany({
        where: { id: { in: [cyPolicyId, ptPolicyId] } },
        select: { id: true, operatingTenantId: true },
      });
      expect(policies).toHaveLength(1);
      expect(policies[0]).toMatchObject({ id: cyPolicyId, operatingTenantId: TENANT_IDS.CY });
    });
  });

  test('PT tenant sees only PT policies', async () => {
    await withOperatingTenant(TENANT_IDS.PT, async (tx) => {
      const policies = await tx.policy.findMany({
        where: { id: { in: [cyPolicyId, ptPolicyId] } },
        select: { id: true, operatingTenantId: true },
      });
      expect(policies).toHaveLength(1);
      expect(policies[0]).toMatchObject({ id: ptPolicyId, operatingTenantId: TENANT_IDS.PT });
    });
  });

  test('findUnique returns null for another operating tenant policy', async () => {
    await withOperatingTenant(TENANT_IDS.CY, async (tx) => {
      const policy = await tx.policy.findUnique({ where: { id: ptPolicyId } });
      expect(policy).toBeNull();
    });
  });

  test('cannot update another operating tenant policy', async () => {
    await withOperatingTenant(TENANT_IDS.CY, async (tx) => {
      const result = await tx.policy.updateMany({ where: { id: ptPolicyId }, data: { status: 'CANCELLED' } });
      expect(result.count).toBe(0);
    });
    const unchanged = await prisma.policy.findUnique({ where: { id: ptPolicyId } });
    expect(unchanged?.status).toBe('ACTIVE');
  });

  test('cannot delete another operating tenant policy', async () => {
    await withOperatingTenant(TENANT_IDS.CY, async (tx) => {
      const result = await tx.policy.deleteMany({ where: { id: ptPolicyId } });
      expect(result.count).toBe(0);
    });
    const stillExists = await prisma.policy.findUnique({ where: { id: ptPolicyId } });
    expect(stillExists).not.toBeNull();
  });

  test('RLS applies to accounts, entities, and policy holders', async () => {
    await withOperatingTenant(TENANT_IDS.CY, async (tx) => {
      const accounts = await tx.account.findMany({ where: { id: { in: [cyAccountId, ptAccountId] } } });
      const entities = await tx.entity.findMany({ where: { accountId: { in: [cyAccountId, ptAccountId] } } });
      const holders = await tx.policyHolder.findMany({ where: { id: { in: [cyPolicyHolderId, ptPolicyHolderId] } } });
      expect(accounts.map((row) => row.id)).toEqual([cyAccountId]);
      expect(entities.every((row) => row.operatingTenantId === TENANT_IDS.CY)).toBe(true);
      expect(holders.map((row) => row.id)).toEqual([cyPolicyHolderId]);
    });
  });

  test('raw query aggregation cannot bypass operating tenant RLS', async () => {
    await withOperatingTenant(TENANT_IDS.CY, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ operatingTenantId: string; total: bigint }>>`
        SELECT "operatingTenantId", COUNT(*)::bigint AS total
        FROM policies
        WHERE id IN (${cyPolicyId}, ${ptPolicyId})
        GROUP BY "operatingTenantId"
      `;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.operatingTenantId).toBe(TENANT_IDS.CY);
    });
  });

  test('missing operating tenant GUC hides rows fail-closed', async () => {
    await withOperatingTenant(null, async (tx) => {
      const rows = await tx.policy.findMany({ where: { id: { in: [cyPolicyId, ptPolicyId] } } });
      expect(rows).toHaveLength(0);
    });
  });

  test('tenant isolation holds under pooled parallel load', async () => {
    const tasks: Array<Promise<void>> = [];
    for (let i = 0; i < 25; i += 1) {
      tasks.push(withOperatingTenant(TENANT_IDS.CY, async (tx) => {
        const rows = await tx.policy.findMany({
          where: { id: { in: [cyPolicyId, ptPolicyId] } },
          select: { operatingTenantId: true },
        });
        expect(rows.every((row) => row.operatingTenantId === TENANT_IDS.CY)).toBe(true);
      }));
      tasks.push(withOperatingTenant(TENANT_IDS.PT, async (tx) => {
        const rows = await tx.policy.findMany({
          where: { id: { in: [cyPolicyId, ptPolicyId] } },
          select: { operatingTenantId: true },
        });
        expect(rows.every((row) => row.operatingTenantId === TENANT_IDS.PT)).toBe(true);
      }));
    }
    await Promise.all(tasks);
  });
});

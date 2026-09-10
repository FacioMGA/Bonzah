import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { removeFreshMigrationSeedConfiguration } from '../infra/bootstrap.js';

const migrationSequences = [
  { key: 'PLATFORM:GLOBAL:CERTIFICATE', next: 825_000_000 },
  { key: 'PLATFORM:GLOBAL:GREENCARD', next: 824_000_000 },
  { key: 'PLATFORM:GLOBAL:POLICY', next: 5_000_001 },
  { key: 'PLATFORM:GLOBAL:QUOTE', next: 5_000_001 },
];

function freshStore(sequences: typeof migrationSequences) {
  const tenantRead = vi.fn(async () => []);
  const tx = {
    $executeRaw: vi.fn(async () => 0),
    $executeRawUnsafe: vi.fn(async () => 0),
    $queryRaw: vi.fn(async () => ['_prisma_migrations', 'policy_number_sequences', 'binder_product_authorities', 'binders', 'product_channel_settings', 'product_definitions', 'program_binder_links', 'programs', 'tenants'].map(tablename => ({ tablename }))),
    $queryRawUnsafe: vi.fn(async (sql: string) => [{ count: BigInt(sql.includes('policy_number_sequences') ? sequences.length : sql.includes('_prisma_migrations') ? 53 : 0) }]),
    policyNumberSequence: { findMany: vi.fn(async () => sequences) },
    tenant: { findMany: tenantRead },
  };
  return { prisma: { $transaction: async (work: (client: typeof tx) => unknown) => work(tx) } as unknown as PrismaClient, tenantRead };
}

describe('fresh platform initialization migration counters', () => {
  it('retains the exact four unconsumed migration counters while admitting an otherwise empty database', async () => {
    const { prisma } = freshStore(migrationSequences);
    await expect(removeFreshMigrationSeedConfiguration(prisma)).resolves.toMatchObject({ alreadyClean: true, businessRows: 0 });
  });

  it.each([
    ['consumed', migrationSequences.map(row => row.key.endsWith(':POLICY') ? { ...row, next: row.next + 1 } : row)],
    ['foreign', migrationSequences.map(row => row.key.endsWith(':QUOTE') ? { ...row, key: 'FOREIGN:QUOTE' } : row)],
    ['missing', []],
  ])('refuses %s counters before tenant cleanup', async (_name, sequences) => {
    const { prisma, tenantRead } = freshStore(sequences);
    await expect(removeFreshMigrationSeedConfiguration(prisma)).rejects.toMatchObject({ code: 'FRESH_DATABASE_REQUIRED' });
    expect(tenantRead).not.toHaveBeenCalled();
  });
});

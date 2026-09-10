import { prisma } from '../backend/db/connection.js';

type Snapshot = Record<string, unknown>;

function asRecord(value: unknown): Snapshot {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Snapshot) : {};
}

async function run() {
  const rows = await prisma.policy.findMany({
    select: {
      id: true,
      status: true,
      issuedAt: true,
      inceptionDate: true,
      expiryDate: true,
      updatedAt: true,
      stateCurrent: { select: { snapshot: true } },
    },
  });

  for (const row of rows) {
    const snap = asRecord(row.stateCurrent?.snapshot);
    const lifecycleMeta = asRecord(snap.lifecycleMeta);
    const status = String(row.status || '').toUpperCase();

    if ((status === 'ISSUED' || status === 'ACTIVE') && !lifecycleMeta.issuedAt) {
      lifecycleMeta.issuedAt = (row.issuedAt || row.updatedAt).toISOString();
    }
    if (status === 'ACTIVE' && !lifecycleMeta.activatedAt) {
      lifecycleMeta.activatedAt = (row.inceptionDate || row.updatedAt).toISOString();
    }
    if (status === 'EXPIRED' && !lifecycleMeta.expiredAt) {
      lifecycleMeta.expiredAt = (row.expiryDate || row.updatedAt).toISOString();
    }
    if (status === 'CANCELLED' && !lifecycleMeta.cancelledAt) {
      lifecycleMeta.cancelledAt = row.updatedAt.toISOString();
    }

    await prisma.policyStateCurrent.upsert({
      where: { policyId: row.id },
      update: { snapshot: { ...snap, lifecycleMeta } },
      create: { policyId: row.id, snapshot: { lifecycleMeta } },
    });
  }

  // eslint-disable-next-line no-console
  console.log(`[backfillLifecycleTransitionTimestamps] updated ${rows.length} policies`);
}

run()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });


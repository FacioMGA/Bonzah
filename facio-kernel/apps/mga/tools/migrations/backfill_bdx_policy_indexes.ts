import { prisma } from '../backend/db/connection.js';
import { rebuildPolicyListIndexRow } from '../backend/core/projections/policyListIndex.js';

async function main() {
  const states = await prisma.policyStateCurrent.findMany({
    select: { policyId: true, snapshot: true },
    take: 5000,
  });

  const importedPolicyIds = new Set<string>();
  for (const s of states) {
    try {
      const snap = typeof s.snapshot === 'string' ? JSON.parse(s.snapshot) : s.snapshot;
      if (snap?.bdxImport?.rowKey) importedPolicyIds.add(s.policyId);
    } catch {
      // ignore malformed snapshots
    }
  }

  let rebuilt = 0;
  for (const policyId of importedPolicyIds) {
    await rebuildPolicyListIndexRow(policyId);
    rebuilt += 1;
  }

  console.log(JSON.stringify({ importedPolicyCount: importedPolicyIds.size, rebuilt }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

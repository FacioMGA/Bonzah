import { PrismaClient } from '@prisma/client';
import { ApiKeyService } from '../../backend/core/auth/apiKeyService.js';

const prisma = new PrismaClient();

async function run() {
  const p = await prisma.policy.findFirst({
    where: { productType: 'MOTOR', accountId: { not: null } },
  });
  if (!p) {
    console.log('No policies');
    return;
  }

  const keyObj = await ApiKeyService.createApiKey(p.accountId, 'Test Claims Account');
  console.log(`NEW_RAW_KEY=${keyObj.rawKey}`);
  console.log(`POLICY_ID=${p.id}`);
}

run().catch(console.error).finally(() => prisma.$disconnect());

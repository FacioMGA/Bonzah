import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function run() {
  const account = await prisma.apiAccount.findFirst({
    where: { key: 'facio_825e46664f4731c555b6f050b140a0f8a2cdfd57c067fd09fe9154d0b78b14be' },
  });
  if (!account) {
    console.log('Key not found');
    return;
  }
  const p = await prisma.policy.findFirst({
    where: { accountId: account.id, productType: 'MOTOR' },
  });
  console.log(p ? p.id : 'No policy found for account');
}

run().catch(console.error).finally(() => prisma.$disconnect());

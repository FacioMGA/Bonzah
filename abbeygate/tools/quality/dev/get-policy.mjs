import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function run() {
  const p = await prisma.policy.findFirst({ where: { productType: 'MOTOR' } });
  console.log(p?.id || 'No policy found');
}

run().catch(console.error).finally(() => prisma.$disconnect());

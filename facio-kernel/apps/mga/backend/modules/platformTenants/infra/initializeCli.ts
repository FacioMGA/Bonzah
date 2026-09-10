import { PrismaClient } from '@prisma/client';
import { bootstrapPlatformOperators, removeFreshMigrationSeedConfiguration } from './bootstrap.js';

// This explicit operator command is excluded from startup. It accepts no customer source DB.
if (process.argv[2] !== '--initialize-new-platform') throw new Error('Explicit --initialize-new-platform is required');
const prisma = new PrismaClient({ log: [] });
try {
  const existing = await prisma.platformTenantCommand.findUnique({ where: { organizationId_operation_idempotencyKey: { organizationId: '4a2de0b7-e6e4-4d07-95fb-f997dbe5b937', operation: 'bootstrap', idempotencyKey: '4a2de0b7-e6e4-4d07-95fb-f997dbe5b937' } } });
  const cleanup = existing ? { skipped: 'Immutable bootstrap receipt already exists' } : await removeFreshMigrationSeedConfiguration(prisma);
  const bootstrap = await bootstrapPlatformOperators(prisma, {
    organizationId: '4a2de0b7-e6e4-4d07-95fb-f997dbe5b937', slug: 'facio-sandbox', name: 'Facio Sandbox',
    members: [
      { email: 'uriel@facio.io', role: 'OWNER' }, { email: 'yoni@facio.io', role: 'ADMIN' }, { email: 'liav@facio.io', role: 'ADMIN' },
      { email: 'amit@facio.io', role: 'BUILDER' }, { email: 'yahav@facio.io', role: 'BUILDER' }, { email: 'yuval@facio.io', role: 'BUILDER' },
    ],
  });
  console.log(JSON.stringify({ cleanup, bootstrap }));
} finally { await prisma.$disconnect(); }

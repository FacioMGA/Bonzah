#!/usr/bin/env node
import { readChangedNameStatus } from './lib/ci-diff-range.mjs';

const changed = readChangedNameStatus();

const schemaChanged = changed.some((entry) => entry.file === 'prisma/schema.prisma');
const migrationChanged = changed.some((entry) =>
  entry.file.startsWith('prisma/migrations/') && entry.file.endsWith('/migration.sql'),
);

if (schemaChanged && !migrationChanged) {
  console.error(
    [
      '[prisma-schema-change-requires-migration] prisma/schema.prisma changed without a matching migration.',
      'Create a Prisma migration for real schema evolution (for example: `npm run db:migrate:dev -- --name add_policy_column`).',
      'Use `db:push:dev` only for disposable local scratch databases.',
    ].join('\n'),
  );
  process.exit(1);
}

console.log('[prisma-schema-change-requires-migration] OK');

// Canonical mock helper for `backend/platform/db/connection.ts`.
//
// Production exports two clients from connection.ts:
//   - `prisma`              — bare PrismaClient (admin / non-tenant-scoped models)
//   - `tenantScopedPrisma`  — Prisma extension that injects `operatingTenantId`
//                              from per-request ALS context (ADR-0009)
//
// Most modules now import `tenantScopedPrisma`. Tests that previously mocked
// only `prisma` therefore break with:
//
//   "No 'tenantScopedPrisma' export is defined on the connection.js mock"
//
// The mechanical fix is to expose the SAME mock client under both names so the
// production module surface is satisfied without test-side branching. Use this
// helper to make that intent explicit and to keep the pattern consistent.
//
// vitest hoists `vi.mock()` factories above all imports, so this helper is
// designed to be safe to call inside a hoisted factory: it only forwards a
// reference, no module-level side effects, no imports of vitest itself.
//
// Example (preferred):
//
//   import { vi } from 'vitest';
//   import { exposeBothPrismaClients } from '@server/platform/test/fixtures/dbConnectionMock.js';
//
//   vi.mock('@server/platform/db/connection.js', () => {
//     const prisma = {
//       policy: { findUnique: vi.fn(), update: vi.fn() },
//     };
//     return exposeBothPrismaClients(prisma);
//   });
//
// Or inline (functionally identical, no import needed):
//
//   vi.mock('@server/platform/db/connection.js', () => {
//     const prisma = { ... };
//     return { prisma, tenantScopedPrisma: prisma };
//   });
//
// Both forms are accepted; pick the inline form when the factory body is short.
export function exposeBothPrismaClients<T extends object>(client: T): {
  readonly prisma: T;
  readonly tenantScopedPrisma: T;
} {
  return { prisma: client, tenantScopedPrisma: client };
}

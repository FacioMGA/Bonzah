import { randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { PlatformTenantError } from '../domain/contracts.js';
import { contentHash } from './templates.js';

const seedTenants = [
  ['00000000-0000-4000-8000-000000000001', 'abbeygate-cy'],
  ['00000000-0000-4000-8000-000000000002', 'abbeygate-pt'],
  ['00000000-0000-4000-8000-000000000003', 'abbeygate-gr'],
  ['00000000-0000-4000-8000-000000000004', 'abbeygate-es'],
] as const;
const seededCounts: Record<string, number> = {
  binder_product_authorities: 6, binders: 3, product_channel_settings: 21,
  product_definitions: 6, program_binder_links: 6, programs: 18, tenants: 4,
};
// Optional source-defined catalogs may already have been initialized by the existing runtime.
// These grant no access without assignments and are retained, not customer data.
const reusableCatalogCounts: Record<string, number> = {
  access_roles: 4, permissions: 77, role_permissions: 142, endorsement_templates_mbe: 45,
};
// Exact untouched state introduced by migration 20260907150000. These rows are
// retained; consumed or foreign counters must still prevent fresh initialization.
const freshIdentifierSequences = [
  { key: 'PLATFORM:GLOBAL:CERTIFICATE', next: 825_000_000 },
  { key: 'PLATFORM:GLOBAL:GREENCARD', next: 824_000_000 },
  { key: 'PLATFORM:GLOBAL:POLICY', next: 5_000_001 },
  { key: 'PLATFORM:GLOBAL:QUOTE', next: 5_000_001 },
];
const refuse = (message: string) => new PlatformTenantError('FRESH_DATABASE_REQUIRED', message, 409);

/** Operator-only initialization, never invoked by application startup or an HTTP request.
 * Counts run with row_security=off: PostgreSQL refuses rather than hiding protected rows.
 * Any user, business row or unexpected configuration prevents all deletion.
 */
export async function removeFreshMigrationSeedConfiguration(prisma: PrismaClient) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('platform-fresh-initialize', 0))`;
    await tx.$executeRawUnsafe('SET LOCAL row_security = off');
    const tables = await tx.$queryRaw<Array<{ tablename: string }>>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`;
    const names = tables.map(({ tablename }) => tablename);
    // Names originate from PostgreSQL metadata, not request data; still quote identifiers.
    const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
    await tx.$executeRawUnsafe(`LOCK TABLE ${names.map(quote).join(', ')} IN SHARE ROW EXCLUSIVE MODE`);
    const counts: Record<string, number> = {};
    for (const name of names) {
      const [row] = await tx.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT count(*) AS count FROM ${quote(name)}`);
      counts[name] = Number(row!.count);
      const expectedCount = name === 'policy_number_sequences' ? freshIdentifierSequences.length : seededCounts[name] ?? reusableCatalogCounts[name];
      if (name !== '_prisma_migrations' && counts[name] !== 0 && counts[name] !== expectedCount) throw refuse(`Unexpected populated table: ${name}`);
    }
    const sequences = await tx.policyNumberSequence.findMany({ orderBy: { key: 'asc' }, select: { key: true, next: true } });
    if (contentHash(sequences) !== contentHash(freshIdentifierSequences)) throw refuse('Global identifier sequences differ from untouched migration state');
    const tenants = await tx.tenant.findMany({ orderBy: { id: 'asc' }, select: { id: true, tenantSlug: true, parentOrganizationId: true } });
    if (tenants.length === 0) {
      for (const name of Object.keys(seededCounts).filter((name) => name !== 'product_definitions')) if (counts[name] !== 0) throw refuse('Unowned configuration remains without the exact migration tenants');
      return { removedTenants: 0, removedConfiguration: 0, businessRows: 0, alreadyClean: true };
    }
    if (tenants.length !== seedTenants.length || tenants.some((tenant, index) => tenant.id !== seedTenants[index]![0] || tenant.tenantSlug !== seedTenants[index]![1] || tenant.parentOrganizationId !== null)) throw refuse('Tenant identities do not match the untouched migration bootstrap');
    for (const [name, expected] of Object.entries(seededCounts)) if (counts[name] !== expected) throw refuse(`Migration configuration count differs: ${name}`);
    const ids = seedTenants.map(([id]) => id);
    const scoped = { operatingTenantId: { in: ids } };
    const programs = await tx.program.findMany({ where: scoped, select: { id: true } });
    const binders = await tx.binder.findMany({ where: scoped, select: { id: true } });
    if (programs.length !== counts.programs || binders.length !== counts.binders || await tx.binderProductAuthority.count({ where: scoped }) !== counts.binder_product_authorities) throw refuse('Configuration includes an unexpected tenant');
    const programIds = programs.map(({ id }) => id), binderIds = binders.map(({ id }) => id);
    const channels = await tx.productChannelSetting.deleteMany({});
    const links = await tx.programBinderLink.deleteMany({ where: { programId: { in: programIds }, binderId: { in: binderIds } } });
    if (links.count !== counts.program_binder_links) throw refuse('Program link ownership differs');
    const authorities = await tx.binderProductAuthority.deleteMany({ where: scoped });
    await tx.binder.deleteMany({ where: scoped });
    await tx.program.deleteMany({ where: scoped });
    await tx.tenant.deleteMany({ where: { id: { in: ids }, parentOrganizationId: null } });
    return { removedTenants: ids.length, removedConfiguration: channels.count + links.count + authorities.count + programs.length + binders.length, businessRows: 0, alreadyClean: false };
  }, { timeout: 30_000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

const bootstrapSchema = z.object({
  organizationId: z.string().uuid(), slug: z.string().regex(/^[a-z][a-z0-9-]+$/), name: z.string().trim().min(1).max(160),
  members: z.array(z.object({ email: z.string().email().transform((email) => email.toLowerCase()), role: z.enum(['OWNER', 'ADMIN', 'BUILDER']) }).strict()).min(1).max(100),
}).strict().refine((input) => input.members.filter(({ role }) => role === 'OWNER').length === 1 && new Set(input.members.map(({ email }) => email)).size === input.members.length, 'Exactly one owner and unique emails are required');
export type PlatformBootstrapInput = z.input<typeof bootstrapSchema>;

/** Explicit invitations only. Random password material is discarded; no messages are sent.
 * The immutable bootstrap receipt prevents restart from restoring revoked memberships.
 */
export async function bootstrapPlatformOperators(prisma: PrismaClient, raw: PlatformBootstrapInput) {
  const input = bootstrapSchema.parse(raw);
  const requestHash = contentHash(input);
  const passwordHashes = await Promise.all(input.members.map(() => bcrypt.hash(randomBytes(48).toString('base64url'), 12)));
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('platform-fresh-initialize', 0))`;
    const key = { organizationId: input.organizationId, operation: 'bootstrap', idempotencyKey: input.organizationId };
    const prior = await tx.platformTenantCommand.findUnique({ where: { organizationId_operation_idempotencyKey: key } });
    if (prior) {
      if (prior.requestHash !== requestHash || contentHash(prior.result) !== prior.resultHash) throw new PlatformTenantError('BOOTSTRAP_CONFLICT', 'Bootstrap request or receipt differs', 409);
      return { organizationId: input.organizationId, invitations: input.members.length, created: false };
    }
    if (await tx.tenant.count() !== 0 || await tx.platformOrganization.count() !== 0 || await tx.user.count() !== 0) throw refuse('Bootstrap requires an empty platform identity and tenant database');
    await tx.platformOrganization.create({ data: { id: input.organizationId, slug: input.slug, name: input.name } });
    let ownerId = '';
    for (const [index, member] of input.members.entries()) {
      const userId = randomUUID();
      await tx.user.create({ data: { id: userId, email: member.email, name: member.email.split('@')[0], role: 'UNDERWRITER', userType: 'INTERNAL', password: passwordHashes[index]!, isActive: true } });
      await tx.platformOrganizationMembership.create({ data: { organizationId: input.organizationId, userId, role: member.role } });
      if (member.role === 'OWNER') ownerId = userId;
    }
    const result = { organizationId: input.organizationId, invitations: input.members.length, created: true };
    await tx.platformTenantCommand.create({ data: { ...key, actorId: ownerId, requestHash, result, resultHash: contentHash(result) } });
    return result;
  }, { timeout: 20_000 });
}

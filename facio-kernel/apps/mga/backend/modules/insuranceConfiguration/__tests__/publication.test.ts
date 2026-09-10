import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { ConfigurationDefinition } from '../infra/programmeRepository.js';
import { runWithOperatingTenant } from '../../../platform/tenant/tenantAls.js';
import type { TenantConfig } from '../../../platform/tenant/tenantConfig.js';
const state = vi.hoisted(() => ({ rows: [] as Array<ConfigurationDefinition & { program: { productType: string }; programRatingModel: null }>, mappings: {} as Record<string, string>, audit: [] as unknown[], failAudit: false, tenantKind: 'SYNTHETIC', invalidConfig: false, scopeAuthorities: [] as { id: string; binder: { id: string; agreementNumber: string } }[] }));
vi.mock('../../programs/app/programRuntimeDefinitions.js', () => ({ validateProgramDefinitionComponents: () => { if (state.invalidConfig) throw new Error('Invalid definition'); }, validateProgramRatingModel: vi.fn() }));
vi.mock('../../../platform/db/connection.js', () => {
  const db = {
    $queryRaw: vi.fn(async (_strings: TemplateStringsArray, id: string, tenantId: string) => state.rows.some((row) => (row.programId === id || row.id === id) && row.operatingTenantId === tenantId) ? [{ id }] : []),
    programDefinitionVersion: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; operatingTenantId: string } }) => state.rows.find((row) => row.id === where.id && row.operatingTenantId === where.operatingTenantId) ?? null),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { status: string } }) => { const row = state.rows.find((item) => item.id === where.id)!; row.status = data.status; return row; }),
    },
    binderProductAuthority: { findMany: vi.fn(async ({ where }: { where: { operatingTenantId: string; id?: { in: string[] } } }) => where.id ? where.id.in.filter((id) => id.startsWith(where.operatingTenantId.slice(0, 4))).map((id) => ({ id, ratingModelMapping: null, programDefinitionMapping: state.mappings[id] ? { programDefinitionVersionId: state.mappings[id] } : null })) : state.scopeAuthorities.filter((row) => row.id.startsWith(where.operatingTenantId.slice(0, 4)))) },
    binderProductAuthorityProgramDefinition: { upsert: vi.fn(async ({ where, update }: { where: { binderProductAuthorityId: string }; update: { programDefinitionVersionId: string } }) => { state.mappings[where.binderProductAuthorityId] = update.programDefinitionVersionId; }) },
    auditAction: { create: vi.fn(async ({ data }: { data: unknown }) => { if (state.failAudit) throw new Error('Audit unavailable'); state.audit.push(data); }) },
  };
  return { prisma: { tenant: { findUnique: vi.fn(async () => ({ kind: state.tenantKind, status: 'ACTIVE', parentOrganizationId: 'organization' })) } }, tenantScopedPrisma: db, runTenantScopedTransaction: async (fn: (tx: typeof db) => Promise<unknown>) => { const snapshot = structuredClone({ rows: state.rows, mappings: state.mappings, audit: state.audit }); try { return await fn(db); } catch (error) { Object.assign(state, snapshot); throw error; } } };
});
const { definitionHash } = await import('../infra/programmeRepository.js');
const { publishProgrammeDefinition } = await import('../app/publishProgrammeDefinition.js');
const { publishInsuranceConfigurationTool } = await import('../app/configuration.tool.js');
const a = randomUUID(), b = randomUUID(), programId = randomUUID(), definitionId = randomUUID();
const authority = `${a.slice(0, 4)}${randomUUID().slice(4)}`, otherAuthority = `${b.slice(0, 4)}${randomUUID().slice(4)}`;
const tenant = (id: string): TenantConfig => ({ id, tenantSlug: 'fixture', countryCode: 'GB', country: 'United Kingdom', currency: 'GBP', ipt: {}, adminFee: 0, legalPack: 'training', publicBaseUrl: 'https://example.invalid', fromEmail: 'test@example.invalid', brandLogo: { white: '', blue: '' } });
const actor = { tenantId: a, userId: randomUUID(), permissions: ['configuration.publish_sandbox'], role: 'USER' as const, channel: 'internal-demo' as const, sessionId: 'test', requestId: 'test', correlationId: 'test' };
beforeEach(() => { state.rows = [{ id: definitionId, operatingTenantId: a, programId, version: 2, status: 'DRAFT', pricingMode: 'MANUAL', programRatingModelId: null, programRatingModel: null, program: { productType: 'BUSINESS' }, underwriting: {}, coverage: {}, questionnaire: {}, workflow: {}, channels: {}, documents: {} }]; state.mappings = {}; state.audit = []; state.failAudit = false; state.tenantKind = 'SYNTHETIC'; state.invalidConfig = false; state.scopeAuthorities = []; });
const input = () => ({ programId, definitionId, expectedDefinitionHash: definitionHash(state.rows[0]), binderProductAuthorityIds: [authority] });
describe('canonical programme publication', () => {
  it('publishes the same reviewed identity through MCP and canonical application; exact retry adds no audit or remapping', async () => runWithOperatingTenant(tenant(a), async () => {
    const args = input(); const result = await publishInsuranceConfigurationTool.run(args, actor);
    expect(result.status).toBe('PUBLISHED'); expect(result.definitionHash).toBe(args.expectedDefinitionHash); expect(state.mappings[authority]).toBe(definitionId); expect(state.audit).toHaveLength(1);
    expect((await publishProgrammeDefinition(args, actor)).id).toBe(definitionId); expect(state.audit).toHaveLength(1);
  }));
  it('rejects cross-tenant contexts, foreign authorities, stale hashes, duplicate target IDs and non-synthetic MCP publication', async () => runWithOperatingTenant(tenant(a), async () => {
    await expect(publishInsuranceConfigurationTool.run(input(), { ...actor, tenantId: b })).rejects.toThrow(/authorized/);
    await expect(publishProgrammeDefinition({ ...input(), binderProductAuthorityIds: [otherAuthority] }, actor)).rejects.toThrow(/Every selected/);
    await expect(publishProgrammeDefinition({ ...input(), expectedDefinitionHash: '0'.repeat(64) }, actor)).rejects.toThrow(/STALE_DEFINITION/);
    expect(() => publishInsuranceConfigurationTool.inputSchema.parse({ ...input(), binderProductAuthorityIds: [authority, authority] })).toThrow();
    state.tenantKind = 'PRODUCTION'; await expect(publishInsuranceConfigurationTool.run(input(), actor)).rejects.toThrow(/synthetic/);
    expect(state.rows[0].status).toBe('DRAFT'); expect(state.audit).toEqual([]); expect(state.mappings).toEqual({});
  }));
  it('rolls back published status and mappings if durable audit fails, and does not permit invalid publication', async () => runWithOperatingTenant(tenant(a), async () => {
    state.failAudit = true; await expect(publishProgrammeDefinition(input(), actor)).rejects.toThrow(/Audit/); expect(state.rows[0].status).toBe('DRAFT'); expect(state.mappings).toEqual({});
    state.failAudit = false; state.invalidConfig = true; await expect(publishProgrammeDefinition(input(), actor)).rejects.toThrow(/Invalid definition/); expect(state.rows[0].status).toBe('DRAFT');
  }));
  it('checks frozen binder scope identities against fresh tenant rows before any publication or audit writes', async () => runWithOperatingTenant(tenant(a), async () => {
    const binderId = randomUUID();
    state.scopeAuthorities = [{ id: authority, binder: { id: binderId, agreementNumber: 'TRAINING-A' } }, { id: otherAuthority, binder: { id: randomUUID(), agreementNumber: 'FOREIGN' } }];
    state.rows[0].questionnaire = { sourceCompilerVersion: 4, sourceScopeBindings: [{ binderId, name: 'TRAINING-A', authorityIds: [otherAuthority] }] };
    await expect(publishProgrammeDefinition(input(), actor)).rejects.toThrow(/tenant/);
    expect(state.rows[0].status).toBe('DRAFT'); expect(state.mappings).toEqual({}); expect(state.audit).toEqual([]);
    state.rows[0].questionnaire = { sourceCompilerVersion: 4, sourceScopeBindings: [{ binderId, name: 'TRAINING-A', authorityIds: [authority] }] };
    await expect(publishProgrammeDefinition(input(), actor)).resolves.toMatchObject({ status: 'PUBLISHED' });
    expect(state.audit).toHaveLength(1);
  }));
});

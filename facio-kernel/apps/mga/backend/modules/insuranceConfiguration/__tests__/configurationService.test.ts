import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { runWithOperatingTenant } from '../../../platform/tenant/tenantAls.js';
import type { TenantConfig } from '../../../platform/tenant/tenantConfig.js';
import type { ConfigurationDefinition } from '../infra/programmeRepository.js';
const state = vi.hoisted(() => ({ rows: [] as ConfigurationDefinition[] }));
vi.mock('../../../platform/db/connection.js', () => {
  const db = {
    programDefinitionVersion: {
      findFirst: vi.fn(async ({ where }: { where: { operatingTenantId: string; programId: string } }) => state.rows.filter((row) => row.operatingTenantId === where.operatingTenantId && row.programId === where.programId).sort((a, b) => b.version - a.version)[0] ?? null),
      create: vi.fn(async ({ data }: { data: ConfigurationDefinition }) => { const row = { ...data, id: globalThis.crypto.randomUUID() }; state.rows.push(row); return row; }),
    },
    $queryRaw: vi.fn(async (_strings: TemplateStringsArray, programId: string, tenantId: string) => state.rows.some((row) => row.programId === programId && row.operatingTenantId === tenantId) ? [{ id: programId }] : []),
  };
  return { tenantScopedPrisma: db, runTenantScopedTransaction: async (fn: (tx: typeof db) => Promise<unknown>) => fn(db) };
});
const { readInsuranceConfiguration, saveInsuranceConfiguration } = await import('../app/configurationService.js');
const { readInsuranceConfigurationTool, saveInsuranceConfigurationTool } = await import('../app/configuration.tool.js');

function tenant(id: string): TenantConfig { return { id, tenantSlug: 'test-tenant', countryCode: 'CY', country: 'Cyprus', currency: 'EUR', ipt: {}, adminFee: 0, legalPack: 'cy', publicBaseUrl: 'https://example.invalid', fromEmail: 'test@example.invalid', brandLogo: { white: '', blue: '' } }; }
const process = { businessDescription: 'Fixture', considerations: [], recommendedPackage: 'QUOTE_SYMPHONY', customers: { forms: false, approve: false, docs: false, portal: false, pay: false, claim: false, cancel: false }, agents: { enabled: false, contractTypes: [], deltaBonus: [], commissionMode: 'none', showExpectedCommission: false, cancellationRule: 'proRata', permissions: [] } };
const product = { name: 'Fixture', classOfBusinessKey: null, status: 'Active', active: true, coverageSections: [], details: { proposalQuestionGroups: [{ name: 'Risk', questions: [{ id: 'reference', slug: 'reference', field: 'Reference', answerType: 'Short Text', coverage: 'All', required: true }] }] } };
const a = randomUUID(), b = randomUUID(), programId = randomUUID();
const context = { tenantId: a, userId: randomUUID(), permissions: ['configuration.read', 'configuration.draft'], role: 'USER' as const, channel: 'web' as const, sessionId: 'session', requestId: 'request', correlationId: 'correlation' };
beforeEach(() => { state.rows = [{ id: randomUUID(), operatingTenantId: a, programId, version: 1, status: 'PUBLISHED', pricingMode: 'MANUAL', programRatingModelId: null, underwriting: {}, coverage: { schemaVersion: 1, mode: 'MANUAL' }, questionnaire: { requiredness: {}, sections: [] }, workflow: { referralOnly: false, externalIssuance: { mode: 'NONE' } }, channels: { questions: true, quote: true, payment: false }, documents: {} }]; });

describe('scoped source configuration use cases and MCP command parity', () => {
  it('uses the same command and hash for API application reads and MCP; rejects wrong tenant context before I/O', async () => {
    await runWithOperatingTenant(tenant(a), async () => {
      expect(await readInsuranceConfiguration({ programId }, context)).toEqual(await readInsuranceConfigurationTool.run({ programId }, context));
      await expect(readInsuranceConfiguration({ programId }, { ...context, tenantId: b })).rejects.toThrow(/authorized actor/);
      await expect(saveInsuranceConfiguration({}, { ...context, permissions: ['configuration.read'] })).rejects.toThrow(/authorized actor/);
    });
    await runWithOperatingTenant(tenant(b), async () => {
      await expect(readInsuranceConfiguration({ programId }, { ...context, tenantId: b })).rejects.toThrow(/No programme/);
    });
  });
  it('appends a new definition without changing original bytes, rejects stale replay and leaves other tenant untouched', async () => {
    state.rows.push({ ...state.rows[0], id: randomUUID(), operatingTenantId: b });
    const originals = JSON.stringify(state.rows);
    await runWithOperatingTenant(tenant(a), async () => {
      const initial = await readInsuranceConfiguration({ programId }, context);
      const input = { programId, baseDefinitionId: initial.definitionId, expectedDefinitionHash: initial.definitionHash, process, product };
      const parsed = saveInsuranceConfigurationTool.inputSchema.parse(input);
      const saved = await saveInsuranceConfigurationTool.run(parsed, context);
      expect(saved.version).toBe(2); expect(saved.status).toBe('DRAFT');
      expect(saved.process?.customers.forms).toBe(false);
      expect(JSON.stringify(state.rows.slice(0, 2))).toBe(originals);
      expect(state.rows[2].channels).toMatchObject({ questions: false, quote: false });
      await expect(saveInsuranceConfiguration(input, context)).rejects.toThrow(/STALE_DEFINITION/);
      expect(state.rows).toHaveLength(3);
      expect(await readInsuranceConfiguration({ programId }, context)).toEqual(saved);
    });
  });
  it('strict descriptors reject identity injection and pin the complete definition hash', async () => {
    expect(() => readInsuranceConfigurationTool.inputSchema.parse({ programId, tenantId: b })).toThrow();
    await runWithOperatingTenant(tenant(a), async () => {
      const initial = await readInsuranceConfiguration({ programId }, context);
      state.rows[0].documents = { changed: true };
      await expect(saveInsuranceConfiguration({ programId, baseDefinitionId: initial.definitionId, expectedDefinitionHash: initial.definitionHash, process, product }, context)).rejects.toThrow(/STALE_DEFINITION/);
    });
  });
});

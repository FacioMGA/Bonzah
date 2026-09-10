import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ policy: vi.fn(), authority: vi.fn(), definition: vi.fn(), readiness: vi.fn() }));
vi.mock('../../../platform/db/connection.js', () => ({ tenantScopedPrisma: { policy: { findUnique: mocks.policy }, binderProductAuthority: { findFirst: mocks.authority } }, runTenantScopedTransaction: vi.fn() }));
vi.mock('../../../platform/tenant/tenantConfig.js', () => ({ getTenantConfig: () => ({ id: 'tenant-a' }) }));
vi.mock('../../programs/app/activeProgramDefinition.js', () => ({ resolveMappedProgramDefinition: mocks.definition }));
vi.mock('../../policy/app/issueReadiness.js', () => ({ evaluateIssueReadiness: mocks.readiness }));
import { executeBindPolicy } from '../../policy/app/BindPolicy.js';
import { executeBindCoverage } from '../../policy/app/BindCoverage.js';
import { commercialContext, syntheticCommercialConfiguration } from '../../../products/commercial/__tests__/fixtures.js';

describe('configured agent authority at canonical bind commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const source = syntheticCommercialConfiguration(); source.process.agents.enabled = true; source.process.agents.permissions = ['submitProposals', 'uploadCustomerData'];
    mocks.policy.mockResolvedValue({ id: 'policy-a', status: 'QUOTED', productType: 'COMMERCIAL', programId: 'program-a', binderId: 'binder-a' });
    mocks.authority.mockResolvedValue({ id: 'authority-a' });
    mocks.definition.mockResolvedValue(commercialContext(source).programDefinition);
    mocks.readiness.mockResolvedValue({ canIssue: true });
  });
  for (const execute of [executeBindCoverage, executeBindPolicy]) it(`refuses agent bind through ${execute.name} even when generic readiness is clear`, async () => {
    const result = await execute({ policyId: 'policy-a', actor: { id: 'agent-a', name: 'Agent', email: null, role: 'ADMIN', userType: 'BROKER' } });
    expect(result.status).toBe('UNAUTHORIZED');
    if (result.status !== 'SUCCESS') expect(result.error).toMatchObject({ code: 'JOURNEY_PERMISSION_DENIED', message: expect.stringContaining('agent capability does not allow bind') });
    expect(mocks.authority).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ operatingTenantId: 'tenant-a', binderId: 'binder-a' }) }));
  });
});

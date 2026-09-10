import { afterEach, describe, expect, it, vi } from 'vitest';
const findMany = vi.hoisted(() => vi.fn());
vi.mock('../../../../platform/db/connection.js', () => ({ prisma: { user: { findMany } } }));
vi.mock('../../../../platform/tenant/tenantConfig.js', () => ({ getTenantConfig: () => ({ id: 'workspace-a' }) }));
import { assertWorkspaceStaff, workspaceStaffFilter } from '../workspaceMembership.js';
afterEach(() => { vi.unstubAllEnvs(); findMany.mockReset(); });
describe('staff target admission', () => {
  it('restricts directory and target lookup to current active organization and tenant membership', async () => {
    vi.stubEnv('KERNEL_PLATFORM_MODE', 'true');
    expect(workspaceStaffFilter()).toMatchObject({ isActive: true, suspendedAt: null, platformTenantMemberships: { some: { operatingTenantId: 'workspace-a', active: true } }, platformOrganizationMemberships: { some: { active: true, organization: { active: true, tenants: { some: { id: 'workspace-a' } } } } } });
    findMany.mockResolvedValue([{ id: 'member-a' }]);
    await expect(assertWorkspaceStaff(['member-a', 'outside-b'])).rejects.toMatchObject({ code: 'WORKSPACE_MEMBER_REQUIRED' });
    expect(findMany.mock.calls[0]![0].where).toMatchObject({ id: { in: ['member-a', 'outside-b'] }, platformTenantMemberships: { some: { operatingTenantId: 'workspace-a' } } });
    await expect(assertWorkspaceStaff(['member-a', 'member-a'])).resolves.toBeUndefined();
    findMany.mockResolvedValue([]);
    await expect(assertWorkspaceStaff(['revoked-member'])).rejects.toMatchObject({ code: 'WORKSPACE_MEMBER_REQUIRED' });
  });
  it('preserves the existing standalone deployment authority path', async () => {
    vi.stubEnv('KERNEL_PLATFORM_MODE', 'false');
    await expect(assertWorkspaceStaff(['existing-staff'])).resolves.toBeUndefined();
    expect(findMany).not.toHaveBeenCalled();
  });
});

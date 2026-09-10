import { afterEach, describe, expect, it, vi } from 'vitest';
const assigned = vi.hoisted(() => vi.fn());
vi.mock('../../../../platform/db/connection.js', () => ({ prisma: {} }));
vi.mock('../../infra/accessControlRepository.js', () => ({ resolveUserPermissions: assigned }));
import { resolveEffectivePermissionsForUser, hasEffectivePermission } from '../permissionService.js';
import { requirePermission } from '../../http/permissionMiddleware.js';
import { ADMIN_PERMISSIONS, UNDERWRITER_PERMISSIONS, ALL_PERMISSIONS } from '../../domain/permissionTaxonomy.js';

afterEach(() => vi.unstubAllEnvs());
describe('canonical configuration authority', () => {
  const writes = ['programs.create', 'programs.edit', 'programs.publish', 'binders.create', 'binders.edit', 'binders.publish'];
  it('registers every programme/binder write for ADMIN while technician membership remains read-only', () => {
    const registered = new Set(ALL_PERMISSIONS.map((permission) => `${permission.resource}.${permission.action}`));
    for (const key of writes) { expect(registered.has(key)).toBe(true); expect(ADMIN_PERMISSIONS.has(key)).toBe(true); expect(UNDERWRITER_PERMISSIONS.has(key)).toBe(false); }
    expect(registered.has('programs.update')).toBe(false);
    expect(UNDERWRITER_PERMISSIONS.has('programs.view')).toBe(true); expect(UNDERWRITER_PERMISSIONS.has('binders.view')).toBe(true);
  });
  it('uses the current selected-tenant role and never a global assignment to grant configuration writes', async () => {
    vi.stubEnv('KERNEL_PLATFORM_MODE', 'true');
    assigned.mockResolvedValue(writes.map((key) => ({ key })));
    const technician = await resolveEffectivePermissionsForUser('builder-global-admin', 'UNDERWRITER');
    for (const key of writes) expect(hasEffectivePermission(technician, key)).toBe(false);
    expect(assigned).not.toHaveBeenCalled();
    const ownTenantAdmin = await resolveEffectivePermissionsForUser('builder-global-admin', 'ADMIN');
    for (const key of writes) expect(hasEffectivePermission(ownTenantAdmin, key)).toBe(true);
  });
  it('enforces actual middleware publish/edit actions without aliases or frontend role bypass', async () => {
    vi.stubEnv('KERNEL_PLATFORM_MODE', 'true');
    for (const role of ['ADMIN', 'UNDERWRITER']) for (const key of writes) {
      const [resource, action] = key.split('.');
      const next = vi.fn(), json = vi.fn(), status = vi.fn(() => ({ json }));
      await requirePermission(resource, action)({ user: { id: 'member', role } } as never, { status } as never, next);
      expect(next).toHaveBeenCalledTimes(role === 'ADMIN' ? 1 : 0);
      if (role !== 'ADMIN') expect(status).toHaveBeenCalledWith(403);
    }
  });
});

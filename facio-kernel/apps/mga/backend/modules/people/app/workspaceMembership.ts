import type { Prisma } from '@prisma/client';
import { prisma } from '../../../platform/db/connection.js';
import { getTenantConfig } from '../../../platform/tenant/tenantConfig.js';

export class PeopleWorkspaceAccessError extends Error {
  readonly code = 'WORKSPACE_MEMBER_REQUIRED';
  constructor() { super('The selected staff member must have active membership of this workspace.'); }
}
/** A tenant role never grants access to the global staff directory. */
export function workspaceStaffFilter(): Prisma.UserWhereInput {
  if (process.env.KERNEL_PLATFORM_MODE !== 'true') return {};
  return { isActive: true, suspendedAt: null, role: { in: ['ADMIN', 'UNDERWRITER'] }, platformOrganizationMemberships: { some: { active: true, organization: { active: true, tenants: { some: { id: getTenantConfig().id } } } } }, platformTenantMemberships: { some: {
    operatingTenantId: getTenantConfig().id, active: true,
    operatingTenant: { status: 'ACTIVE', parentOrganization: { active: true } },
  } } };
}
export async function assertWorkspaceStaff(userIds: readonly string[]) {
  if (process.env.KERNEL_PLATFORM_MODE !== 'true') return;
  const unique = [...new Set(userIds)];
  const users = await prisma.user.findMany({ where: { ...workspaceStaffFilter(), id: { in: unique } }, select: { id: true } });
  if (users.length !== unique.length) throw new PeopleWorkspaceAccessError();
}

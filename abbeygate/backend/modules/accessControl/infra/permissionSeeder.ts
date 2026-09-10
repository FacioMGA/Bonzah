import { prisma } from '../../../platform/db/connection.js';
import type { Prisma } from '@prisma/client';
import { logger } from '../../../platform/utils/logger.js';
import {
  ALL_PERMISSIONS,
  ADMIN_PERMISSIONS,
  CUSTOMER_PERMISSIONS,
  MANAGER_AUTHORITY_PERMISSIONS,
  UNDERWRITER_PERMISSIONS,
  parsePermissionKey,
} from '../domain/permissionTaxonomy.js';
import { NAMED_OPERATOR_ROLES } from '../domain/namedOperatorRoles.js';
import { syncSystemAccessAssignmentsForAllUsers } from '../app/permissionService.js';

/**
 * Seeds the canonical permission taxonomy and the three system AccessRoles
 * into the database. Idempotent — safe to call on every startup.
 *
 * System roles are tagged `type: SYSTEM` so the UI prevents deletion.
 * This is the point of truth binding the coarse Role enum to the
 * fine-grained Permission model.
 */
export async function seedPermissionsAndSystemRoles(): Promise<void> {
  try {
    // 1. Upsert all canonical permissions
    for (const def of ALL_PERMISSIONS) {
      const constraints = def.constraints
        ? (def.constraints as Prisma.InputJsonValue)
        : undefined;
      await prisma.permission.upsert({
        where: { resource_action: { resource: def.resource, action: def.action } },
        create: {
          resource: def.resource,
          action: def.action,
          displayName: def.displayName,
          description: def.description,
          constraints,
        },
        update: {
          displayName: def.displayName,
          description: def.description,
          constraints,
        },
      });
    }

    // 2a. Idempotent rename: "Customer Portal" → "Customer" (one-time migration)
    await prisma.accessRole.updateMany({
      where: { name: 'Customer Portal' },
      data: { name: 'Customer', description: 'Self-service customer portal access. Maps to CUSTOMER role.' },
    });

    // 2b. Idempotent rename: "Underwriter" is now the technician baseline.
    const existingTechnician = await prisma.accessRole.findUnique({ where: { name: 'Technician' }, select: { id: true } });
    if (!existingTechnician) {
      await prisma.accessRole.updateMany({
        where: { name: 'Underwriter', type: 'SYSTEM' },
        data: {
          name: 'Technician',
          description: 'Operational data-entry role. Maps to UNDERWRITER role without authority actions.',
        },
      });
    }

    // 2. Upsert the three system roles
    const systemRoles: Array<{
      name: string;
      description: string;
      permissionSet: Set<string>;
    }> = [
      { name: 'Administrator', description: 'Full system authority. Maps to ADMIN role.', permissionSet: ADMIN_PERMISSIONS },
      { name: 'Technician', description: 'Operational data-entry role. Maps to UNDERWRITER role without authority actions.', permissionSet: UNDERWRITER_PERMISSIONS },
      { name: 'Customer', description: 'Self-service customer portal access. Maps to CUSTOMER role.', permissionSet: CUSTOMER_PERMISSIONS },
    ];

    const reconcileRolePermissions = async (role: { id: string }, permissionSet: Set<string>, opts?: { pruneExtraPermissions?: boolean }) => {
      const allPerms = await prisma.permission.findMany({
        where: {
          OR: [...permissionSet].map((key) => {
            return parsePermissionKey(key);
          }),
        },
        select: { id: true, resource: true, action: true },
      });
      const targetPermIds = allPerms.map((perm) => perm.id);
      const existing = await prisma.rolePermission.findMany({ where: { roleId: role.id }, select: { permissionId: true } });
      const existingPermIds = new Set(existing.map((entry) => entry.permissionId));

      if (opts?.pruneExtraPermissions) {
        await prisma.rolePermission.deleteMany({
          where: {
            roleId: role.id,
            permissionId: { notIn: targetPermIds },
          },
        });
      }

      for (const perm of allPerms) {
        const key = `${perm.resource}.${perm.action}`;
        if (permissionSet.has(key) && !existingPermIds.has(perm.id)) {
          await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: perm.id } });
        }
      }
    };

    for (const sr of systemRoles) {
      const role = await prisma.accessRole.upsert({
        where: { name: sr.name },
        create: { name: sr.name, description: sr.description, type: 'SYSTEM', isActive: true },
        update: { description: sr.description, isActive: true },
      });

      // System roles must exactly match the taxonomy so retired authority grants
      // do not linger after the Technician split.
      await reconcileRolePermissions(role, sr.permissionSet, { pruneExtraPermissions: true });
    }

    const managerAuthorityDescription = 'Authority overlay for managers who can bind, issue, export, and download.';
    const existingManagerAuthorityRole = await prisma.accessRole.findUnique({
      where: { name: 'Manager Authority' },
      select: { id: true, description: true },
    });
    if (
      existingManagerAuthorityRole &&
      String(existingManagerAuthorityRole.description || '') !== managerAuthorityDescription
    ) {
      throw new Error('ACCESS_ROLE_NAME_COLLISION_MANAGER_AUTHORITY');
    }

    const managerAuthorityRole = await prisma.accessRole.upsert({
      where: { name: 'Manager Authority' },
      create: {
        name: 'Manager Authority',
        description: managerAuthorityDescription,
        type: 'CUSTOM',
        isActive: true,
      },
      update: {
        description: managerAuthorityDescription,
        type: 'CUSTOM',
        isActive: true,
      },
    });
    await reconcileRolePermissions(managerAuthorityRole, MANAGER_AUTHORITY_PERMISSIONS);

    for (const named of NAMED_OPERATOR_ROLES) {
      const role = await prisma.accessRole.upsert({
        where: { name: named.name },
        create: {
          name: named.name,
          description: named.description,
          type: 'CUSTOM',
          isActive: true,
        },
        update: {
          description: named.description,
          type: 'CUSTOM',
          isActive: true,
        },
      });
      await reconcileRolePermissions(role, new Set(named.permissions));

      const users = await prisma.user.findMany({
        where: { email: { in: [...named.emails] } },
        select: { id: true, email: true },
      });
      const foundEmails = new Set(users.map((user) => user.email.toLowerCase()));
      for (const email of named.emails) {
        if (!foundEmails.has(email.toLowerCase())) {
          logger.warn(
            { role: named.name, email },
            '[accessControl] Named operator user missing — assign the role in Configure → Users when the User row exists.',
          );
        }
      }
      for (const user of users) {
        const existing = await prisma.accessAssignment.findFirst({
          where: { userId: user.id, roleId: role.id, scopeType: 'GLOBAL' },
          select: { id: true },
        });
        if (existing) continue;
        await prisma.accessAssignment.create({
          data: {
            userId: user.id,
            roleId: role.id,
            scopeType: 'GLOBAL',
          },
        });
      }
    }

    await syncSystemAccessAssignmentsForAllUsers();

    logger.info('[accessControl] Permission taxonomy and system roles seeded successfully.');
  } catch (err) {
    // Fail-soft: don't block startup if seed fails (e.g. in test environment without table)
    logger.warn({ err }, '[accessControl] Permission seed failed (non-fatal).');
  }
}

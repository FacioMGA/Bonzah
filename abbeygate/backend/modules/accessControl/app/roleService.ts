import { prisma } from '../../../platform/db/connection.js';
import { logger } from '../../../platform/utils/logger.js';
import { AuditLogger } from '../../../platform/audit/logger.js';

/**
 * Role Service
 *
 * Application layer — role CRUD, permission assignment, member management.
 */

export async function createRole(data: {
  name: string;
  description?: string;
  permissionIds?: string[];
  actorId: string;
  actorName?: string;
}) {
  const role = await prisma.accessRole.create({
    data: {
      name: data.name,
      description: data.description ?? null,
      type: 'CUSTOM',
      isActive: true,
      permissions: data.permissionIds?.length
        ? { create: data.permissionIds.map((permissionId) => ({ permissionId })) }
        : undefined,
    },
    include: { permissions: { include: { permission: true } } },
  });

  await AuditLogger.log(role.id, 'USER', 'ROLE.CREATED' as never, data.actorId, 'USER', { name: data.name }, data.actorName);
  logger.info({ roleId: role.id, name: role.name }, '[accessControl] Role created');
  return role;
}

export async function updateRole(id: string, data: {
  name?: string;
  description?: string;
  permissionIds?: string[]; // full replacement of permission set
  actorId: string;
  actorName?: string;
}) {
  const role = await prisma.accessRole.update({
    where: { id },
    data: {
      ...(data.name ? { name: data.name } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.permissionIds !== undefined ? {
        permissions: {
          deleteMany: {},
          create: data.permissionIds.map((permissionId) => ({ permissionId })),
        },
      } : {}),
    },
    include: { permissions: { include: { permission: true } } },
  });

  await AuditLogger.log(role.id, 'USER', 'ROLE.UPDATED' as never, data.actorId, 'USER', { name: data.name, permissionCount: data.permissionIds?.length }, data.actorName);
  return role;
}

export async function duplicateRole(id: string, newName: string, actorId: string, actorName?: string) {
  const source = await prisma.accessRole.findUniqueOrThrow({
    where: { id },
    include: { permissions: true },
  });

  const copy = await prisma.accessRole.create({
    data: {
      name: newName,
      description: source.description ? `Copy of ${source.description}` : `Copy of ${source.name}`,
      type: 'CUSTOM',
      isActive: true,
      permissions: {
        create: source.permissions.map((rp) => ({
          permissionId: rp.permissionId,
          constraints: rp.constraints ?? undefined,
        })),
      },
    },
  });

  await AuditLogger.log(copy.id, 'USER', 'ROLE.CREATED' as never, actorId, 'USER', { name: newName, copiedFrom: id }, actorName);
  return copy;
}

export async function archiveRole(id: string, actorId: string, actorName?: string) {
  const role = await prisma.accessRole.findUniqueOrThrow({ where: { id }, select: { type: true, name: true } });
  if (role.type === 'SYSTEM') throw Object.assign(new Error('System roles cannot be archived.'), { code: 'SYSTEM_ROLE_IMMUTABLE' });

  const updated = await prisma.accessRole.update({ where: { id }, data: { isActive: false } });
  await AuditLogger.log(id, 'USER', 'ROLE.ARCHIVED' as never, actorId, 'USER', { name: role.name }, actorName);
  return updated;
}

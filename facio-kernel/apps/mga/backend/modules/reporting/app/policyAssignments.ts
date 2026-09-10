import type { Prisma } from '@prisma/client';

import { prisma, tenantScopedPrisma } from '../../../platform/db/connection.js';
import type { WithoutTenantScope } from '../../../platform/db/tenantExtension.js';

export class PolicyAssignmentTargetMissingError extends Error {
  readonly code = 'POLICY_NOT_FOUND';

  constructor(policyId: string) {
    super(`Policy ${policyId} was not found for staff assignment.`);
    this.name = 'PolicyAssignmentTargetMissingError';
  }
}

export class PolicyAssignmentStaffTargetInvalidError extends Error {
  readonly code = 'STAFF_TARGET_INVALID';

  constructor(userId: string) {
    super(`User ${userId} is not an active internal staff assignment target.`);
    this.name = 'PolicyAssignmentStaffTargetInvalidError';
  }
}

export async function assignPolicyToStaff(args: {
  policyId: string;
  assignedToUserId: string;
  assignedByUserId?: string | null;
  source?: string;
}) {
  const policy = await tenantScopedPrisma.policy.findUnique({
    where: { id: args.policyId },
    select: { id: true },
  });
  if (!policy) {
    throw new PolicyAssignmentTargetMissingError(args.policyId);
  }

  const staffTarget = await prisma.user.findFirst({
    where: {
      id: args.assignedToUserId,
      userType: 'INTERNAL',
      isActive: true,
      role: { in: ['ADMIN', 'UNDERWRITER'] },
    },
    select: { id: true },
  });
  if (!staffTarget) {
    throw new PolicyAssignmentStaffTargetInvalidError(args.assignedToUserId);
  }

  const data: WithoutTenantScope<Prisma.PolicyAssignmentUncheckedCreateInput> = {
    policyId: args.policyId,
    assignedToUserId: args.assignedToUserId,
    assignedByUserId: args.assignedByUserId || null,
    source: args.source || 'MANUAL',
    status: 'ACTIVE',
  };
  return tenantScopedPrisma.policyAssignment.upsert({
    where: { policyId: args.policyId },
    create: data as Prisma.PolicyAssignmentUncheckedCreateInput,
    update: {
      assignedToUserId: args.assignedToUserId,
      assignedByUserId: args.assignedByUserId || null,
      source: args.source || 'MANUAL',
      status: 'ACTIVE',
      releasedAt: null,
      assignedAt: new Date(),
    },
  });
}

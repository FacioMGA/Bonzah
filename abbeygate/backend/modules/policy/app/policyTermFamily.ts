import crypto from 'node:crypto';
import type { Prisma } from '@prisma/client';

export function newRenewalFamilyId(): string {
  return crypto.randomUUID();
}

export function latestTermOrderBy(): Prisma.PolicyOrderByWithRelationInput[] {
  return [
    { renewalSequence: 'desc' },
    { inceptionDate: 'desc' },
    { createdAt: 'desc' },
  ];
}

export function termScopedPolicyWhere(
  base: Prisma.PolicyWhereInput = {},
  opts?: { includeHistoricalTerms?: boolean }
): Prisma.PolicyWhereInput {
  if (opts?.includeHistoricalTerms) return base;
  return {
    AND: [
      base,
      {
        nextTermPolicies: {
          none: {},
        },
      },
    ],
  };
}

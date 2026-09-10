import type { Prisma } from '@prisma/client';
import { termScopedPolicyWhere } from '../policyTermFamily.js';
import { buildCustomerPolicyScopeOr } from './listPoliciesUseCase.js';

export type PolicyDateBasis = 'createdAt' | 'inceptionDate' | 'issuedAt';

type PolicyCountActor = {
  role?: unknown;
  primaryAccountId?: unknown;
  email?: unknown;
} | null | undefined;

type BuildPolicyCountWhereArgs = {
  actor?: PolicyCountActor;
  start?: Date | null;
  end?: Date | null;
  dateBasis: PolicyDateBasis;
  programId?: string | null;
  binderId?: string | null;
  productType?: string | Prisma.StringNullableFilter | null;
  statusIn?: string[];
  bdxOnly?: boolean;
  includeHistoricalTerms?: boolean;
};

function toUpper(value: unknown): string {
  return String(value || '').trim().toUpperCase();
}

export function csvStringToArray(value: unknown): string[] {
  return String(value || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function dateWhere(args: { dateBasis: PolicyDateBasis; start?: Date | null; end?: Date | null }): Prisma.PolicyWhereInput {
  const range = {
    ...(args.start ? { gte: args.start } : {}),
    ...(args.end ? { lte: args.end } : {}),
  };
  if (!Object.keys(range).length) return {};
  if (args.dateBasis === 'createdAt') return { createdAt: range };
  if (args.dateBasis === 'issuedAt') return { issuedAt: range };
  return { inceptionDate: range };
}

export function buildPolicyCountWhere(args: BuildPolicyCountWhereArgs): Prisma.PolicyWhereInput {
  const baseWhere: Prisma.PolicyWhereInput = {
    ...(args.productType ? { productType: args.productType } : {}),
    ...(args.programId ? { programId: args.programId } : {}),
    ...(args.binderId ? { binderId: args.binderId } : {}),
    ...dateWhere({ dateBasis: args.dateBasis, start: args.start, end: args.end }),
  };
  const where = termScopedPolicyWhere(baseWhere, { includeHistoricalTerms: args.includeHistoricalTerms });
  const andClauses: Prisma.PolicyWhereInput[] = [];

  if (args.statusIn && args.statusIn.length > 0) {
    where.status = { in: args.statusIn };
  }

  if (toUpper(args.actor?.role) === 'CUSTOMER') {
    // Counts and listing MUST share the same customer scope, otherwise
    // a dashboard count and the underlying list disagree (PR-1C).
    andClauses.push({
      OR: buildCustomerPolicyScopeOr({
        role: 'CUSTOMER',
        primaryAccountId: String(args.actor?.primaryAccountId || '').trim() || undefined,
        email: String(args.actor?.email || '').trim() || undefined,
      }),
    });
  }

  if (args.bdxOnly) {
    andClauses.push({
      OR: [
        {
          stateCurrent: {
            is: {
              snapshot: {
                path: ['bdxImport', 'rowKey'],
                string_contains: '::',
              },
            },
          },
        },
        {
          stateCurrent: {
            is: {
              snapshot: {
                path: ['endorsementMeta', 'bdxImport', 'rowKey'],
                string_contains: '::',
              },
            },
          },
        },
      ],
    });
  }

  if (andClauses.length > 0) {
    where.AND = [...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []), ...andClauses];
  }

  return where;
}

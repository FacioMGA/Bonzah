/**
 * Tenant-scoped read adapter for PolicyHolder ("customer") lookups.
 *
 * Mirrors the OR-clause shape used by `accountsRouter.ts` (name OR
 * contact substring) so operator search returns the same candidate set
 * the BO Accounts page would. We deliberately do NOT call into
 * `accountsRouter` via HTTP self-call — direct Prisma read against
 * the canonical model is simpler and stays inside the operator-module
 * no-direct-writes guard's "reads only" allowance.
 *
 * For BO UX semantics ("customer" = PolicyHolder, not Prisma Account)
 * see `docs/architecture/contracts/accounts-intelligence-api.md`.
 */
import type { Prisma } from '@prisma/client';
import { tenantScopedPrisma } from '../../../../platform/db/connection.js';

export interface PolicyHolderSummary {
    id: string;
    name: string;
    contact: string | null;
    activePolicyCount: number;
    createdAt: Date;
}

export async function searchPolicyHoldersByText(args: {
    q: string;
    limit?: number;
}): Promise<PolicyHolderSummary[]> {
    const q = String(args.q || '').trim();
    if (!q) return [];
    const where: Prisma.PolicyHolderWhereInput = {
        OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { contact: { contains: q, mode: 'insensitive' } },
        ],
    };
    const rows = await tenantScopedPrisma.policyHolder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: Math.min(Math.max(args.limit ?? 10, 1), 50),
        select: {
            id: true,
            name: true,
            contact: true,
            createdAt: true,
            _count: { select: { policies: { where: { status: { in: ['ACTIVE', 'ISSUED'] } } } } },
        },
    });
    return rows.map((r) => ({
        id: r.id,
        name: r.name,
        contact: r.contact,
        activePolicyCount: r._count.policies,
        createdAt: r.createdAt,
    }));
}

export async function findPolicyHolderById(id: string): Promise<PolicyHolderSummary | null> {
    const r = await tenantScopedPrisma.policyHolder.findUnique({
        where: { id },
        select: {
            id: true,
            name: true,
            contact: true,
            createdAt: true,
            _count: { select: { policies: { where: { status: { in: ['ACTIVE', 'ISSUED'] } } } } },
        },
    });
    if (!r) return null;
    return {
        id: r.id,
        name: r.name,
        contact: r.contact,
        activePolicyCount: r._count.policies,
        createdAt: r.createdAt,
    };
}

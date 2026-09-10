/**
 * Tenant-scoped read adapter for quotes / policies.
 *
 * Wraps the canonical `PolicyListIndex` projection + the canonical
 * `buildPolicySearchOrClauses` helper from `readRouter.helpers.ts`.
 * Same projection the BO Policies page reads from — operator MCP gets
 * exactly the same candidate set the BO operator would see.
 *
 * We deliberately read PolicyListIndex directly (not the full
 * `listPoliciesUseCase`) so the operator tool surface stays decoupled
 * from HTTP-shape pagination / cursor / sort plumbing. The shared
 * helper guarantees the search predicate matches BO behaviour
 * including legacy alias variants (ABV/ABOLV).
 */
import type { Prisma } from '@prisma/client';
import { tenantScopedPrisma } from '../../../../platform/db/connection.js';
import { buildPolicySearchOrClauses } from '../../../policy/http/readRouter.helpers.js';

/** Quote-stage statuses surfaced by `operator.search_quotes`. */
export const QUOTE_STATUSES = [
    'DRAFT',
    'QUOTED',
    'REFERRAL',
    'INFO_REQUIRED',
    'PRICED',
    'PAYMENT_PENDING',
] as const;

/** Policy-stage statuses surfaced by `operator.search_policies`. */
export const POLICY_STATUSES = [
    'ACTIVE',
    'ISSUED',
    'EXPIRED',
    'CANCELLED',
    'CANCELED',
    'LAPSED',
] as const;

export interface PolicyListRow {
    policyId: string;
    policyNumber: string;
    insuredName: string;
    insuredDisplay: string | null;
    policyholderEmail: string | null;
    status: string;
    boStatus: string | null;
    productType: string | null;
    totalPremium: number;
    uwActionRequired: boolean;
    complianceState: string;
    attentionScore: number;
    quoteExpiryDate: Date | null;
    inceptionDate: Date | null;
    expiryDate: Date | null;
    updatedAt: Date;
}

export interface PolicyListSearchInput {
    /** Free-text query (insuredName, policyNumber, vehicle, etc.). */
    q?: string;
    /** PolicyHolder.id filter. */
    policyHolderId?: string;
    /** Status set — defaults to QUOTE_STATUSES or POLICY_STATUSES per the caller's tool. */
    statusIn?: readonly string[];
    /** Product code (e.g. 'MOTOR'). */
    productType?: string;
    /** UW queue filter (PolicyListIndex.uwActionRequired = true). */
    uwActionRequired?: boolean;
    limit?: number;
}

function buildWhere(input: PolicyListSearchInput): Prisma.PolicyListIndexWhereInput {
    const where: Prisma.PolicyListIndexWhereInput = {};
    const filters: Prisma.PolicyListIndexWhereInput[] = [];
    if (input.q) {
        const orClauses = buildPolicySearchOrClauses(input.q);
        if (orClauses.length > 0) filters.push({ OR: orClauses });
    }
    if (input.statusIn && input.statusIn.length > 0) {
        filters.push({ status: { in: [...input.statusIn] } });
    }
    if (input.productType) {
        filters.push({ policy: { productType: input.productType } });
    }
    if (input.policyHolderId) {
        filters.push({ policy: { policyHolderId: input.policyHolderId } });
    }
    if (input.uwActionRequired !== undefined) {
        filters.push({ uwActionRequired: input.uwActionRequired });
    }
    if (filters.length === 0) return where;
    if (filters.length === 1) return filters[0];
    return { AND: filters };
}

function rowToSummary(r: {
    policyId: string;
    policyNumber: string;
    insuredName: string;
    insuredDisplay: string | null;
    policyholderEmail: string | null;
    status: string;
    bo_status: string | null;
    totalPremium: { toString(): string };
    uwActionRequired: boolean;
    complianceState: string;
    attentionScore: number;
    quoteExpiryDate: Date | null;
    updatedAt: Date;
    policy: {
        productType: string | null;
        inceptionDate: Date | null;
        expiryDate: Date | null;
    } | null;
}): PolicyListRow {
    return {
        policyId: r.policyId,
        policyNumber: r.policyNumber,
        insuredName: r.insuredName,
        insuredDisplay: r.insuredDisplay,
        policyholderEmail: r.policyholderEmail,
        status: r.status,
        boStatus: r.bo_status,
        productType: r.policy?.productType ?? null,
        totalPremium: Number(r.totalPremium?.toString?.() ?? '0'),
        uwActionRequired: r.uwActionRequired,
        complianceState: r.complianceState,
        attentionScore: r.attentionScore,
        quoteExpiryDate: r.quoteExpiryDate,
        inceptionDate: r.policy?.inceptionDate ?? null,
        expiryDate: r.policy?.expiryDate ?? null,
        updatedAt: r.updatedAt,
    };
}

export async function searchPolicyList(input: PolicyListSearchInput): Promise<PolicyListRow[]> {
    const rows = await tenantScopedPrisma.policyListIndex.findMany({
        where: buildWhere(input),
        orderBy: [{ attentionScore: 'desc' }, { updatedAt: 'desc' }],
        take: Math.min(Math.max(input.limit ?? 20, 1), 100),
        include: {
            policy: { select: { productType: true, inceptionDate: true, expiryDate: true } },
        },
    });
    return rows.map(rowToSummary);
}

export async function getPolicyById(policyId: string): Promise<PolicyListRow | null> {
    const r = await tenantScopedPrisma.policyListIndex.findUnique({
        where: { policyId },
        include: {
            policy: { select: { productType: true, inceptionDate: true, expiryDate: true } },
        },
    });
    return r ? rowToSummary(r) : null;
}

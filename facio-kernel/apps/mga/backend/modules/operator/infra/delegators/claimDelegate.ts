/**
 * Operator-module-owned write composition for creating a policy-linked
 * Claim that the FNOL link will redeem against.
 *
 * NOTE on architecture (see header of `leadDelegate.ts` for context):
 * V2 should refactor `claimsWorksheetRouter`'s inline create flow into
 * an exported app-layer service that both the router and this
 * delegator call. For V1 we mirror the minimum-viable shape needed by
 * `sendFnolLinkForClaim` (claimNumber + policyId + status PENDING).
 */
import { Prisma } from '@prisma/client';
import { runTenantScopedTransaction } from '../../../../platform/db/connection.js';
import { reserveNextClaimNumber } from '../../../../platform/utils/platformIds.js';

export interface CreatePolicyLinkedClaimInput {
    policyId: string;
    /** Operator's `apikey:<id>` identity for the audit `actorId`. */
    actorId: string;
    incidentDate?: Date;
}

export interface CreatePolicyLinkedClaimResult {
    claimId: string;
    claimNumber: string;
    policyId: string;
}

export async function createPolicyLinkedClaim(
    input: CreatePolicyLinkedClaimInput,
): Promise<CreatePolicyLinkedClaimResult> {
    const incidentDate = input.incidentDate ?? new Date();
    const result = await runTenantScopedTransaction(async (_tx) => {
        // Same cast pattern the canonical claims router uses to bridge
        // the tenant-extended transaction client to the plain Prisma
        // TransactionClient that `reserveNextClaimNumber` accepts.
        const tx = _tx as unknown as Prisma.TransactionClient;
        const policy = await tx.policy.findUnique({
            where: { id: input.policyId },
            select: { id: true, status: true },
        });
        if (!policy) throw new Error(`Policy "${input.policyId}" not found.`);
        const claimNumber = await reserveNextClaimNumber(tx, incidentDate);
        const claim = await tx.claim.create({
            data: {
                policyId: input.policyId,
                policyLinkedAt: new Date(),
                claimNumber,
                incidentDate,
                reportedDate: new Date(),
                firstNotifiedAt: new Date(),
                status: 'PENDING',
                data: {
                    source: 'operator-mcp',
                    createdByActor: input.actorId,
                },
            } as unknown as Prisma.ClaimUncheckedCreateInput,
        });
        return { claimId: claim.id, claimNumber: claim.claimNumber, policyId: input.policyId };
    });
    return result;
}

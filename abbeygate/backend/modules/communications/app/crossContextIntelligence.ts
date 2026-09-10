/**
 * Cross-Context Intelligence — aggregates threads across related entities.
 *
 * When viewing a claim, surfaces related policy communications.
 * When viewing an account, shows all policy + claim threads aggregated.
 */
import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import type { ConversationSummary } from './queries/timelineProjections.js';
import { getConversationSummaries } from './queries/timelineProjections.js';

export interface CrossContextResult {
    primary: ConversationSummary[];
    related: Array<{
        entityType: string;
        entityId: string;
        label: string;
        summaries: ConversationSummary[];
    }>;
}

/**
 * Get threads for the primary entity plus all related entities.
 */
export async function getCrossContextThreads(
    entityType: string,
    entityId: string,
): Promise<CrossContextResult> {
    const primary = await getConversationSummaries(entityType, entityId);
    const related: CrossContextResult['related'] = [];

    if (entityType === 'CLAIM') {
        // When viewing a claim, also surface the parent policy's communications
        const claim = await tenantScopedPrisma.claim.findUnique({
            where: { id: entityId },
            select: { policyId: true },
        });
        if (claim?.policyId) {
            const policy = await tenantScopedPrisma.policy.findUnique({
                where: { id: claim.policyId },
                select: { policyNumber: true },
            });
            const policySummaries = await getConversationSummaries('POLICY', claim.policyId);
            if (policySummaries.length > 0) {
                related.push({
                    entityType: 'POLICY',
                    entityId: claim.policyId,
                    label: `Policy ${policy?.policyNumber || claim.policyId}`,
                    summaries: policySummaries,
                });
            }
        }
    }

    if (entityType === 'POLICY') {
        // When viewing a policy, also surface any related claim communications
        const claims = await tenantScopedPrisma.claim.findMany({
            where: { policyId: entityId },
            select: { id: true, claimNumber: true },
        });
        for (const claim of claims) {
            const claimSummaries = await getConversationSummaries('CLAIM', claim.id);
            if (claimSummaries.length > 0) {
                related.push({
                    entityType: 'CLAIM',
                    entityId: claim.id,
                    label: `Claim ${claim.claimNumber || claim.id}`,
                    summaries: claimSummaries,
                });
            }
        }
    }

    if (entityType === 'ACCOUNT') {
        // When viewing an account, surface all policy + claim threads under that account
        const policies = await tenantScopedPrisma.policy.findMany({
            where: { accountId: entityId },
            select: { id: true, policyNumber: true },
        });
        for (const policy of policies) {
            const policySummaries = await getConversationSummaries('POLICY', policy.id);
            if (policySummaries.length > 0) {
                related.push({
                    entityType: 'POLICY',
                    entityId: policy.id,
                    label: `Policy ${policy.policyNumber || policy.id}`,
                    summaries: policySummaries,
                });
            }

            // Also get claims under each policy
            const claims = await tenantScopedPrisma.claim.findMany({
                where: { policyId: policy.id },
                select: { id: true, claimNumber: true },
            });
            for (const claim of claims) {
                const claimSummaries = await getConversationSummaries('CLAIM', claim.id);
                if (claimSummaries.length > 0) {
                    related.push({
                        entityType: 'CLAIM',
                        entityId: claim.id,
                        label: `Claim ${claim.claimNumber || claim.id}`,
                        summaries: claimSummaries,
                    });
                }
            }
        }
    }

    return { primary, related };
}

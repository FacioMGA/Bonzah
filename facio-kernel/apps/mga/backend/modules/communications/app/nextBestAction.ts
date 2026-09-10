/**
 * Next-Best-Action Engine — suggests communication actions based on entity state.
 *
 * Rule-based heuristics that analyze thread state, delivery status, and
 * entity lifecycle to suggest actionable next steps.
 */
import { tenantScopedPrisma } from '../../../platform/db/connection.js';

export interface SuggestedAction {
    action: string;        // Machine-readable action ID
    label: string;         // Human-readable label
    priority: 'HIGH' | 'MEDIUM' | 'LOW';
    reason: string;
    channel?: string;      // Suggested channel
    templateId?: string;   // Suggested template
}

/**
 * Analyze subject entity context and suggest next communication actions.
 */
export async function suggestNextActions(
    entityType: string,
    entityId: string,
): Promise<SuggestedAction[]> {
    const actions: SuggestedAction[] = [];

    // 1. Check for failed deliveries
    const failedCount = await tenantScopedPrisma.communicationMessage.count({
        where: { status: 'FAILED', thread: { entityType, entityId } },
    });
    if (failedCount > 0) {
        actions.push({
            action: 'RETRY_FAILED',
            label: `Retry ${failedCount} failed message${failedCount > 1 ? 's' : ''}`,
            priority: 'HIGH',
            reason: `${failedCount} message${failedCount > 1 ? 's have' : ' has'} failed delivery. Consider retrying or using an alternative channel.`,
        });
    }

    // 2. Check for unanswered outbound messages (3+ days)
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const unansweredThreads = await tenantScopedPrisma.communicationThread.findMany({
        where: {
            entityType,
            entityId,
            messages: {
                some: {
                    direction: 'OUTBOUND',
                    createdAt: { lt: threeDaysAgo },
                },
            },
        },
        include: {
            messages: {
                orderBy: { createdAt: 'desc' },
                take: 1,
            },
        },
    });
    const needsFollowUp = unansweredThreads.filter(
        (t) => t.messages[0]?.direction === 'OUTBOUND',
    );
    if (needsFollowUp.length > 0) {
        actions.push({
            action: 'SEND_FOLLOW_UP',
            label: `Send follow-up (${needsFollowUp.length} thread${needsFollowUp.length > 1 ? 's' : ''} without reply)`,
            priority: 'MEDIUM',
            reason: `No response received for ${needsFollowUp.length} thread${needsFollowUp.length > 1 ? 's' : ''} in 3+ days.`,
        });
    }

    // 3. Entity-specific suggestions
    if (entityType === 'POLICY') {
        const policy = await tenantScopedPrisma.policy.findUnique({
            where: { id: entityId },
            select: { status: true },
        });
        if (policy) {
            const status = String(policy.status || '').toUpperCase();
            if (status === 'QUOTE' || status === 'DRAFT') {
                actions.push({
                    action: 'SEND_QUOTE_REMINDER',
                    label: 'Send quote reminder',
                    priority: 'MEDIUM',
                    reason: 'Policy is in quote/draft status. Consider sending a follow-up to the policyholder.',
                    channel: 'EMAIL',
                });
            }
            if (status === 'BOUND' || status === 'ISSUED') {
                // Check for upcoming renewal (30 days)
                const policyFull = await tenantScopedPrisma.policy.findUnique({
                    where: { id: entityId },
                    select: { expiryDate: true },
                });
                if (policyFull?.expiryDate) {
                    const endDate = new Date(policyFull.expiryDate);
                    const daysToEnd = Math.floor(
                        (endDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
                    );
                    if (daysToEnd > 0 && daysToEnd <= 30) {
                        actions.push({
                            action: 'SEND_RENEWAL_NOTICE',
                            label: `Send renewal notice (${daysToEnd} days until expiry)`,
                            priority: 'HIGH',
                            reason: `Policy expires in ${daysToEnd} days. Send renewal notice to policyholder.`,
                            channel: 'EMAIL',
                        });
                    }
                }
            }
        }
    }

    if (entityType === 'CLAIM') {
        const claim = await tenantScopedPrisma.claim.findUnique({
            where: { id: entityId },
            select: { status: true },
        });
        if (claim) {
            const status = String(claim.status || '').toUpperCase();
            if (status === 'OPEN' || status === 'IN_REVIEW') {
                actions.push({
                    action: 'REQUEST_EVIDENCE',
                    label: 'Request additional evidence',
                    priority: 'MEDIUM',
                    reason: 'Claim is open/in review. Consider requesting supporting documentation from the claimant.',
                    channel: 'EMAIL',
                });
            }
            if (status === 'APPROVED' || status === 'SETTLED') {
                actions.push({
                    action: 'SEND_SETTLEMENT_CONFIRMATION',
                    label: 'Send settlement confirmation',
                    priority: 'LOW',
                    reason: 'Claim has been settled. Send confirmation to the claimant.',
                    channel: 'EMAIL',
                });
            }
        }
    }

    // 4. Check if there are no communications at all — suggest initial outreach
    const totalMessages = await tenantScopedPrisma.communicationMessage.count({
        where: { thread: { entityType, entityId } },
    });
    if (totalMessages === 0) {
        actions.push({
            action: 'INITIAL_OUTREACH',
            label: 'Send initial communication',
            priority: 'LOW',
            reason: 'No communications recorded yet for this entity. Consider sending an initial message.',
            channel: 'EMAIL',
        });
    }

    // Sort by priority
    const priorityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    return actions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
}

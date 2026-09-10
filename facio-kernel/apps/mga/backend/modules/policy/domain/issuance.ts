/**
 * Domain rules and invariants for Policy Issuance and Binding.
 * These are pure functions that enforce Abbeygate business logic without side-effects (no DB calls).
 */

/**
 * Determines the next lifecycle status for a policy when payment is confirmed or policy is bound.
 * @param inceptionDate The date the policy coverage begins.
 * @param now The current date/time (passed in for testability).
 * @returns 'ISSUED' if the policy starts in the future, 'ACTIVE' if it starts today or in the past.
 */
export function determinePostBindLifecycleStatus(inceptionDate: Date | null, now: Date): 'ISSUED' | 'ACTIVE' {
    if (inceptionDate && now < new Date(inceptionDate)) {
        return 'ISSUED';
    }
    return 'ACTIVE';
}

/**
 * Validates if the given policy status is allowed to proceed to 'Binding' (Legal Action).
 * @param currentStatus The uppercase policy status.
 * @returns An object indicating if the transition is allowed.
 */
export function canTransitionToBind(currentStatus: string): { allowed: boolean; reason?: string } {
    const status = String(currentStatus || '').toUpperCase();

    // Explicitly block 'REFERRAL' - Underwriter must approve (move to QUOTED or APPROVED) before binding.
    const allowedStatuses = ['QUOTED', 'AWAITING_PAYMENT', 'INTAKE', 'INFO_REQUIRED', 'APPROVED', 'DRAFT', 'SUBMITTED'];

    if (!allowedStatuses.includes(status) && !['ISSUED', 'ACTIVE', 'BOUND'].includes(status)) {
        return {
            allowed: false,
            reason: `Policy cannot be issued from status '${status}'. Authorization Required. Allowed starting statuses: ${allowedStatuses.join(', ')}`
        };
    }

    return { allowed: true };
}

/**
 * Validates if the policy has any blocking referrals preventing bind.
 * @param pendingEndorsementsCount Number of endorsements in PENDING or REFERRED status.
 */
export function assertNoPendingReferrals(pendingEndorsementsCount: number): void {
    if (pendingEndorsementsCount > 0) {
        throw new Error(`Cannot bind policy with ${pendingEndorsementsCount} pending endorsements/referrals. Underwriter approval required.`);
    }
}

/**
 * Validates if the given policy status is allowed to proceed to 'Issuance' (Document Generation Post-Bind).
 * @param currentStatus The uppercase policy status.
 */
export function assertCanIssuePolicy(currentStatus: string): void {
    const status = String(currentStatus || '').toUpperCase();
    if (status !== 'BOUND' && status !== 'BOUND_DRAFT_ISSUED') {
        throw new Error(`Cannot issue from status '${status}'. Only BOUND policies can be issued.`);
    }
}

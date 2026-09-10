export type IssueReadinessProjection = {
    version: number;              // increments on change
    updatedAt: string;            // ISO
    hasBoundInceptionTransaction: boolean;
    hasIssuedPackDocuments: boolean;
    hasWelcomeEmailSent: boolean;
    customerOutcome: 'pending' | 'issued' | 'failed';
    failureCode?: string;         // safe code, not PII
};

import { asRecord } from './issueReadinessGuards.js';

export function parseIssueReadinessProjection(raw: unknown): IssueReadinessProjection {
    const r = asRecord(raw);
    return {
        version: Number(r.version) || 0,
        updatedAt: String(r.updatedAt || '').trim() || new Date(0).toISOString(),
        hasBoundInceptionTransaction: Boolean(r.hasBoundInceptionTransaction),
        hasIssuedPackDocuments: Boolean(r.hasIssuedPackDocuments),
        hasWelcomeEmailSent: Boolean(r.hasWelcomeEmailSent),
        customerOutcome: String(r.customerOutcome) === 'issued' ? 'issued' : String(r.customerOutcome) === 'failed' ? 'failed' : 'pending',
        failureCode: String(r.failureCode || '').trim() || undefined,
    };
}

export function mergeIssueReadinessProjection(
    currentRaw: unknown,
    patch: Partial<Omit<IssueReadinessProjection, 'version' | 'updatedAt' | 'customerOutcome'>> & { failureCode?: string },
): { changed: boolean; current: IssueReadinessProjection; next: IssueReadinessProjection } {
    const current = parseIssueReadinessProjection(currentRaw);

    // Merge patch monotonically (only false -> true allowed for booleans to prevent regressions)
    let changed = false;
    const next = { ...current };

    if (patch.hasBoundInceptionTransaction === true && !next.hasBoundInceptionTransaction) {
        next.hasBoundInceptionTransaction = true;
        changed = true;
    }
    if (patch.hasIssuedPackDocuments === true && !next.hasIssuedPackDocuments) {
        next.hasIssuedPackDocuments = true;
        changed = true;
    }
    if (patch.hasWelcomeEmailSent === true && !next.hasWelcomeEmailSent) {
        next.hasWelcomeEmailSent = true;
        changed = true;
    }
    if (patch.failureCode && patch.failureCode !== next.failureCode) {
        next.failureCode = patch.failureCode;
        changed = true;
    }

    // Determine outcome
    let nextOutcome: 'pending' | 'issued' | 'failed' = 'pending';
    if (next.hasBoundInceptionTransaction && next.hasIssuedPackDocuments) {
        nextOutcome = 'issued';
    } else if (next.failureCode) {
        nextOutcome = 'failed';
    }

    if (nextOutcome !== next.customerOutcome) {
        next.customerOutcome = nextOutcome;
        changed = true;
    }

    if (!changed) return { changed: false, current, next: current };

    next.version += 1;
    next.updatedAt = new Date().toISOString();
    return { changed: true, current, next };
}

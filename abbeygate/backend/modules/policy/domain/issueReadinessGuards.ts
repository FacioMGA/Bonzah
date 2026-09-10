/**
 * Issue-Readiness: Pure Guards & Utility Functions
 *
 * Stateless, side-effect-free functions used by the issue-readiness evaluator.
 * Extracted per CHAMPS "Guards" pattern — pure and independently testable.
 */

import type { UwWorkflowState } from './issueReadinessTypes.js';

// ─── Record Utilities ────────────────────────────────────────────────

export type UnknownRecord = Record<string, unknown>;
export const asRecord = (x: unknown): UnknownRecord => (x && typeof x === 'object' && !Array.isArray(x) ? (x as UnknownRecord) : {});

export function isObject(x: unknown): x is UnknownRecord {
    return Boolean(x && typeof x === 'object');
}

export function parseSnapshot(raw: unknown): UnknownRecord {
    if (isObject(raw)) return raw;
    if (typeof raw === 'string') {
        try {
            const parsed = JSON.parse(raw);
            return isObject(parsed) ? parsed : {};
        } catch {
            return {};
        }
    }
    return {};
}

// ─── Snapshot Extractors ─────────────────────────────────────────────

export function getPaymentConfirmed(policy: UnknownRecord): boolean {
    // Prefer DB payment rows if present
    const payments = Array.isArray(policy?.payments) ? (policy.payments as UnknownRecord[]) : [];
    const paidStatuses = new Set(['PAID', 'CAPTURED', 'SETTLED', 'SUCCESS']);
    const paid = payments.some((p: UnknownRecord) => paidStatuses.has(String(p?.status || '').toUpperCase()));
    if (paid) return true;

    // Projected and stored on the policy header row
    const ps = String(policy?.paymentStatus || '').toUpperCase();
    if (ps === 'PAID') return true;

    // Fallback to snapshot marker
    const snap = asRecord(policy?.stateCurrent).snapshot;
    const s = isObject(snap) ? snap : {};
    return String(asRecord(s?.paymentInfo).status || '').toLowerCase() === 'paid';
}

export function getWelcomeEmailSentFromSnapshot(policy: UnknownRecord): boolean {
    const snap = asRecord(policy?.stateCurrent).snapshot;
    const s = isObject(snap) ? snap : {};
    const issuance = asRecord(s?.issuance);
    const welcomeEmail = asRecord(issuance?.welcomeEmail);
    const sentAt = String(welcomeEmail?.sentAt || '').trim();
    return Boolean(sentAt);
}

export function getCompliance(policy: UnknownRecord): UnknownRecord | null {
    const snap = asRecord(policy?.stateCurrent).snapshot;
    const s = isObject(snap) ? snap : {};
    const c = s?.compliance;
    if (!isObject(c)) return null;
    return c;
}

// ─── Field & Value Helpers ───────────────────────────────────────────

export function toBool(value: unknown): boolean {
    if (typeof value === 'boolean') return value;
    const normalized = String(value ?? '').trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

export function hasMeaningfulValue(value: unknown): boolean {
    if (value === null || value === undefined) return false;
    if (typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (Array.isArray(value)) return value.length > 0;
    return String(value).trim().length > 0;
}

// hasMeaningfulQuoteResponse removed — dead code. Adapter uses hasValidQuoteResponse() instead.

// ─── Channel & Actor Mappers ─────────────────────────────────────────

export function toLastModifiedByLabel(channel: string): string | undefined {
    const normalized = String(channel || '').trim().toLowerCase();
    if (!normalized) return undefined;
    if (normalized === 'bo' || normalized === 'backoffice') return 'Underwriter';
    if (normalized === 'customer_wizard' || normalized === 'customer') return 'Customer';
    return 'System';
}

export function actorFromChannel(channel: unknown): 'customer' | 'underwriter' | 'system' | undefined {
    const normalized = String(channel || '').trim().toLowerCase();
    if (!normalized) return undefined;
    if (normalized === 'customer_wizard' || normalized === 'customer') return 'customer';
    if (normalized === 'bo' || normalized === 'backoffice') return 'underwriter';
    return 'system';
}

export function parseIsoOrEmpty(value: unknown): string | undefined {
    const raw = String(value || '').trim();
    if (!raw) return undefined;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return undefined;
    return d.toISOString();
}

// ─── UW Workflow State Machine ───────────────────────────────────────

export function resolveUwWorkflowState(params: {
    hasOpenFollowUps: boolean;
    isQuoteReady: boolean;
    questionnaireSentAt?: string;
    customerStartedAt?: string;
    uwStartedAt?: string;
    lastSavedBy?: 'customer' | 'underwriter' | 'system';
}): UwWorkflowState {
    if (params.hasOpenFollowUps) return 'FOLLOWUPS_OPEN';
    if (params.isQuoteReady) return 'QUOTE_READY';
    if (params.questionnaireSentAt) return 'QUESTIONNAIRE_SENT';
    if (params.customerStartedAt) return 'CUSTOMER_STARTED';
    if (params.uwStartedAt) return 'UW_STARTED';
    return 'NOT_STARTED';
}


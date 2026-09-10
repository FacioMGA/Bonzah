/**
 * Client Dashboard Model — CHAMPS Domain Layer
 *
 * RULES:
 *   - Every function is PURE (input → output, no side effects)
 *   - NO API calls, NO localStorage, NO caching, NO tokens
 *   - NO React imports
 *   - Operates on VM types from the contract layer
 *   - This file is a projection consumer — it must NOT
 *     own questionnaire rules or rating logic
 */

import type {
    DashboardPolicyVM,
    ActivityItemVM,
    CurrencyCode,
} from '../types/dashboard.contract';

// ─── Display Config ───

export const DASHBOARD_DISPLAY_CONFIG = {
    greetingHours: { morningStart: 5, afternoonStart: 12, eveningStart: 18 },
    defaults: {
        fallbackCountry: 'Cyprus',
        kmsOverLabel: 'Over 15,000',
        kmsOverThreshold: 15000,
        emergencyAssistanceLine: '+357 25 561 582',
    },
    status: {
        inactiveKeywords: ['EXPIRED', 'CANCEL', 'DECLINED', 'VOID', 'LAPSED', 'TERMINATED'],
        openClaimStatuses: ['OPEN', 'PENDING', 'QUERIED'],
    },
    labels: {
        coreCover: 'Core cover',
        noAddOns: 'No add-ons selected',
        noDocs: 'No documents available yet.',
    },
} as const;

// ─── Common helpers ───

/** Safe cast to Record, never throws */
/** Return first non-empty string from candidates */
export function firstNonEmpty(values: unknown[]): string {
    for (const value of values) {
        const str = String(value || '').trim();
        if (str) return str;
    }
    return '';
}

/** Parse numeric or return null */
export function asNumber(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

// ─── Greeting ───

export function getTimedGreeting(userName?: string): string {
    const hour = new Date().getHours();
    let greeting: string;
    if (hour >= DASHBOARD_DISPLAY_CONFIG.greetingHours.morningStart && hour < DASHBOARD_DISPLAY_CONFIG.greetingHours.afternoonStart) {
        greeting = 'Good morning';
    } else if (hour >= DASHBOARD_DISPLAY_CONFIG.greetingHours.afternoonStart && hour < DASHBOARD_DISPLAY_CONFIG.greetingHours.eveningStart) {
        greeting = 'Good afternoon';
    } else {
        greeting = 'Good evening';
    }
    return userName ? `${greeting}, ${userName}!` : `${greeting}!`;
}

export function extractFirstName(name: string | undefined): string {
    const trimmed = String(name || '').trim();
    if (!trimmed || trimmed.includes('@')) return 'there';
    return trimmed.split(/\s+/)[0] || 'there';
}

// ─── Policy sorting & filtering ───

export function sortPoliciesByRecency(policies: DashboardPolicyVM[]): DashboardPolicyVM[] {
    return [...policies].sort((a, b) => {
        const tsA = new Date(a.startDate || 0).getTime() || 0;
        const tsB = new Date(b.startDate || 0).getTime() || 0;
        return tsB - tsA;
    });
}

export function partitionPolicies(policies: DashboardPolicyVM[]): {
    active: DashboardPolicyVM[];
    expired: DashboardPolicyVM[];
} {
    const active: DashboardPolicyVM[] = [];
    const expired: DashboardPolicyVM[] = [];
    for (const p of policies) {
        if (p.isPast) {
            expired.push(p);
        } else {
            active.push(p);
        }
    }
    return { active, expired };
}

// ─── Activity feed processing ───

export function processActivityFeed(items: ActivityItemVM[], showAll: boolean): ActivityItemVM[] {
    const sorted = [...items].sort(
        (a, b) => new Date(b.occurredAt || 0).getTime() - new Date(a.occurredAt || 0).getTime(),
    );
    return showAll ? sorted : sorted.slice(0, 8);
}

// ─── Greeting from policies ───

export function resolveGreetingName(
    userName: string | undefined,
    policies: DashboardPolicyVM[],
    focusedPolicyId: string,
): string {
    const fromUser = extractFirstName(userName);
    if (fromUser !== 'there') return fromUser;

    const candidate = policies.find((p) => p.key === focusedPolicyId) || policies[0] || null;
    if (!candidate) return 'there';

    const primary = candidate.drivers.find((d) => d.isPrimary);
    if (primary) {
        const first = primary.fullName.split(/\s+/)[0] || '';
        if (first && first !== 'Policy holder') return first;
    }
    return 'there';
}

// ─── Display label formatting ───

export function documentTypeLabel(type: string): string {
    const t = type.toUpperCase();
    if (t.includes('CERTIFICATE')) return 'Certificate';
    if (t.includes('SCHEDULE')) return 'Policy Schedule';
    if (t.includes('STATEMENT_OF_FACT')) return 'Statement of Fact';
    if (t.includes('IPID')) return 'IPID (Key Facts)';
    if (t.includes('GREEN_CARD')) return 'Green Card';
    return 'Policy document';
}

/** Normalize a currency code to a supported CurrencyCode */
export function normalizeCurrency(value: unknown): CurrencyCode {
    const code = String(value || '').toUpperCase();
    if (code === 'USD' || code === 'GBP' || code === 'EUR') return code;
    return 'EUR';
}

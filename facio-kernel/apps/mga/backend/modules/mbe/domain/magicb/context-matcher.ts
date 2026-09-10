
import { MagicBContext } from './types.js';

export type ContextFilter =
    | { all: ContextFilter[] }
    | { any: ContextFilter[] }
    | { not: ContextFilter }
    | { [key: string]: unknown };

export function conditionsMatch(filter: ContextFilter | undefined | null, context: MagicBContext): boolean {
    if (!filter) return true; // Global rule (no filter) matches everything

    // 1. Handle "all" (AND)
    if ('all' in filter && Array.isArray(filter.all)) {
        return filter.all.every(subFilter => conditionsMatch(subFilter, context));
    }

    // 2. Handle "any" (OR)
    if ('any' in filter && Array.isArray(filter.any)) {
        return filter.any.some(subFilter => conditionsMatch(subFilter, context));
    }

    // 3. Handle "not" (NOT)
    if ('not' in filter && typeof filter.not === 'object') {
        return !conditionsMatch(filter.not as ContextFilter, context);
    }

    // 4. Handle Leaf Node (Key-Value Matching)
    // Implicit AND between keys in the same object
    for (const [key, val] of Object.entries(filter)) {
        if (!checkSingleCondition(key, val, context)) {
            return false;
        }
    }

    return true;
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function checkSingleCondition(key: string, expectedVal: unknown, context: MagicBContext): boolean {
    // A. Date Windowing
    if (key === 'effective_from') {
        if (!context.effectiveDate) return false; // Date required for date rules
        const fromDate = new Date(String(expectedVal || ''));
        return context.effectiveDate >= fromDate;
    }

    if (key === 'effective_to') {
        if (!context.effectiveDate) return false;
        const toDate = new Date(String(expectedVal || ''));
        return context.effectiveDate <= toDate;
    }

    // B. Direct Property Match
    const contextVal = asRecord(context)[key];

    // Exact match
    return contextVal === expectedVal;
}

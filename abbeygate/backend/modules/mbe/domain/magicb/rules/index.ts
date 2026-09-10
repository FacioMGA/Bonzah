
// backend/core/magicb/rules/index.ts
import { RuleOp, Condition, MagicBContext } from '../types.js';

const regexCache = new Map<string, RegExp>();

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function checkCondition(cond: Condition, context: MagicBContext): boolean {
    // Basic Condition Check (Only Context for now as per MVP tests)
    let actualValue: unknown;

    if (cond.contextAxis) {
        // e.g. context.region
        const contextRecord = asRecord(context);
        actualValue = contextRecord[cond.contextAxis];
    } else {
        // TODO: Check against sibling data slugs if needed
        return false;
    }

    switch (cond.op) {
        case 'eq': return actualValue === cond.value;
        case 'neq': return actualValue !== cond.value;
        case 'gt': return typeof actualValue === 'number' && typeof cond.value === 'number' && actualValue > cond.value;
        case 'in': return Array.isArray(cond.value) && cond.value.includes(actualValue);
        default: return false;
    }
}

export function executeRule(value: unknown, op: RuleOp, context: MagicBContext): boolean {
    const opAny = op as { if?: Condition; value?: number; values?: unknown[]; pattern?: string };
    switch (op.op) {
        case 'required':
            if (opAny.if && !checkCondition(opAny.if, context)) return true;
            return value !== undefined && value !== null && value !== '';
        case 'gt':
            return typeof value === 'number' && value > Number(opAny.value ?? 0);
        case 'lt':
            return typeof value === 'number' && value < Number(opAny.value ?? 0);
        case 'one_of':
            return typeof value === 'string' && Array.isArray(opAny.values) && opAny.values.includes(value);
        case 'regex': {
            if (typeof value !== 'string') return false;
            const pattern = String(opAny.pattern || '');
            let re = regexCache.get(pattern);
            if (!re) {
                try {
                    re = new RegExp(pattern);
                } catch {
                    return false;
                }
                regexCache.set(pattern, re);
            }
            return re.test(value);
        }
        case 'min_length':
            return typeof value === 'string' && value.length >= Number(opAny.value ?? 0);
        case 'date_parse': {
            if (value instanceof Date) return Number.isFinite(value.getTime());
            if (typeof value === 'string') {
                const d = new Date(value);
                return Number.isFinite(d.getTime());
            }
            return false;
        }
        default:
            return true;
    }
}
